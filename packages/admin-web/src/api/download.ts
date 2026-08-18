import client from './client';
import type { ApiResponse } from '../types';

export interface PlatformInfo {
  key: string;
  id: string;
  label: string;
  enabled: boolean;
}

export interface SongDescriptor {
  key: string;
  source: string;
  source_label: string;
  song_name: string;
  singers?: string | null;
  album?: string | null;
  duration?: string | null;
  ext?: string | null;
  file_size?: string | null;
  lyric_available: boolean;
}

export interface SearchSubmitResponse {
  search_id: string;
  status: string;
}

export interface SearchResultResponse {
  search_id: string;
  status: 'pending' | 'done' | 'failed';
  keyword?: string;
  per_source?: Record<string, number>;
  total: number;
  results: SongDescriptor[];
  error?: string | null;
}

export interface TaskStatus {
  task_id: string;
  status: string;
  source?: string | null;
  song_name?: string | null;
  singers?: string | null;
  save_path?: string | null;
  error?: string | null;
  created_at: number;
  updated_at: number;
}

export interface DownloadConfig {
  platforms: PlatformInfo[];
  defaultSources: string[];
  concurrency: number;
}

export const downloadApi = {
  config: (): Promise<DownloadConfig> =>
    client
      .get<ApiResponse<DownloadConfig>>('/download/config')
      .then((res) => res.data.data),
  platforms: (): Promise<PlatformInfo[]> =>
    client
      .get<ApiResponse<PlatformInfo[]>>('/download/platforms')
      .then((res) => res.data.data),
  searchSubmit: (keyword: string, sources?: string[]): Promise<SearchSubmitResponse> =>
    client
      .post<ApiResponse<SearchSubmitResponse>>('/download/search', { keyword, sources })
      .then((res) => res.data.data),
  getSearch: (searchId: string): Promise<SearchResultResponse> =>
    client
      .get<ApiResponse<SearchResultResponse>>(`/download/search/${encodeURIComponent(searchId)}`)
      .then((res) => res.data.data),
  submit: (keys: string[]): Promise<{ task_ids: string[]; count: number }> =>
    client
      .post<ApiResponse<{ task_ids: string[]; count: number }>>('/download', { keys })
      .then((res) => res.data.data),
  tasks: (ids: string[]): Promise<TaskStatus[]> =>
    client
      .get<ApiResponse<TaskStatus[]>>('/download/tasks', {
        params: { ids: ids.join(',') },
      })
      .then((res) => res.data.data),
  cancel: (id: string): Promise<{ task_id: string; status: string }> =>
    client
      .post<ApiResponse<{ task_id: string; status: string }>>(
        `/download/${id}/cancel`,
      )
      .then((res) => res.data.data),
};
