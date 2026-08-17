export interface User {
  id: number;
  username: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Song {
  id: number;
  title: string;
  artistId: number | null;
  artistName?: string;
  artistNames?: string[];
  /** 全部歌手 id（按顺序，详情接口返回，编辑回填用） */
  artistIds?: number[];
  filePath: string;
  fileType: string;
  duration: number;
  lyricsPath: string | null;
  aiParsed: number;
  separationStatus?: string | null;
  createdAt: string;
  categories?: { categoryId: number; categoryName: string; categoryItemId: number; categoryItemName: string }[];
}

export interface SongListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  artistId?: number;
  categoryItemIds?: number[];
  categoryId?: number;
}

export interface SongListResponse {
  items: Song[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Artist {
  id: number;
  name: string;
  pinyin: string;
  firstLetter: string;
  songCount: number;
  bio: string | null;
  avatar: string | null;
}

export interface ArtistListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface Category {
  id: number;
  name: string;
  sortOrder: number;
  items?: CategoryItem[];
}

export interface CategoryGroup {
  id: number;
  name: string;
  sortOrder: number;
  items?: CategoryItem[];
}

export interface CategoryItem {
  id: number;
  categoryId: number;
  name: string;
  sortOrder: number;
  songCount?: number;
}

export interface Device {
  id: number;
  deviceId: string;
  roomCode: string;
  deviceName: string;
  authorized: number;
  authorizeType: string | null;
  authorizeExpiresAt: string | null;
  lastActiveAt: string | null;
  status: string | null;
  isOnline?: boolean;
  memberCount?: number;
}

export interface Room {
  id: number;
  roomCode: string;
  name?: string;
}

export interface AuthorizeParams {
  authorizeType: string;
  expiresAt?: string;
}

export interface ScanStatus {
  isScanning: boolean;
  scanId: string | null;
  startTime: number | null;
  currentFile: string | null;
  processed: number;
  total: number;
  newSongs: number;
  updatedSongs: number;
  skippedSongs: number;
  errors: string[];
}

export interface ScanTaskResult {
  newSongs: number;
  updatedSongs: number;
  skippedSongs: number;
  errorCount: number;
  totalSongs: number;
  errors: string[];
}

export interface ScanTask {
  id: string;
  scanPath: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';
  result?: ScanTaskResult;
  error?: string;
}

export interface AiParseConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface AiParseTask {
  id: number;
  songId: number;
  status: string;
  model: string;
  result: string | null;
  confidence: number | null;
  needReview: number;
  createdAt: string;
  completedAt: string | null;
}

export interface AiParseResult {
  title?: string;
  artist?: string;
  lyricsPath?: string;
  [key: string]: unknown;
}

export interface SeparationTask {
  id: number;
  songId: number;
  status: string;
  model: string;
  progress: number;
  stage: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SeparationTaskListParams {
  page?: number;
  pageSize?: number;
  status?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
