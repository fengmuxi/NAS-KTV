import client from './client';
import type {
  Song,
  SongListParams,
  SongListResponse,
  ApiResponse,
} from '../types';

export interface SongCreateParams {
  title: string;
  artistId?: number | null;
  filePath: string;
  fileType: string;
  duration?: number;
  lyricsPath?: string | null;
}

export interface SongUpdateParams {
  title?: string;
  artistId?: number | null;
  /** 全部歌手 id（按顺序），重建多歌手关联；传空数组清空歌手 */
  artistIds?: number[];
  filePath?: string;
  fileType?: string;
  duration?: number;
  lyricsPath?: string | null;
  pitchDefault?: number;
}

export const songsApi = {
  list: (params?: SongListParams): Promise<SongListResponse> => {
    const queryParams: Record<string, unknown> = { ...params };
    if (params?.categoryItemIds && params.categoryItemIds.length > 0) {
      queryParams.categoryItemIds = params.categoryItemIds.join(',');
    } else {
      delete queryParams.categoryItemIds;
    }
    return client
      .get<ApiResponse<SongListResponse>>('/songs', { params: queryParams })
      .then((res) => res.data.data);
  },
  get: (id: number): Promise<Song> =>
    client
      .get<ApiResponse<Song>>(`/songs/${id}`)
      .then((res) => res.data.data),
  create: (data: SongCreateParams): Promise<Song> =>
    client
      .post<ApiResponse<Song>>('/songs', data)
      .then((res) => res.data.data),
  update: (id: number, data: SongUpdateParams): Promise<Song> =>
    client
      .put<ApiResponse<Song>>(`/songs/${id}`, data)
      .then((res) => res.data.data),
  updateCategories: (id: number, categoryItemIds: number[]): Promise<void> =>
    client
      .put<ApiResponse<null>>(`/songs/${id}/categories`, { categoryItemIds })
      .then(() => undefined),
  delete: (id: number): Promise<void> =>
    client.delete<ApiResponse<null>>(`/songs/${id}`).then(() => undefined),
  separate: (id: number): Promise<{ taskId: number; songId: number }> =>
    client
      .post<ApiResponse<{ taskId: number; songId: number }>>(`/songs/${id}/separate`)
      .then((res) => res.data.data),
  getLyricsRaw: (id: number): Promise<{ content: string }> =>
    client
      .get<ApiResponse<{ content: string }>>(`/songs/${id}/lyrics/raw`)
      .then((res) => res.data.data),
  saveLyrics: (
    id: number,
    content: string,
  ): Promise<{ lineCount: number; path: string }> =>
    client
      .put<ApiResponse<{ lineCount: number; path: string }>>(`/songs/${id}/lyrics`, {
        content,
      })
      .then((res) => res.data.data),
  clearLyrics: (id: number): Promise<void> =>
    client
      .delete<ApiResponse<null>>(`/songs/${id}/lyrics`)
      .then(() => undefined),
};
