import type { rooms } from '../schema';

// 设备授权参数
export interface AuthorizeParams {
  authorizeType: 'permanent' | 'temporary';
  expiresAt?: string;
}

// 设备列表查询参数
export interface DeviceListParams {
  status?: string;
  page?: number;
  limit?: number;
}

// 设备续期参数
export interface DeviceRenewParams {
  expiresAt?: string;
}

// 设备重命名参数
export interface DeviceRenameParams {
  name: string;
}

// 设备视图（基于 rooms 表的设备视角，选取设备相关字段）
// roomCode / deviceName 为 API 响应的别名（对应 rooms.code / rooms.name）
export type Device = Pick<
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
> & {
  roomCode: string;
  deviceName: string | null;
  /** TV 设备当前是否在线（基于 WS 连接注册表，近实时） */
  isOnline?: boolean;
  /** 房间当前在房人数（room_sessions 中 leftAt 为空的会话数） */
  memberCount?: number;
};
