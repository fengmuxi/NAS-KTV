import client from './client';
import type { ApiResponse } from '../types';

export interface SystemInfo {
  version: string;
  databasePath: string;
  storageUsedBytes: number;
  storageTotalBytes: number;
}

export interface DashboardStats {
  songs: {
    total: number;
    metadataComplete: number;
    metadataMissingTitle: number;
    metadataMissingArtist: number;
    hasLyrics: number;
    hasVocal: number;
    hasInstrumental: number;
  };
  artists: { total: number };
  rooms: { total: number; active: number };
  playback: { total: number; today: number };
  separation: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  aiParse: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    needReview: number;
  };
}

export interface DashboardHistory {
  labels: string[];
  playback: number[];
  separation: number[];
  aiParse: number[];
}

export interface BackendHealth {
  status: 'ok';
  version: string;
  uptimeSec: number;
}

export interface SeparatorHealth {
  status: 'ok' | 'down' | 'installing';
  healthy: boolean;
  device?: string;
  ffmpegAvailable?: boolean;
  modelLoaded?: boolean;
  queueSize?: number;
  installState: 'installed' | 'installing' | 'failed' | 'not_installed' | 'unknown';
  installProgress?: number;
  error?: string;
}

export interface ServicesHealth {
  backend: BackendHealth;
  separator: SeparatorHealth;
}

export const systemApi = {
  getInfo: (): Promise<SystemInfo> =>
    client
      .get<ApiResponse<SystemInfo>>('/system/info')
      .then((res) => res.data.data),
  getDashboard: (): Promise<DashboardStats> =>
    client
      .get<ApiResponse<DashboardStats>>('/system/dashboard')
      .then((res) => res.data.data),
  getDashboardHistory: (): Promise<DashboardHistory> =>
    client
      .get<ApiResponse<DashboardHistory>>('/system/dashboard/history')
      .then((res) => res.data.data),
  getHealth: (): Promise<ServicesHealth> =>
    client
      .get<ApiResponse<ServicesHealth>>('/system/health')
      .then((res) => res.data.data),
};
