import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { songs } from './songs';

export const rooms = sqliteTable('rooms', {
  id: integer('id').primaryKey(),
  code: text('code').unique().notNull(),
  deviceId: text('device_id').unique().notNull(),
  name: text('name'),
  authorized: integer('authorized').default(0),
  authorizedAt: integer('authorized_at', { mode: 'timestamp' }),
  authorizedBy: integer('authorized_by'),
  authorizeType: text('authorize_type', { enum: ['permanent', 'temporary'] }),
  authorizeExpiresAt: integer('authorize_expires_at', { mode: 'timestamp' }),
  status: text('status', {
    enum: ['pending', 'active', 'closed', 'revoked'],
  }),
  deviceInfo: text('device_info'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  lastActiveAt: integer('last_active_at', { mode: 'timestamp' }),
  currentJoinCode: text('current_join_code'),
  joinCodeExpiresAt: integer('join_code_expires_at', { mode: 'timestamp' }),
});

export const roomQueues = sqliteTable('room_queues', {
  id: integer('id').primaryKey(),
  roomId: integer('room_id').references(() => rooms.id),
  songId: integer('song_id').references(() => songs.id),
  userSessionId: text('user_session_id'),
  status: text('status', {
    enum: ['pending', 'playing', 'played', 'skipped'],
  }),
  sortOrder: integer('sort_order').default(0),
  requestedAt: integer('requested_at', { mode: 'timestamp' }),
});

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type RoomQueue = typeof roomQueues.$inferSelect;
export type NewRoomQueue = typeof roomQueues.$inferInsert;
