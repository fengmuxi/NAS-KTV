import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import logger from '../logger';
import { WsMessageType } from '@nasktv/shared';
import type {
  WsMessage,
  RoomAuthorizedPayload,
  RoomUnauthorizedPayload,
  RoomClosedPayload,
  RoomExpiringSoonPayload,
  QueueUpdatedPayload,
  PingPayload,
  PongPayload,
  PlayerStatePayload,
  LyricSyncPayload,
} from '@nasktv/shared';
import {
  updateLastActiveAt,
  getRoomStateSnapshot,
  getRoomByCode,
  getPlayingQueueItem,
  assertMobileRoomControl,
  assertTvRoomIdentity,
  assertTvRoomControl,
} from '../services/room-service';
import { db, schema } from '../db';
import { eq, sql } from 'drizzle-orm';

// 扩展 WebSocket 实例元数据
type RoomWs = WebSocket & {
  roomCode?: string;
  role?: string;
  sessionToken?: string;
  deviceId?: string;
  controlAuthorizedUntil?: number;
  sessionExpiryTimer?: NodeJS.Timeout;
  isAlive?: boolean;
  lastSeenAt?: number;
};

// 房间连接映射：roomCode → Set<WebSocket>
const roomConnections = new Map<string, Set<RoomWs>>();

/**
 * 判断某房间的 TV 设备是否在线。
 * 仅统计 role==='tv' 且处于 OPEN 状态的连接（移动端连接不计入，避免手机在线误判为设备在线）。
 * roomConnections 在连接关闭时由 removeConnection 清理，因此结果即当前真实连接状态，
 * 无需依赖 last_active_at 阈值估算，天然近实时。供设备列表实时在线状态使用。
 */
export function isRoomTvOnline(roomCode: string): boolean {
  const conns = roomConnections.get(roomCode);
  if (!conns || conns.size === 0) return false;
  for (const ws of conns) {
    if (ws.role === 'tv' && ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

// 房间最新播放器状态缓存（roomCode → PlayerStatePayload）
// 用于重连恢复时下发快照。重启丢失可接受（TV 端会重新上报 PLAYER_STATE）。
const roomPlayerStateCache = new Map<string, PlayerStatePayload>();

// 房间歌词偏移配置缓存（roomCode → offsetMs）
// TV 端重连/重启后由服务端补发，保证当前房间生命周期内偏移不丢失。
const roomLyricOffsetCache = new Map<string, number>();

// 房间最新歌词行同步缓存（roomCode → LyricSyncPayload）
// 供 H5 客户端重连后恢复当前歌词行索引，避免回退到首行。
const roomLyricSyncCache = new Map<string, LyricSyncPayload>();

// 房间播放器状态版本号（roomCode → version）
// 每次收到 TV 端 PLAYER_STATE 自增后随广播下发，客户端据此丢弃过期状态，
// 避免 seek / 调节参数后在途的旧状态把 UI 打回退。
// 连接归零时不清除（见 removeConnection），保证 TV 短暂抖网重连后版本号继续单调递增。
const roomStateVersion = new Map<string, number>();

// 房间已记录播放历史的「当前播放项」（roomCode → queueItemId）
// 播放历史去重不再依赖「上一份广播状态」的内存比较：TV 抖网导致状态缓存被清后
// 重新上报同一首歌时，旧逻辑会重复写 play_history 并再累加一次 play_count。
// 以队列项为键而非 songId，重唱同一首歌会生成新队列项，仍会正常计入历史。
// 连接归零时不清除（见 removeConnection），保证抖网重连后不重复记录。
const roomRecordedItem = new Map<string, number>();

// 房间遥控命令串行锁：跨多个 H5 连接按服务端到达顺序转发，保证竞争结果确定。
const roomControlLocks = new Map<string, Promise<unknown>>();

function withRoomControlLock<T>(roomCode: string, fn: () => Promise<T>): Promise<T> {
  const prev = roomControlLocks.get(roomCode) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  roomControlLocks.set(roomCode, next.catch(() => undefined));
  return next;
}

// TV 每秒上报状态，身份与授权复验做短缓存，避免高频查询 SQLite。
const TV_CONTROL_AUTH_TTL_MS = 5000;

async function assertTvWsControl(ws: RoomWs, roomId: number): Promise<void> {
  const now = Date.now();
  if ((ws.controlAuthorizedUntil ?? 0) > now) return;
  await assertTvRoomControl(roomId, ws.deviceId ?? '');
  ws.controlAuthorizedUntil = now + TV_CONTROL_AUTH_TTL_MS;
}

function invalidateRoomControlAuthorization(roomCode: string): void {
  roomConnections.get(roomCode)?.forEach(ws => {
    ws.controlAuthorizedUntil = 0;
  });
}

// 房间 last_active_at 写库节流：roomCode → 上次写库时间戳
// 同一房间 30 秒内最多写一次数据库，避免高频心跳打 DB
const lastActiveWriteThrottle = new Map<string, number>();
const LAST_ACTIVE_THROTTLE_MS = 30_000;

// 心跳检测配置
const HEARTBEAT_INTERVAL_MS = 35_000; // 服务端每 35 秒扫描一次
const HEARTBEAT_TIMEOUT_MS = 60_000;  // 超过 60 秒未收到客户端消息视为断开

let wss: WebSocketServer | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * 初始化房间 WebSocket handler，挂载到现有 HTTP server。
 * 处理 /ws/room 路径的升级请求，其他路径交给后续 listener。
 */
export function initRoomWsHandler(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (url.pathname !== '/ws/room') {
      return;
    }

    wss!.handleUpgrade(request, socket, head, (ws) => {
      wss!.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (wsRaw, request) => {
    const ws = wsRaw as RoomWs;
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const roomCode = url.searchParams.get('roomCode');
    const role = url.searchParams.get('role') as 'tv' | 'mobile' | null;
    const sessionToken = url.searchParams.get('sessionToken') ?? undefined;
    const deviceId = url.searchParams.get('deviceId') ?? undefined;

    if (!roomCode) {
      ws.close(1008, 'Missing roomCode');
      return;
    }

    // 校验房间存在，避免任意房间码建立连接
    const room = await getRoomByCode(roomCode);
    if (!room) {
      ws.close(1008, 'Room not found');
      return;
    }

    if (role !== 'tv' && role !== 'mobile') {
      ws.close(1008, 'Invalid role');
      return;
    }
    try {
      if (role === 'tv') {
        await assertTvRoomIdentity(room.id, deviceId ?? '');
      } else {
        const { expiresAt } = await assertMobileRoomControl(room.id, sessionToken ?? '');
        const delay = Math.max(1, expiresAt - Date.now());
        ws.sessionExpiryTimer = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: WsMessageType.ROOM_UNAUTHORIZED,
                payload: { roomCode, reason: 'session_expired' },
                timestamp: Date.now(),
              }),
            );
            ws.close(4001, 'Session expired');
          }
        }, delay);
      }
    } catch {
      if (role === 'mobile' && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: WsMessageType.ROOM_UNAUTHORIZED,
            payload: { roomCode, reason: 'session_expired' },
            timestamp: Date.now(),
          }),
        );
      }
      ws.close(role === 'mobile' ? 4001 : 1008, 'Unauthorized room connection');
      return;
    }

    // 在 ws 上附加元数据
    ws.roomCode = roomCode;
    ws.role = role;
    ws.sessionToken = sessionToken;
    ws.deviceId = deviceId;
    ws.isAlive = true;
    ws.lastSeenAt = Date.now();

    if (!roomConnections.has(roomCode)) {
      roomConnections.set(roomCode, new Set());
    }
    roomConnections.get(roomCode)!.add(ws);

    ws.on('close', () => {
      removeConnection(ws, roomCode);
    });

    ws.on('error', () => {
      removeConnection(ws, roomCode);
    });

    // 处理客户端消息
    ws.on('message', async (data) => {
      ws.lastSeenAt = Date.now();
      ws.isAlive = true;

      try {
        const msg = JSON.parse(data.toString()) as WsMessage;

        // 心跳 PING：回 PONG，并节流更新 last_active_at
        if (msg.type === WsMessageType.PING) {
          const payload = (msg.payload ?? {}) as PingPayload;
          handlePing(ws, roomCode, payload);
          return;
        }

        // PLAYER_STATE：转发给房间内其他客户端，同时更新服务端缓存
        // 对老版本 payload（缺少 pitch / reverb / reverbPreset）默认填充，确保 Mobile H5 老版本也能正确显示
        if (msg.type === WsMessageType.PLAYER_STATE) {
          if (ws.role !== 'tv' || !ws.deviceId) return;
          await assertTvWsControl(ws, room.id);
          const raw = msg.payload as Partial<PlayerStatePayload>;
          // 状态版本号由服务端统一分配（单调自增），避免 TV 重启后版本回退
          // 导致客户端把新状态当过期丢弃。
          const nextVersion = (roomStateVersion.get(roomCode) ?? 0) + 1;
          roomStateVersion.set(roomCode, nextVersion);
          const payload: PlayerStatePayload = {
            ...raw,
            pitch: raw.pitch ?? 0,
            reverb: raw.reverb ?? 0,
            reverbPreset: raw.reverbPreset ?? 'off',
            reverbDuration: raw.reverbDuration ?? 2,
            reverbDecay: raw.reverbDecay ?? 2,
            stateVersion: nextVersion,
          } as PlayerStatePayload;
          // 记录播放历史：以「房间 + 歌曲」维度去重，且去重集合不随连接数归零清空，
          // 避免 TV 抖网重连后重新上报同一首歌造成重复计数。
          if (payload.status === 'playing' && payload.songId != null) {
            recordPlayHistoryOnce(roomCode, payload.songId).catch((err) =>
              logger.error('Failed to record play history:', err),
            );
          }
          roomPlayerStateCache.set(roomCode, payload);
          // 广播规范化后的 msg（替换 payload）
          broadcastToRoom(roomCode, { ...msg, payload }, ws);
          return;
        }

        // LYRIC_SYNC：仅转发，并缓存供 H5 重连恢复歌词行索引
        if (msg.type === WsMessageType.LYRIC_SYNC) {
          if (ws.role !== 'tv' || !ws.deviceId) return;
          await assertTvWsControl(ws, room.id);
          roomLyricSyncCache.set(roomCode, msg.payload as LyricSyncPayload);
          broadcastToRoom(roomCode, msg, ws);
          return;
        }

        // LYRIC_OFFSET：歌词时间偏移配置，缓存供重连恢复，并广播给房间内所有客户端
        // TV 端应用偏移，H5 端同步 UI 状态（避免多手机间设置不同步）
        if (msg.type === WsMessageType.LYRIC_OFFSET) {
          await withRoomControlLock(roomCode, async () => {
            if (ws.role === 'tv' && ws.deviceId) {
              await assertTvWsControl(ws, room.id);
            } else if (ws.role === 'mobile' && ws.sessionToken) {
              await assertMobileRoomControl(room.id, ws.sessionToken);
            } else {
              return;
            }
            const offset = Number((msg.payload as { offsetMs?: number })?.offsetMs) || 0;
            roomLyricOffsetCache.set(roomCode, Math.max(-10000, Math.min(10000, offset)));
            broadcastToRoom(roomCode, msg, ws);
          });
          return;
        }

        // PLAYER_COMMAND：手机遥控命令，转发给房间内 TV 端播放器执行
        // 控制状态（音调/混响/模式等）通过 TV 端 PLAYER_STATE 广播自动同步到所有 H5 用户
        if (msg.type === WsMessageType.PLAYER_COMMAND) {
          if (ws.role !== 'mobile' || !ws.sessionToken) return;
          await withRoomControlLock(roomCode, async () => {
            await assertMobileRoomControl(room.id, ws.sessionToken!);
            broadcastToTv(roomCode, msg, ws);
          });
          return;
        }
      } catch {
        // 忽略无效消息或已失效身份发来的控制消息
      }
    });

    // 连接建立时推送房间状态快照，用于客户端重连后恢复状态
    await sendRoomStateSnapshot(ws, roomCode);

    // TV 端补发当前歌词偏移配置（重连/重启后恢复，H5 端也会主动重发）
    const offset = roomLyricOffsetCache.get(roomCode);
    if (offset != null && offset !== 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: WsMessageType.LYRIC_OFFSET,
          payload: { offsetMs: offset },
          timestamp: Date.now(),
        }),
      );
    }

    // 补发最新歌词行同步（H5 重连后恢复歌词索引，不回到首行）
    const lyricSync = roomLyricSyncCache.get(roomCode);
    if (lyricSync && ws.role === 'mobile' && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: WsMessageType.LYRIC_SYNC,
          payload: lyricSync,
          timestamp: Date.now(),
        }),
      );
    }
  });

  // 启动服务端心跳定时器
  startHeartbeat();

  logger.info('Room WebSocket handler initialized at /ws/room');
}

/**
 * 从房间连接集合中移除指定 ws，并在集合为空时清理缓存。
 */
function removeConnection(ws: RoomWs, roomCode: string): void {
  if (ws.sessionExpiryTimer) {
    clearTimeout(ws.sessionExpiryTimer);
    ws.sessionExpiryTimer = undefined;
  }
  const conns = roomConnections.get(roomCode);
  if (conns) {
    conns.delete(ws);
    if (conns.size === 0) {
      roomConnections.delete(roomCode);
      // 房间无连接时清理播放器状态缓存，避免内存泄漏
      roomPlayerStateCache.delete(roomCode);
      roomLyricOffsetCache.delete(roomCode);
      roomLyricSyncCache.delete(roomCode);
      lastActiveWriteThrottle.delete(roomCode);
    }
  }
}

/**
 * 处理客户端 PING：回 PONG，并节流更新 rooms.last_active_at。
 */
async function handlePing(
  ws: RoomWs,
  roomCode: string,
  payload: PingPayload,
): Promise<void> {
  const pong: WsMessage<PongPayload> = {
    type: WsMessageType.PONG,
    payload: {
      clientTime: payload.clientTime,
      serverTime: Date.now(),
    },
    timestamp: Date.now(),
  };
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(pong));
  }

  // 节流写库：同一房间 30 秒内最多更新一次 last_active_at
  const now = Date.now();
  const lastWrite = lastActiveWriteThrottle.get(roomCode) ?? 0;
  if (now - lastWrite >= LAST_ACTIVE_THROTTLE_MS) {
    lastActiveWriteThrottle.set(roomCode, now);
    try {
      const room = await getRoomByCode(roomCode);
      if (room) {
        await updateLastActiveAt(room.id);
      }
    } catch (err) {
      // 写库失败不影响心跳，下次再试
      logger.error('Failed to update last_active_at:', err);
    }
  }
}

/**
 * 记录播放历史（play_history + songs.play_count 累加）
 */
async function recordPlayHistory(roomCode: string, songId: number): Promise<void> {
  const room = await getRoomByCode(roomCode);
  await db
    .insert(schema.playHistory)
    .values({ roomId: room?.id ?? null, songId, playedAt: new Date() })
    .run();
  await db
    .update(schema.songs)
    .set({ playCount: sql`${schema.songs.playCount} + 1` })
    .where(eq(schema.songs.id, songId))
    .run();
}

/**
 * 记录播放历史（幂等）：同一个队列项只记一次。
 *
 * 原实现靠比较内存里上一份 PLAYER_STATE 的 songId 判断是否切歌。房间连接数归零时
 * 缓存被清空，TV 抖网重连后重新上报同一首歌，会重复写 play_history 并重复累加 play_count。
 *
 * 这里以「当前 playing 队列项的 id」作为去重键：队列项是一次点歌的唯一实例，
 * 因此重连不会重复计数，而同一首歌被重新点播（新队列项）仍能正常计入。
 */
async function recordPlayHistoryOnce(roomCode: string, songId: number): Promise<void> {
  const room = await getRoomByCode(roomCode);
  if (!room) {
    return;
  }
  const playing = await getPlayingQueueItem(room.id);
  // 无 playing 项时（例如 TV 尚未同步队列）不记录，等下一次上报
  if (!playing || playing.songId !== songId) {
    return;
  }

  if (roomRecordedItem.get(roomCode) === playing.id) {
    return;
  }
  roomRecordedItem.set(roomCode, playing.id);
  await recordPlayHistory(roomCode, songId);
}

/**
 * 向单个连接推送房间状态快照（用于重连恢复）。
 */
async function sendRoomStateSnapshot(
  ws: RoomWs,
  roomCode: string,
): Promise<void> {
  try {
    const cachedPlayerState = roomPlayerStateCache.get(roomCode) ?? null;
    const snapshot = await getRoomStateSnapshot(roomCode, cachedPlayerState);
    if (!snapshot) {
      return; // 房间不存在，跳过
    }
    const msg: WsMessage = {
      type: WsMessageType.ROOM_STATE_SNAPSHOT,
      payload: snapshot,
      timestamp: Date.now(),
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  } catch (err) {
    logger.error('Failed to send room state snapshot:', err);
  }
}

/**
 * 启动服务端心跳检测：定期扫描所有连接，超时未活跃的连接强制断开。
 *
 * 实现说明：
 * - 浏览器 WebSocket API 不暴露协议层 ping/pong，故采用应用层 PING/PONG
 * - 客户端每 25 秒发 PING，服务端回 PONG 并刷新 lastSeenAt
 * - 服务端每 35 秒扫描，lastSeenAt 超过 60 秒视为断开，调用 terminate()
 */
function startHeartbeat(): void {
  if (heartbeatTimer) {
    return;
  }
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    roomConnections.forEach((conns, roomCode) => {
      conns.forEach((ws) => {
        if (!ws.isAlive || (ws.lastSeenAt && now - ws.lastSeenAt > HEARTBEAT_TIMEOUT_MS)) {
          // 超时未收到消息，强制断开
          logger.warn(`WebSocket heartbeat timeout for room ${roomCode}, terminating`);
          ws.terminate();
          return;
        }
        ws.isAlive = false; // 等待下次客户端 PING 翻回 true
      });
    });
  }, HEARTBEAT_INTERVAL_MS);

  process.on('SIGTERM', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
  process.on('SIGINT', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
}

/**
 * 向房间内所有客户端广播消息（可排除发送者）。
 * 若房间不存在或无连接，静默返回。
 */
export function broadcastToRoom(
  roomCode: string,
  message: WsMessage,
  exclude?: WebSocket,
): void {
  const conns = roomConnections.get(roomCode);
  if (!conns) return;
  const data = JSON.stringify(message);
  conns.forEach((ws) => {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

/**
 * 向房间内所有 TV 端客户端广播消息（可排除发送者）。
 * 用于手机遥控命令转发，避免非 TV 端重复处理。
 */
export function broadcastToTv(
  roomCode: string,
  message: WsMessage,
  exclude?: WebSocket,
): void {
  const conns = roomConnections.get(roomCode);
  if (!conns) return;
  const data = JSON.stringify(message);
  conns.forEach((ws) => {
    if (ws !== exclude && ws.role === 'tv' && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

/**
 * 获取房间当前在线连接数
 */
export function getRoomConnectionCount(roomCode: string): number {
  return roomConnections.get(roomCode)?.size ?? 0;
}

/**
 * 广播 ROOM_AUTHORIZED 消息到房间
 */
export function broadcastRoomAuthorized(
  roomCode: string,
  payload: RoomAuthorizedPayload,
): void {
  invalidateRoomControlAuthorization(roomCode);
  broadcastToRoom(roomCode, {
    type: WsMessageType.ROOM_AUTHORIZED,
    payload,
    timestamp: Date.now(),
  });
}

/**
 * 广播 ROOM_UNAUTHORIZED 消息到房间
 */
export function broadcastRoomUnauthorized(
  roomCode: string,
  payload: RoomUnauthorizedPayload,
): void {
  invalidateRoomControlAuthorization(roomCode);
  broadcastToRoom(roomCode, {
    type: WsMessageType.ROOM_UNAUTHORIZED,
    payload,
    timestamp: Date.now(),
  });
}

/**
 * 广播 ROOM_CLOSED 消息到房间
 */
export function broadcastRoomClosed(
  roomCode: string,
  payload: RoomClosedPayload,
): void {
  invalidateRoomControlAuthorization(roomCode);
  broadcastToRoom(roomCode, {
    type: WsMessageType.ROOM_CLOSED,
    payload,
    timestamp: Date.now(),
  });
}

/**
 * 关闭房间内所有连接（房间码轮换时调用：旧码连接全部断开并清理缓存）。
 * 调用前应先 broadcastRoomClosed 广播消息，确保客户端先收到通知再断开。
 */
export function closeAllRoomConnections(roomCode: string): void {
  const conns = roomConnections.get(roomCode);
  if (!conns) return;
  conns.forEach((ws) => {
    try {
      ws.close(4000, 'Room code rotated');
    } catch {
      // 忽略已关闭的连接
    }
  });
}

/**
 * 广播 ROOM_EXPIRING_SOON 消息到房间
 */
export function broadcastRoomExpiringSoon(
  roomCode: string,
  payload: RoomExpiringSoonPayload,
): void {
  broadcastToRoom(roomCode, {
    type: WsMessageType.ROOM_EXPIRING_SOON,
    payload,
    timestamp: Date.now(),
  });
}

/**
 * 广播 QUEUE_UPDATED 消息到房间
 */
export function broadcastQueueUpdated(
  roomCode: string,
  payload: QueueUpdatedPayload,
): void {
  broadcastToRoom(roomCode, {
    type: WsMessageType.QUEUE_UPDATED,
    payload,
    timestamp: Date.now(),
  });
}
