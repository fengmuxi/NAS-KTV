import { eq, sql, desc, and, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import type {
  Device,
  DeviceListParams,
  AuthorizeParams,
  DeviceRenewParams,
  DeviceRenameParams,
} from '@nasktv/shared';
import {
  broadcastRoomAuthorized,
  broadcastRoomUnauthorized,
  broadcastRoomClosed,
  isRoomTvOnline,
} from '../ws/room-handler';

const { rooms, roomQueues, roomSessions } = schema;

/**
 * 设备列表：分页+过滤（基于 rooms 表的设备视角）
 * 返回 { items: Device[], total: number }
 */
export async function listDevices(
  params: DeviceListParams
): Promise<{ items: Device[]; total: number; limit: number; offset: number }> {
  const { status, page = 1, limit = 20 } = params;
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;

  const whereClause = status
    ? eq(rooms.status, status as NonNullable<typeof rooms.$inferInsert.status>)
    : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(rooms)
    .where(whereClause);

  // SQLite count(*) 经 better-sqlite3 返回 number，但用 Number() 兜底防止
  // drizzle 运行时返回 string 导致前端 total > pageSize 比较异常
  const total = Number(countResult[0]?.count ?? 0);

  const rows = await db
    .select({
      id: rooms.id,
      code: rooms.code,
      deviceId: rooms.deviceId,
      name: rooms.name,
      authorized: rooms.authorized,
      authorizeType: rooms.authorizeType,
      authorizeExpiresAt: rooms.authorizeExpiresAt,
      status: rooms.status,
      lastActiveAt: rooms.lastActiveAt,
      createdAt: rooms.createdAt,
      // 房间当前在房人数：room_sessions 中 leftAt 为空的会话数
      memberCount: sql<number>`(
        SELECT COUNT(*) FROM ${roomSessions}
        WHERE ${roomSessions.roomId} = ${rooms.id}
          AND ${roomSessions.leftAt} IS NULL
      )`,
    })
    .from(rooms)
    .where(whereClause)
    .orderBy(desc(rooms.createdAt))
    .limit(safeLimit)
    .offset(offset);

  // 惰性撤销：临时授权已过期但未被定时任务撤销的记录，立即收敛（写库+广播）。
  // 与 index.ts 的 revokeExpiredAuthorizations 幂等，保证列表状态始终与过期时间一致。
  const now = Date.now();
  for (const row of rows) {
    if (
      row.authorized === 1 &&
      row.authorizeType === 'temporary' &&
      row.authorizeExpiresAt &&
      row.authorizeExpiresAt.getTime() <= now
    ) {
      await db
        .update(rooms)
        .set({ authorized: 0, status: 'revoked' })
        .where(eq(rooms.id, row.id))
        .run();
      await expireActiveSessions(row.id);
      broadcastRoomUnauthorized(row.code, { roomCode: row.code, reason: 'expired' });
      row.authorized = 0;
      row.status = 'revoked';
    }
  }

  // 映射为前端期望的字段名（roomCode / deviceName）
  const items = rows.map((row) =>
    mapRoomToDevice({
      ...row,
      memberCount: Number(row.memberCount ?? 0),
    })
  );
  return { items, total, limit: safeLimit, offset };
}

/**
 * 授权设备：authorized=1, authorizeType, authorizeExpiresAt, authorizedAt=now, status='active'。
 * 成功后向房间推送 ROOM_AUTHORIZED。
 */
export async function authorizeDevice(
  id: number,
  params: AuthorizeParams
): Promise<Device | null> {
  const expiresAt = params.expiresAt ? new Date(params.expiresAt) : null;
  const [before] = await db
    .select({ authorized: rooms.authorized, status: rooms.status })
    .from(rooms)
    .where(eq(rooms.id, id))
    .limit(1);

  const [room] = await db
    .update(rooms)
    .set({
      authorized: 1,
      authorizeType: params.authorizeType,
      authorizeExpiresAt: expiresAt,
      authorizedAt: new Date(),
      status: 'active',
    })
    .where(eq(rooms.id, id))
    .returning();

  if (!room) {
    return null;
  }

  // 从未授权/已撤销进入新授权周期时，旧 H5 session 不得复活。
  if (!before || before.authorized !== 1 || before.status !== 'active') {
    await expireActiveSessions(id);
  }

  broadcastRoomAuthorized(room.code, {
    roomCode: room.code,
    roomName: room.name ?? '',
    authorizeType: params.authorizeType,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  });

  return mapRoomToDevice(room);
}

/**
 * 撤销设备授权：authorized=0, status='revoked'。
 * 成功后向房间推送 ROOM_UNAUTHORIZED。
 */
export async function revokeDevice(id: number): Promise<Device | null> {
  const [room] = await db
    .update(rooms)
    .set({ authorized: 0, status: 'revoked' })
    .where(eq(rooms.id, id))
    .returning();

  if (!room) {
    return null;
  }

  await expireActiveSessions(id);

  broadcastRoomUnauthorized(room.code, {
    roomCode: room.code,
    reason: 'manual_revoke',
  });

  return mapRoomToDevice(room);
}

async function expireActiveSessions(roomId: number): Promise<void> {
  await db
    .update(roomSessions)
    .set({ leftAt: new Date() })
    .where(and(eq(roomSessions.roomId, roomId), isNull(roomSessions.leftAt)))
    .run();
}

/**
 * 续期设备授权：更新 authorizeExpiresAt
 */
export async function renewDevice(
  id: number,
  params: DeviceRenewParams
): Promise<Device | null> {
  const expiresAt = params.expiresAt ? new Date(params.expiresAt) : null;

  const [room] = await db
    .update(rooms)
    .set({ authorizeExpiresAt: expiresAt })
    .where(eq(rooms.id, id))
    .returning();

  if (!room) {
    return null;
  }

  return mapRoomToDevice(room);
}

/**
 * 重命名设备：更新 name
 */
export async function renameDevice(
  id: number,
  params: DeviceRenameParams
): Promise<Device | null> {
  const [room] = await db
    .update(rooms)
    .set({ name: params.name })
    .where(eq(rooms.id, id))
    .returning();

  if (!room) {
    return null;
  }

  return mapRoomToDevice(room);
}

/**
 * 删除设备：硬删除 rooms 记录及关联的队列、会话数据。
 * 删除前先广播 ROOM_CLOSED（reason: 'deleted'），让在线 TV 端重新生成设备信息。
 * 返回被删除的设备，若不存在返回 null。
 */
export async function deleteDevice(id: number): Promise<Device | null> {
  // 先查询记录，用于广播和返回
  const [room] = await db
    .select()
    .from(rooms)
    .where(eq(rooms.id, id))
    .limit(1);

  if (!room) {
    return null;
  }

  // 广播 ROOM_DELETED 通知在线 TV 端重新生成设备信息
  broadcastRoomClosed(room.code, {
    roomCode: room.code,
    reason: 'deleted',
  });

  // 级联删除关联数据（SQLite 未设置 ON DELETE CASCADE，需手动清理）
  await db.delete(roomQueues).where(eq(roomQueues.roomId, id));
  await db.delete(roomSessions).where(eq(roomSessions.roomId, id));

  // 删除 rooms 记录
  await db.delete(rooms).where(eq(rooms.id, id));

  return mapRoomToDevice(room);
}

/**
 * 将 rooms 表记录映射为 Device 视图（选取设备相关字段）
 * 注意：API 响应使用 roomCode / deviceName 字段名（匹配前端类型）
 */
function mapRoomToDevice(
  room: Pick<
    typeof rooms.$inferSelect,
    | 'id'
    | 'code'
    | 'deviceId'
    | 'name'
    | 'authorized'
    | 'authorizeType'
    | 'authorizeExpiresAt'
    | 'status'
    | 'lastActiveAt'
    | 'createdAt'
  > & { memberCount?: number }
): Device {
  return {
    id: room.id,
    code: room.code,
    roomCode: room.code,
    deviceId: room.deviceId,
    name: room.name,
    deviceName: room.name,
    authorized: room.authorized,
    authorizeType: room.authorizeType,
    authorizeExpiresAt: room.authorizeExpiresAt,
    status: room.status,
    lastActiveAt: room.lastActiveAt,
    createdAt: room.createdAt,
    isOnline: isRoomTvOnline(room.code),
    memberCount: room.memberCount,
  } as Device;
}
