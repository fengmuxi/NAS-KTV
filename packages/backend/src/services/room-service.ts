import { eq, and, sql, gt, lt, lte, isNotNull, isNull, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import logger from '../logger';
import type {
  Room,
  RoomQueue,
  RoomSession,
  QueueAddParams,
  QueueInsertNextParams,
  QueueSkipParams,
  QueueListItem,
  QueueItem,
  RoomSessionJoinParams,
  PlayerStatePayload,
  RoomStateSnapshotPayload,
  RoomJoinTicket,
} from '@nasktv/shared';
import {
  broadcastQueueUpdated,
  broadcastRoomClosed,
  broadcastRoomUnauthorized,
  closeAllRoomConnections,
} from '../ws/room-handler';
import { createAppError } from '../middleware/error';
import { config } from '../config';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const { rooms, roomQueues, roomSessions, songs, artists, songArtists } = schema;

// 房间码字符集：去除易混淆字符 0/1/O/I
const ROOM_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 6;

type ActiveJoinTicket = {
  jti: string;
  authorizationCode: string;
  joinToken: string;
  expiresAt: number;
  authorizedAt: number;
};

// 每个房间仅保留一个当前加入票据；签发新票据会使旧二维码立即失效。
const activeJoinTickets = new Map<number, ActiveJoinTicket>();

/** 查询某加入码当前是否被任一房间占用（含未过期）。用于避免跨房间的码冲突。 */
async function isJoinCodeTaken(code: string): Promise<boolean> {
  const [row] = await db
    .select({ id: rooms.id })
    .from(rooms)
    .where(
      and(
        eq(rooms.currentJoinCode, code),
        gt(rooms.joinCodeExpiresAt, new Date()),
      ),
    )
    .limit(1);
  return !!row;
}

async function generateAuthorizationCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    const inMemoryDuplicated = [...activeJoinTickets.values()].some(
      ticket => ticket.authorizationCode === code && ticket.expiresAt > Date.now(),
    );
    if (inMemoryDuplicated) continue;
    // 同时校验 DB 中仍生效的码，避免与另一房间（或本进程重启前签发）冲突
    if (await isJoinCodeTaken(code)) continue;
    return code;
  }
  throw new Error('生成加入码失败，请重试');
}

export async function issueRoomJoinTicket(
  roomId: number,
  deviceId: string,
  forceRotate = false,
): Promise<RoomJoinTicket> {
  await assertTvRoomControl(roomId, deviceId);
  const room = await getRoomById(roomId);
  if (!room) throw createAppError('房间不存在', 404);

  const now = Date.now();
  const ttlExpiresAt = now + config.h5JoinTicketTtlMinutes * 60_000;
  const roomExpiresAt =
    room.authorizeType === 'temporary' && room.authorizeExpiresAt
      ? room.authorizeExpiresAt.getTime()
      : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(ttlExpiresAt, roomExpiresAt);
  const authorizedAt = room.authorizedAt?.getTime() ?? 0;
  const existing = activeJoinTickets.get(roomId);
  if (
    !forceRotate &&
    existing &&
    existing.expiresAt > now + 60_000 &&
    existing.authorizedAt === authorizedAt
  ) {
    return {
      authorizationCode: existing.authorizationCode,
      joinToken: existing.joinToken,
      expiresAt: new Date(existing.expiresAt).toISOString(),
    };
  }
  const jti = randomUUID();
  const authorizationCode = await generateAuthorizationCode();

  const joinToken = jwt.sign(
    {
      type: 'h5-join',
      roomId,
      authorizationCode,
      jti,
      authorizedAt,
    },
    config.jwtSecret,
    { expiresIn: Math.max(1, Math.floor((expiresAt - now) / 1000)) },
  );
  activeJoinTickets.set(roomId, {
    jti,
    authorizationCode,
    joinToken,
    expiresAt,
    authorizedAt,
  });
  // Plan B：将当前加入码持久化到 rooms 表，使「仅含授权码」的扫码加入对后端重启免疫。
  await db
    .update(rooms)
    .set({ currentJoinCode: authorizationCode, joinCodeExpiresAt: new Date(expiresAt) })
    .where(eq(rooms.id, roomId));
  return {
    authorizationCode,
    joinToken,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

async function resolveRoomJoinTicket(
  authorizationCode: string,
  joinToken?: string,
): Promise<Room> {
  let claims: JwtPayload & {
    type?: string;
    roomId?: number;
    authorizationCode?: string;
    jti?: string;
    authorizedAt?: number;
  };
  if (!joinToken) {
    // Plan B：无 token 兜底改为查 rooms 表持久化的当前加入码，对后端重启免疫。
    const [room] = await db
      .select()
      .from(rooms)
      .where(
        and(
          eq(rooms.currentJoinCode, authorizationCode),
          gt(rooms.joinCodeExpiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!room) {
      throw createAppError('动态加入码无效或已过期，请查看电视上的新加入码', 403);
    }
    return assertRoomControlAvailable(room.id);
  }
  try {
    claims = jwt.verify(joinToken, config.jwtSecret) as typeof claims;
  } catch {
    throw createAppError('加入二维码已过期，请扫描电视上的新二维码', 403);
  }
  if (claims.type !== 'h5-join' || !claims.roomId || !claims.jti) {
    throw createAppError('加入凭证无效', 403);
  }
  const active = activeJoinTickets.get(claims.roomId);
  if (
    !active ||
    active.jti !== claims.jti ||
    active.expiresAt <= Date.now() ||
    active.authorizationCode !== claims.authorizationCode ||
    authorizationCode !== claims.authorizationCode
  ) {
    throw createAppError('加入二维码已失效，请扫描电视上的新二维码', 403);
  }
  const room = await getRoomById(claims.roomId);
  if (!room) {
    throw createAppError('房间不存在', 404);
  }
  await assertRoomControlAvailable(room.id);
  if ((room.authorizedAt?.getTime() ?? 0) !== claims.authorizedAt) {
    throw createAppError('加入二维码属于旧授权周期，请扫描电视上的新二维码', 403);
  }
  return room;
}

// 房间空闲超时（分钟，0=禁用）；设备自动关闭天数（0=禁用）
const ROOM_IDLE_TIMEOUT_MINUTES = parseInt(process.env.ROOM_IDLE_TIMEOUT || '30', 10);
const DEVICE_AUTO_CLOSE_DAYS = parseInt(process.env.DEVICE_AUTO_CLOSE_DAYS || '30', 10);

/**
 * per-room 串行锁：串行化同一房间的队列写操作（点歌/插队/顶歌/跳过/取消/清除）。
 * 多个 H5 并发操作时，若不加锁会出现：
 * - addToQueue 的 SELECT MAX(sortOrder)+1 竞争 → 重复 sortOrder，队列顺序错乱
 * - 并发 skip 时 ensurePlayingItem 可能激活多个 playing 项
 * - topQueueItem 的区间移动与并发插入互相踩踏
 * 锁链在异常时不中断（prev.then(fn, fn)），前一个操作失败不影响后续操作。
 */
const roomLocks = new Map<number, Promise<unknown>>();

// 房间队列版本：所有队列写操作均在 per-room 锁内完成，因此可在广播前单调递增。
// 首次访问以当前时间为版本纪元，降低服务重启后新版本小于旧客户端缓存的可能。
const roomQueueVersions = new Map<number, number>();

function withRoomLock<T>(roomId: number, fn: () => Promise<T>): Promise<T> {
  const prev = roomLocks.get(roomId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  roomLocks.set(roomId, next.catch(() => undefined));
  return next;
}

function getQueueVersion(roomId: number): number {
  const existing = roomQueueVersions.get(roomId);
  if (existing != null) return existing;
  // 以进程当前时间作为版本纪元，降低服务重启后版本回退的可能；同一进程内继续逐次 +1。
  const initial = Date.now();
  roomQueueVersions.set(roomId, initial);
  return initial;
}

function nextQueueVersion(roomId: number): number {
  const version = getQueueVersion(roomId) + 1;
  roomQueueVersions.set(roomId, version);
  return version;
}

/** 校验房间仍处于可控制状态。 */
async function assertRoomControlAvailable(roomId: number): Promise<Room> {
  const room = await getRoomById(roomId);
  if (!room) {
    throw createAppError('房间不存在', 404);
  }
  if (room.status !== 'active' || room.authorized !== 1) {
    throw createAppError('房间未激活或未授权', 403);
  }
  if (
    room.authorizeType === 'temporary' &&
    room.authorizeExpiresAt &&
    room.authorizeExpiresAt.getTime() <= Date.now()
  ) {
    throw createAppError('房间授权已过期', 403);
  }
  return room;
}

/** H5 控制准入：会话必须存在、属于该房间且尚未离开。 */
export async function assertMobileRoomControl(
  roomId: number,
  sessionToken: string,
): Promise<{ sessionId: number; expiresAt: number }> {
  const room = await assertRoomControlAvailable(roomId);
  let claims: JwtPayload & { type?: string; roomId?: number; sessionId?: number };
  try {
    claims = jwt.verify(sessionToken, config.jwtSecret) as typeof claims;
  } catch {
    throw createAppError('房间会话凭证无效或已过期，请重新加入', 403);
  }
  if (claims.type !== 'h5-room' || claims.roomId !== roomId) {
    throw createAppError('房间会话凭证与房间不匹配', 403);
  }
  const sessionId = Number(claims.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createAppError('无效的房间会话', 403);
  }
  const [session] = await db
    .select({ id: roomSessions.id, joinedAt: roomSessions.joinedAt })
    .from(roomSessions)
    .where(
      and(
        eq(roomSessions.id, sessionId),
        eq(roomSessions.roomId, roomId),
        isNull(roomSessions.leftAt),
      ),
    )
    .limit(1);
  if (!session) {
    throw createAppError('房间会话不存在或已失效', 403);
  }
  const ttlExpiresAt = getH5SessionExpiresAt(session.joinedAt);
  const roomExpiresAt =
    room.authorizeType === 'temporary' && room.authorizeExpiresAt
      ? room.authorizeExpiresAt.getTime()
      : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(ttlExpiresAt, roomExpiresAt);
  if (expiresAt <= Date.now()) {
    await db
      .update(roomSessions)
      .set({ leftAt: new Date() })
      .where(and(eq(roomSessions.id, sessionId), isNull(roomSessions.leftAt)))
      .run();
    throw createAppError('房间会话已过期，请重新加入', 403);
  }
  return { sessionId, expiresAt };
}

function getH5SessionExpiresAt(joinedAt: Date | null): number {
  const startedAt = joinedAt?.getTime() ?? 0;
  return startedAt + config.h5SessionTtlMinutes * 60_000;
}

/** 使房间内全部 H5 会话失效；撤权、关闭或新授权周期开始时调用。 */
export async function expireRoomSessions(roomId: number): Promise<number> {
  const result = await db
    .update(roomSessions)
    .set({ leftAt: new Date() })
    .where(and(eq(roomSessions.roomId, roomId), isNull(roomSessions.leftAt)))
    .run();
  return result.changes ?? 0;
}

/** 返回 H5 会话的服务端绝对到期时间。 */
export function getRoomSessionExpiresAt(session: RoomSession, room: Room): Date {
  const ttlExpiresAt = getH5SessionExpiresAt(session.joinedAt);
  const roomExpiresAt =
    room.authorizeType === 'temporary' && room.authorizeExpiresAt
      ? room.authorizeExpiresAt.getTime()
      : Number.POSITIVE_INFINITY;
  return new Date(Math.min(ttlExpiresAt, roomExpiresAt));
}

/** TV 控制准入：设备标识必须与房间注册设备一致。 */
export async function assertTvRoomIdentity(roomId: number, deviceId: string): Promise<void> {
  const room = await getRoomById(roomId);
  if (!room) {
    throw createAppError('房间不存在', 404);
  }
  if (!deviceId || room.deviceId !== deviceId) {
    throw createAppError('设备身份校验失败', 403);
  }
}

/** TV 控制准入：设备归属正确，且房间仍处于可控制状态。 */
export async function assertTvRoomControl(roomId: number, deviceId: string): Promise<void> {
  await assertTvRoomIdentity(roomId, deviceId);
  await assertRoomControlAvailable(roomId);
}

/**
 * 生成 6 位房间码（数字+大写字母，去除易混淆字符 O/0/I/1）
 */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
    code += ROOM_CODE_CHARS[idx];
  }
  return code;
}

/**
 * 生成数据库中唯一的房间码（最多重试 10 次）
 */
async function generateUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRoomCode();
    const existing = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.code, code))
      .limit(1);
    if (existing.length === 0) {
      return code;
    }
  }
  throw new Error('生成房间码失败，请重试');
}

/**
 * 注册设备并生成房间码
 * - 若 deviceId 已存在，返回已有 room 记录
 * - 否则生成新房间码，创建 room 记录 status='pending', authorized=0
 */
export async function registerDevice(
  deviceId: string,
  name?: string,
  deviceInfo?: string
): Promise<Room> {
  const existing = await db
    .select()
    .from(rooms)
    .where(eq(rooms.deviceId, deviceId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const code = await generateUniqueRoomCode();

  const [room] = await db
    .insert(rooms)
    .values({
      code,
      deviceId,
      name: name ?? null,
      deviceInfo: deviceInfo ?? null,
      status: 'pending',
      authorized: 0,
      createdAt: new Date(),
    })
    .returning();

  return room;
}

/**
 * 根据房间码查询房间
 */
export async function getRoomByCode(code: string): Promise<Room | null> {
  const result = await db
    .select()
    .from(rooms)
    .where(eq(rooms.code, code))
    .limit(1);
  return result[0] ?? null;
}

/**
 * 轮换房间授权码（TV 每次启动时调用一次）：生成新房间码，旧码立即作废。
 * - 保留设备身份 / 授权状态 / 队列 / H5 会话（仅换码，TV 无需重新授权）
 * - 旧的加入票据（6 位码 / 二维码）立即失效
 * - 广播 ROOM_CLOSED(reason='code_rotated') 并断开旧码下所有连接，
 *   在线 H5 收到提示后回到加入页；离线 H5 用旧码重连会收到 1008 被拒
 */
export async function rotateRoomCode(
  roomId: number,
  deviceId: string,
): Promise<Room | null> {
  await assertTvRoomControl(roomId, deviceId);
  const room = await getRoomById(roomId);
  if (!room) throw createAppError('房间不存在', 404);

  const oldCode = room.code;
  const newCode = await generateUniqueRoomCode();
  if (newCode === oldCode) {
    return room;
  }

  const [updated] = await db
    .update(rooms)
    .set({ code: newCode })
    .where(eq(rooms.id, roomId))
    .returning();

  // 旧加入票据立即失效，新码下必须重新签发
  activeJoinTickets.delete(roomId);
  // 同步清掉持久化的当前加入码，避免旧码仍可扫码加入
  await db
    .update(rooms)
    .set({ currentJoinCode: null, joinCodeExpiresAt: null })
    .where(eq(rooms.id, roomId));

  // 通知旧码下所有在线客户端并断开（先广播再断开，保证客户端先收到消息）
  broadcastRoomClosed(oldCode, { roomCode: oldCode, reason: 'code_rotated' });
  closeAllRoomConnections(oldCode);

  return updated ?? room;
}

/**
 * 根据房间 ID 查询房间
 */
export async function getRoomById(id: number): Promise<Room | null> {
  const result = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, id))
    .limit(1);
  return result[0] ?? null;
}

/**
 * 查询即将过期的临时授权房间（用于提前推送 ROOM_EXPIRING_SOON）。
 * 条件：authorized=1, status='active', authorizeType='temporary',
 *       authorizeExpiresAt 在 now 到 now+withinMinutes 之间。
 */
export async function findExpiringSoonRooms(withinMinutes: number): Promise<Room[]> {
  const now = new Date();
  const threshold = new Date(now.getTime() + withinMinutes * 60_000);
  return db
    .select()
    .from(rooms)
    .where(
      and(
        eq(rooms.authorized, 1),
        eq(rooms.status, 'active'),
        eq(rooms.authorizeType, 'temporary'),
        isNotNull(rooms.authorizeExpiresAt),
        gt(rooms.authorizeExpiresAt, now),
        lt(rooms.authorizeExpiresAt, threshold),
      ),
    );
}

/**
 * 关闭房间：status='closed', closedAt=now。
 * 成功后向房间内所有 WebSocket 客户端推送 ROOM_CLOSED 消息。
 */
export async function closeRoom(id: number): Promise<Room | null> {
  const [room] = await db
    .update(rooms)
    .set({ status: 'closed', closedAt: new Date(), currentJoinCode: null, joinCodeExpiresAt: null })
    .where(eq(rooms.id, id))
    .returning();

  if (room) {
    await db.delete(roomQueues).where(eq(roomQueues.roomId, room.id));
    await expireRoomSessions(room.id);
    broadcastRoomClosed(room.code, {
      roomCode: room.code,
      reason: 'closed',
    });
  }

  return room ?? null;
}

/**
 * 撤销已过期的临时授权房间：status='revoked', authorized=0，
 * 并向房间内客户端广播 ROOM_UNAUTHORIZED（reason: expired）。
 * 由定时器调用（见 index.ts）。
 */
export async function revokeExpiredAuthorizations(): Promise<Room[]> {
  const now = new Date();
  const expiredRooms = await db
    .select()
    .from(rooms)
    .where(
      and(
        eq(rooms.authorized, 1),
        eq(rooms.status, 'active'),
        eq(rooms.authorizeType, 'temporary'),
        isNotNull(rooms.authorizeExpiresAt),
        lte(rooms.authorizeExpiresAt, now),
      ),
    );

  for (const room of expiredRooms) {
    await db
      .update(rooms)
      .set({ authorized: 0, status: 'revoked', currentJoinCode: null, joinCodeExpiresAt: null })
      .where(eq(rooms.id, room.id))
      .run();
    await expireRoomSessions(room.id);
    broadcastRoomUnauthorized(room.code, { roomCode: room.code, reason: 'expired' });
  }

  return expiredRooms;
}

/**
 * 自动关闭空闲/长期未活跃的房间：
 * - 空闲超时：status='active' 且超过 ROOM_IDLE_TIMEOUT（分钟，默认 30，0=禁用）无活跃
 * - 设备自动关闭：注册超 DEVICE_AUTO_CLOSE_DAYS（天，默认 30，0=禁用）未活跃
 * 活跃时间取 last_active_at，缺失时回退到 created_at。由定时器调用（见 index.ts）。
 */
export async function closeIdleAndStaleRooms(): Promise<number> {
  const now = new Date();
  let closed = 0;

  const candidates = await db
    .select()
    .from(rooms)
    .where(inArray(rooms.status, ['pending', 'active']));

  for (const room of candidates) {
    const lastActive = room.lastActiveAt ?? room.createdAt;
    if (!lastActive) {
      continue;
    }
    const idleMs = now.getTime() - lastActive.getTime();

    const idleClosed =
      ROOM_IDLE_TIMEOUT_MINUTES > 0 &&
      room.status === 'active' &&
      idleMs >= ROOM_IDLE_TIMEOUT_MINUTES * 60_000;
    const staleClosed =
      DEVICE_AUTO_CLOSE_DAYS > 0 && idleMs >= DEVICE_AUTO_CLOSE_DAYS * 24 * 3600_000;

    if (idleClosed || staleClosed) {
      await closeRoom(room.id);
      closed++;
      logger.info(
        `Auto closed room ${room.code} (reason=${idleClosed ? 'idle-timeout' : 'stale-device'})`,
      );
    }
  }

  if (closed > 0) {
    logger.info(`Auto close: ${closed} room(s) closed`);
  }
  return closed;
}

/**
 * 更新房间设备最后活跃时间（last_active_at）。
 * 由 WebSocket handler 在收到客户端心跳 PING 时调用。
 *
 * 注意：调用方应自行节流（建议 30 秒最多一次）以避免高频数据库写入。
 */
export async function updateLastActiveAt(roomId: number): Promise<void> {
  await db
    .update(rooms)
    .set({ lastActiveAt: new Date() })
    .where(eq(rooms.id, roomId));
}

/**
 * 获取房间状态快照（重连恢复用）。
 * 聚合：房间基础信息 + 当前队列 + 当前播放器状态（来自内存缓存）。
 *
 * @param roomCode 房间码
 * @param playerState 服务端缓存的最新 PLAYER_STATE，由 room-handler 维护
 */
export async function getRoomStateSnapshot(
  roomCode: string,
  playerState: PlayerStatePayload | null,
): Promise<RoomStateSnapshotPayload | null> {
  const room = await getRoomByCode(roomCode);
  if (!room) {
    return null;
  }

  return withRoomLock(room.id, async () => {
    const items = await getQueue(room.id);
    const queue: QueueItem[] = items.map((item) => ({
      id: item.id,
      songId: item.songId ?? 0,
      songTitle: item.songTitle,
      songArtist: item.songArtist,
      userSessionId: item.userSessionId ?? '',
      nickname: item.nickname ?? '',
      fileType: item.fileType ?? null,
      status: item.status ?? 'pending',
      sortOrder: item.sortOrder ?? 0,
      requestedAt: item.requestedAt ? item.requestedAt.toISOString() : '',
      vocalsPath: item.vocalsPath ?? null,
      instrumentalPath: item.instrumentalPath ?? null,
    }));

    return {
      roomCode: room.code,
      authorized: room.authorized === 1 && room.status === 'active',
      roomStatus: (room.status ?? 'pending') as 'pending' | 'active' | 'closed' | 'revoked',
      queue,
      queueVersion: getQueueVersion(room.id),
      playerState,
      serverTime: Date.now(),
    };
  });
}

/**
 * 查询房间队列（含歌曲标题、歌手名、点歌人昵称）
 * 关联 songs、artists、room_sessions 表
 */
export async function getQueue(roomId: number): Promise<QueueListItem[]> {
  const result = await db
    .select({
      id: roomQueues.id,
      roomId: roomQueues.roomId,
      songId: roomQueues.songId,
      userSessionId: roomQueues.userSessionId,
      status: roomQueues.status,
      sortOrder: roomQueues.sortOrder,
      requestedAt: roomQueues.requestedAt,
      songTitle: sql<string>`COALESCE(${songs.title}, '')`,
      songArtist: sql<string>`COALESCE((
        SELECT GROUP_CONCAT(a2.name, '、')
        FROM ${songArtists} sa
        JOIN ${artists} a2 ON a2.id = sa.artist_id
        WHERE sa.song_id = ${sql.raw('songs.id')}
        ORDER BY sa.position
      ), '')`,
      fileType: songs.fileType,
      vocalsPath: songs.vocalsPath,
      instrumentalPath: songs.instrumentalPath,
      nickname: roomSessions.nickname,
    })
    .from(roomQueues)
    .leftJoin(songs, eq(roomQueues.songId, songs.id))
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(
      roomSessions,
      sql`${roomQueues.userSessionId} = CAST(${roomSessions.id} AS TEXT)`
    )
    .where(eq(roomQueues.roomId, roomId))
    .orderBy(roomQueues.sortOrder);

  return result as QueueListItem[];
}

/**
 * 确保队列中恰好有一项 status='playing'。
 * 若当前无 playing 项，则将 sortOrder 最小的 pending 项激活为 playing。
 * 使手机点歌/插队/取消/跳过之后，TV 端能自动继续播放。
 */
async function ensurePlayingItem(roomId: number): Promise<void> {
  const playing = await db
    .select({ id: roomQueues.id })
    .from(roomQueues)
    .where(and(eq(roomQueues.roomId, roomId), eq(roomQueues.status, 'playing')))
    .limit(1);
  if (playing.length > 0) {
    return;
  }
  const next = await db
    .select({ id: roomQueues.id })
    .from(roomQueues)
    .where(and(eq(roomQueues.roomId, roomId), eq(roomQueues.status, 'pending')))
    .orderBy(roomQueues.sortOrder)
    .limit(1);
  if (next.length > 0) {
    await db
      .update(roomQueues)
      .set({ status: 'playing' })
      .where(eq(roomQueues.id, next[0].id));
  }
}

/**
 * 查询房间最新队列并推送 QUEUE_UPDATED 到房间内所有 WebSocket 客户端。
 * 供 addToQueue/insertNext/skipQueue 复用。
 */
async function notifyQueueUpdated(roomId: number): Promise<void> {
  await ensurePlayingItem(roomId);
  const room = await getRoomById(roomId);
  if (!room) {
    return;
  }
  const items = await getQueue(roomId);
  const queue: QueueItem[] = items.map((item) => ({
    id: item.id,
    songId: item.songId ?? 0,
    songTitle: item.songTitle,
    songArtist: item.songArtist,
    userSessionId: item.userSessionId ?? '',
    nickname: item.nickname ?? '',
    fileType: item.fileType ?? null,
    status: item.status ?? 'pending',
    sortOrder: item.sortOrder ?? 0,
    requestedAt: item.requestedAt ? item.requestedAt.toISOString() : '',
    vocalsPath: item.vocalsPath ?? null,
    instrumentalPath: item.instrumentalPath ?? null,
  }));
  broadcastQueueUpdated(room.code, { queue, queueVersion: nextQueueVersion(roomId) });
}

/**
 * 取消点歌：移除队列中待播放的歌曲项。
 * - 仅允许取消 pending 状态；正在播放/已播放不可取消
 * - 传入 userSessionId 时校验归属（手机端只能取消自己点的歌）
 * 成功后推送 QUEUE_UPDATED。
 */
export async function removeFromQueue(
  roomId: number,
  queueItemId: number,
  sessionToken: string,
): Promise<RoomQueue | null> {
  return withRoomLock(roomId, async () => {
    const actor = await assertMobileRoomControl(roomId, sessionToken);
    return removeFromQueueInternal(roomId, queueItemId, String(actor.sessionId));
  });
}

/**
 * 取消点歌（锁内执行）：移除队列中待播放的歌曲项。
 * - 仅允许取消 pending 状态；正在播放/已播放不可取消
 * - 传入 userSessionId 时校验归属（手机端只能取消自己点的歌）
 * 成功后推送 QUEUE_UPDATED。
 */
async function removeFromQueueInternal(
  roomId: number,
  queueItemId: number,
  userSessionId: string,
): Promise<RoomQueue | null> {
  const existing = await db
    .select()
    .from(roomQueues)
    .where(and(eq(roomQueues.id, queueItemId), eq(roomQueues.roomId, roomId)))
    .limit(1);

  if (existing.length === 0) {
    return null;
  }

  const item = existing[0];
  if (item.status === 'playing' || item.status === 'played') {
    throw new Error('正在播放或已播放的歌曲无法取消');
  }
  if (String(item.userSessionId) !== userSessionId) {
    throw new Error('只能取消自己点的歌曲');
  }

  await db.delete(roomQueues).where(eq(roomQueues.id, queueItemId)).run();
  await notifyQueueUpdated(roomId);
  return item;
}

/**
 * 加入队列：创建 room_queues 记录 status='pending', sortOrder=当前最大+1。
 * 成功后向房间推送 QUEUE_UPDATED。
 */
export async function addToQueue(
  roomId: number,
  params: QueueAddParams
): Promise<RoomQueue> {
  return withRoomLock(roomId, async () => {
    const actor = await assertMobileRoomControl(roomId, params.sessionToken);
    return addToQueueInternal(roomId, {
      songId: params.songId,
      userSessionId: String(actor.sessionId),
      nickname: params.nickname,
    });
  });
}

/**
 * 加入队列（锁内执行）：创建 room_queues 记录 status='pending', sortOrder=当前最大+1。
 * 成功后向房间推送 QUEUE_UPDATED。
 */
async function addToQueueInternal(
  roomId: number,
  params: { songId: number; userSessionId: string; nickname?: string },
): Promise<RoomQueue> {
  await assertSongExists(params.songId);
  await assertNotInQueue(roomId, params.songId);

  const maxResult = await db
    .select({ maxSort: sql<number>`COALESCE(MAX(${roomQueues.sortOrder}), 0)` })
    .from(roomQueues)
    .where(eq(roomQueues.roomId, roomId));

  const nextSort = (maxResult[0]?.maxSort ?? 0) + 1;

  const [item] = await db
    .insert(roomQueues)
    .values({
      roomId,
      songId: params.songId,
      userSessionId: String(params.userSessionId),
      status: 'pending',
      sortOrder: nextSort,
      requestedAt: new Date(),
    })
    .returning();

  await notifyQueueUpdated(roomId);
  return item;
}

/**
 * 校验歌曲仍存在（已播列表重新加入时歌曲可能已被删除）
 */
async function assertSongExists(songId: number): Promise<void> {
  const found = await db
    .select({ id: songs.id })
    .from(songs)
    .where(eq(songs.id, songId))
    .limit(1);
  if (found.length === 0) {
    throw new Error('歌曲不存在或已删除');
  }
}

/**
 * 校验歌曲不在待播队列（status='playing' 或 'pending'）。
 * 多个 H5 用户并发点歌时，per-room 锁内串行执行，保证不会出现重复添加。
 * 已播放/已跳过的历史项不拦截（允许重新点歌）。
 */
async function assertNotInQueue(roomId: number, songId: number): Promise<void> {
  const existing = await db
    .select({ id: roomQueues.id })
    .from(roomQueues)
    .where(
      and(
        eq(roomQueues.roomId, roomId),
        eq(roomQueues.songId, songId),
        inArray(roomQueues.status, ['pending', 'playing'])
      )
    )
    .limit(1);
  if (existing.length > 0) {
    throw createAppError('歌曲已在待播队列中', 400);
  }
}

/**
 * 一键清除已播记录：删除 status 为 played/skipped 的队列项。
 * 成功后向房间推送 QUEUE_UPDATED。
 */
export async function clearPlayedQueue(roomId: number, sessionToken: string): Promise<number> {
  return withRoomLock(roomId, async () => {
    await assertMobileRoomControl(roomId, sessionToken);
    const deleted = await db
      .delete(roomQueues)
      .where(
        and(
          eq(roomQueues.roomId, roomId),
          inArray(roomQueues.status, ['played', 'skipped'])
        )
      )
      .run();
    await notifyQueueUpdated(roomId);
    return deleted.changes ?? 0;
  });
}

/**
 * 置顶下一首：找到当前 playing 的下一首位置插入
 * - 若无 playing 项，则退化为 addToQueue（插入到队列末尾，由其推送 QUEUE_UPDATED）
 * - 若有 playing 项（sortOrder=N），将其后所有 pending 项 sortOrder+1，
 *   新项插入到 N+1 位置，成功后推送 QUEUE_UPDATED。
 */
export async function insertNext(
  roomId: number,
  params: QueueInsertNextParams
): Promise<RoomQueue> {
  return withRoomLock(roomId, async () => {
    const actor = await assertMobileRoomControl(roomId, params.sessionToken);
    return insertNextInternal(roomId, {
      songId: params.songId,
      userSessionId: String(actor.sessionId),
    });
  });
}

/**
 * 置顶下一首（锁内执行）：找到当前 playing 的下一首位置插入
 * - 若无 playing 项，则退化为 addToQueueInternal（插入到队列末尾，由其推送 QUEUE_UPDATED）
 * - 若有 playing 项（sortOrder=N），将其后所有 pending 项 sortOrder+1，
 *   新项插入到 N+1 位置，成功后推送 QUEUE_UPDATED。
 */
async function insertNextInternal(
  roomId: number,
  params: { songId: number; userSessionId: string },
): Promise<RoomQueue> {
  await assertSongExists(params.songId);
  await assertNotInQueue(roomId, params.songId);

  const playing = await db
    .select()
    .from(roomQueues)
    .where(and(eq(roomQueues.roomId, roomId), eq(roomQueues.status, 'playing')))
    .limit(1);

  // 无正在播放项，退化为追加到末尾（addToQueueInternal 内部会推送 QUEUE_UPDATED）
  if (playing.length === 0) {
    return addToQueueInternal(roomId, {
      songId: params.songId,
      userSessionId: params.userSessionId,
    });
  }

  const playingSort = playing[0].sortOrder ?? 0;

  // 将 playing 之后的所有 pending 项 sortOrder + 1
  await db
    .update(roomQueues)
    .set({ sortOrder: sql`${roomQueues.sortOrder} + 1` })
    .where(
      and(
        eq(roomQueues.roomId, roomId),
        eq(roomQueues.status, 'pending'),
        sql`${roomQueues.sortOrder} > ${playingSort}`
      )
    );

  const [item] = await db
    .insert(roomQueues)
    .values({
      roomId,
      songId: params.songId,
      userSessionId: String(params.userSessionId),
      status: 'pending',
      sortOrder: playingSort + 1,
      requestedAt: new Date(),
    })
    .returning();

  await notifyQueueUpdated(roomId);
  return item;
}

/**
 * 顶歌：把指定 pending 队列项移动到待播最前（playing 之后第一位）。
 * - 仅允许顶自己点的歌（userSessionId 归属校验，与取消点歌一致）
 * - 目标位置：有 playing 项时为 playingSort+1，否则为待播最小 sortOrder-1
 * - 若该项已在最前，直接返回不修改。
 * 成功后推送 QUEUE_UPDATED。
 */
export async function topQueueItem(
  roomId: number,
  queueItemId: number,
  sessionToken: string,
): Promise<RoomQueue | null> {
  return withRoomLock(roomId, async () => {
    const actor = await assertMobileRoomControl(roomId, sessionToken);
    return topQueueItemInternal(roomId, queueItemId, String(actor.sessionId));
  });
}

/**
 * 顶歌（锁内执行）：把指定 pending 队列项移动到待播最前（playing 之后第一位）。
 * - 仅允许顶自己点的歌（userSessionId 归属校验，与取消点歌一致）
 * - 目标位置：有 playing 项时为 playingSort+1，否则为待播最小 sortOrder-1
 * - 若该项已在最前，直接返回不修改。
 * 成功后推送 QUEUE_UPDATED。
 */
async function topQueueItemInternal(
  roomId: number,
  queueItemId: number,
  userSessionId: string,
): Promise<RoomQueue | null> {
  const [item] = await db
    .select()
    .from(roomQueues)
    .where(and(eq(roomQueues.id, queueItemId), eq(roomQueues.roomId, roomId)))
    .limit(1);

  if (!item) return null;
  if (item.status !== 'pending') {
    throw new Error('只能置顶待播队列中的歌曲');
  }
  if (String(item.userSessionId) !== userSessionId) {
    throw new Error('只能置顶自己点的歌曲');
  }

  // 计算目标位置（playing 之后的第一个位置）
  const [playing] = await db
    .select({ sortOrder: roomQueues.sortOrder })
    .from(roomQueues)
    .where(and(eq(roomQueues.roomId, roomId), eq(roomQueues.status, 'playing')))
    .limit(1);

  let target: number;
  if (playing?.sortOrder != null) {
    target = playing.sortOrder + 1;
  } else {
    const minResult = await db
      .select({ minSort: sql<number>`COALESCE(MIN(${roomQueues.sortOrder}), 0)` })
      .from(roomQueues)
      .where(and(eq(roomQueues.roomId, roomId), eq(roomQueues.status, 'pending')));
    target = (minResult[0]?.minSort ?? 0) - 1;
  }

  const itemSort = item.sortOrder ?? 0;
  if (itemSort === target) {
    return item;
  }

  // 向前移动：区间 [target, itemSort) 的 pending 项全部 +1 让位，再置该项为目标位置
  if (itemSort > target) {
    await db
      .update(roomQueues)
      .set({ sortOrder: sql`${roomQueues.sortOrder} + 1` })
      .where(
        and(
          eq(roomQueues.roomId, roomId),
          eq(roomQueues.status, 'pending'),
          sql`${roomQueues.sortOrder} >= ${target}`,
          sql`${roomQueues.sortOrder} < ${itemSort}`
        )
      );
    await db
      .update(roomQueues)
      .set({ sortOrder: target })
      .where(eq(roomQueues.id, queueItemId))
      .run();
  } else {
    // 异常/旧数据可能存在 pending 排在 playing 前面的情况。此时目标位置在当前项之后，
    // 直接做区间 -1 会与 playing 的 sortOrder 冲突，因此按当前顺序重排全部 pending。
    const pendingItems = await db
      .select({ id: roomQueues.id })
      .from(roomQueues)
      .where(and(eq(roomQueues.roomId, roomId), eq(roomQueues.status, 'pending')))
      .orderBy(roomQueues.sortOrder);
    const orderedIds = [
      queueItemId,
      ...pendingItems.filter(row => row.id !== queueItemId).map(row => row.id),
    ];
    for (let index = 0; index < orderedIds.length; index++) {
      await db
        .update(roomQueues)
        .set({ sortOrder: target + index })
        .where(eq(roomQueues.id, orderedIds[index]))
        .run();
    }
  }

  await notifyQueueUpdated(roomId);
  return { ...item, sortOrder: target };
}

/**
 * 跳过队列项：更新 status='skipped'（正常播完由 completeQueueItem 写 'played'）。
 * 成功后向房间推送 QUEUE_UPDATED。
 */
export async function skipQueue(
  roomId: number,
  params: QueueSkipParams
): Promise<RoomQueue | null> {
  return withRoomLock(roomId, async () => {
    await assertMobileRoomControl(roomId, params.sessionToken);
    return skipQueueInternal(roomId, params.queueItemId);
  });
}

/** TV 主动切歌：设备身份校验通过后执行同一幂等跳过逻辑。 */
export async function skipQueueByDevice(
  roomId: number,
  queueItemId: number,
  deviceId: string,
): Promise<RoomQueue | null> {
  return withRoomLock(roomId, async () => {
    await assertTvRoomControl(roomId, deviceId);
    return skipQueueInternal(roomId, queueItemId);
  });
}

/**
 * 跳过队列项（锁内执行）：更新 status='skipped'。
 *
 * 幂等保护：只接受 pending / playing 项。多台手机同时按「下一首」时，
 * 第二个请求携带的 queueItemId 可能已被前一个请求改为 skipped，
 * 此时不再重复推进队列（否则会连跳两首），直接返回 null 视为幂等成功。
 */
async function skipQueueInternal(
  roomId: number,
  queueItemId: number,
): Promise<RoomQueue | null> {
  const [item] = await db
    .update(roomQueues)
    .set({ status: 'skipped' })
    .where(
      and(
        eq(roomQueues.id, queueItemId),
        eq(roomQueues.roomId, roomId),
        inArray(roomQueues.status, ['pending', 'playing'])
      )
    )
    .returning();

  if (item) {
    await notifyQueueUpdated(roomId);
  }
  return item ?? null;
}

/**
 * 正常播完当前项：更新 status='played'。
 *
 * 与 skipQueue 的区别在于落库状态，便于 H5 区分「已播」与「被跳过」。
 * 同样只接受 playing 项，避免重复上报导致连续推进队列。
 */
export async function completeQueueItem(
  roomId: number,
  queueItemId: number,
  deviceId: string,
): Promise<RoomQueue | null> {
  return withRoomLock(roomId, async () => {
    await assertTvRoomControl(roomId, deviceId);
    const [item] = await db
      .update(roomQueues)
      .set({ status: 'played' })
      .where(
        and(
          eq(roomQueues.id, queueItemId),
          eq(roomQueues.roomId, roomId),
          eq(roomQueues.status, 'playing')
        )
      )
      .returning();

    if (item) {
      await notifyQueueUpdated(roomId);
    }
    return item ?? null;
  });
}

/**
 * 加入房间：校验 roomCode 存在、active、已授权且授权未过期，创建 room_sessions 记录
 */
/**
 * 查询房间当前 status='playing' 的队列项（无则返回 null）。
 * 供播放历史去重使用：以队列项 id 为键，重唱同一首歌会生成新项，仍能正常计入历史。
 */
export async function getPlayingQueueItem(roomId: number): Promise<RoomQueue | null> {
  const [item] = await db
    .select()
    .from(roomQueues)
    .where(and(eq(roomQueues.roomId, roomId), eq(roomQueues.status, 'playing')))
    .limit(1);
  return item ?? null;
}

export async function joinRoom(
  params: RoomSessionJoinParams
): Promise<
  RoomSession & {
    roomCode: string;
    sessionExpiresAt: Date;
    sessionToken: string;
  }
> {
  const room = await resolveRoomJoinTicket(params.authorizationCode, params.joinToken);
  if (room.status !== 'active') {
    throw new Error('房间未激活或已关闭');
  }
  if (room.authorized !== 1) {
    throw new Error('房间未授权，请管理员授权后加入');
  }
  if (
    room.authorizeType === 'temporary' &&
    room.authorizeExpiresAt &&
    room.authorizeExpiresAt.getTime() <= Date.now()
  ) {
    throw new Error('授权已过期，请管理员续期');
  }

  const [session] = await db
    .insert(roomSessions)
    .values({
      roomId: room.id,
      nickname: params.nickname,
      avatar: params.avatar ?? null,
      joinedAt: new Date(),
    })
    .returning();

  const sessionExpiresAt = getRoomSessionExpiresAt(session, room);
  const expiresInSeconds = Math.max(
    1,
    Math.floor((sessionExpiresAt.getTime() - Date.now()) / 1000),
  );
  const sessionToken = jwt.sign(
    { type: 'h5-room', roomId: room.id, sessionId: session.id },
    config.jwtSecret,
    { expiresIn: expiresInSeconds },
  );
  return {
    ...session,
    roomCode: room.code,
    sessionExpiresAt,
    sessionToken,
  };
}

/**
 * 离开房间：更新 leftAt=now
 */
export async function leaveRoom(
  sessionId: number
): Promise<RoomSession | null> {
  const [session] = await db
    .update(roomSessions)
    .set({ leftAt: new Date() })
    .where(eq(roomSessions.id, sessionId))
    .returning();
  return session ?? null;
}
