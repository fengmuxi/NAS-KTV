import client from './client';
import type { ApiResponse } from '../types';

export interface AiParseTask {
  id: number;
  songId: number;
  status: string;
  model: string;
  promptTemplate: string | null;
  requestMessages: string | null;
  responseRaw: string | null;
  result: string | null;
  error: string | null;
  confidence: number | null;
  needReview: number;
  originalTitle: string | null;
  originalArtistId: number | null;
  originalArtistName: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  song?: { id: number; title: string; filePath: string; artistName?: string; artistNames?: string[] };
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface PromptTemplate {
  systemPrompt: string;
  userPromptTemplate: string;
}

export interface AiParseTaskListParams {
  limit?: number;
  offset?: number;
  status?: string;
}

export interface AiParseReviewParams {
  action: 'approve' | 'reject' | 'modify';
  modifiedResult?: Record<string, unknown>;
}

export interface AiParseStats {
  pending: number;
  completed: number;
  failed: number;
  needReview: number;
}

export const aiParseApi = {
  getConfig: (): Promise<AiConfig> =>
    client.get<ApiResponse<AiConfig>>('/ai-parse/config').then(r => r.data.data),

  updateConfig: (config: Partial<AiConfig>): Promise<AiConfig> =>
    client.put<ApiResponse<AiConfig>>('/ai-parse/config', config).then(r => r.data.data),

  testConnection: (): Promise<{ success: boolean; message: string; model?: string }> =>
    client.post<ApiResponse<{ success: boolean; message: string; model?: string }>>('/ai-parse/test').then(r => r.data.data),

  getPrompt: (): Promise<PromptTemplate> =>
    client.get<ApiResponse<PromptTemplate>>('/ai-parse/prompt').then(r => r.data.data),

  updatePrompt: (template: PromptTemplate): Promise<void> =>
    client.put<ApiResponse<null>>('/ai-parse/prompt', template).then(() => undefined),

  getTasks: (params?: AiParseTaskListParams): Promise<{ items: AiParseTask[]; total: number; limit: number; offset: number }> =>
    client.get<ApiResponse<{ items: AiParseTask[]; total: number; limit: number; offset: number }>>('/ai-parse/tasks', { params }).then(r => r.data.data),

  getTask: (id: number): Promise<AiParseTask & { song: { id: number; title: string; filePath: string; artistName?: string; artistNames?: string[] } }> =>
    client.get<ApiResponse<AiParseTask & { song: { id: number; title: string; filePath: string; artistName?: string; artistNames?: string[] } }>>(`/ai-parse/tasks/${id}`).then(r => r.data.data),

  getTaskBySongId: (songId: number): Promise<AiParseTask> =>
    client.get<ApiResponse<AiParseTask>>(`/ai-parse/tasks/by-song/${songId}`).then(r => r.data.data),

  trigger: (songId: number): Promise<{ taskId: number }> =>
    client.post<ApiResponse<{ taskId: number }>>('/ai-parse/trigger', { songId }).then(r => r.data.data),

  batchTrigger: (songIds: number[]): Promise<{ taskIds: number[]; count: number }> =>
    client.post<ApiResponse<{ taskIds: number[]; count: number }>>('/ai-parse/batch', { songIds }).then(r => r.data.data),

  rollback: (taskId: number): Promise<void> =>
    client.post<ApiResponse<null>>(`/ai-parse/tasks/${taskId}/rollback`).then(() => undefined),

  reparse: (taskId: number): Promise<{ taskId: number }> =>
    client.post<ApiResponse<{ taskId: number }>>(`/ai-parse/tasks/${taskId}/reparse`).then(r => r.data.data),

  review: (taskId: number, data: AiParseReviewParams): Promise<void> =>
    client.post<ApiResponse<null>>(`/ai-parse/tasks/${taskId}/review`, data).then(() => undefined),

  retry: (taskId: number): Promise<AiParseTask> =>
    client.post<ApiResponse<AiParseTask>>(`/ai-parse/tasks/${taskId}/retry`).then(r => r.data.data),

  batchParse: (songIds: number[]): Promise<{ taskIds: number[]; count: number }> =>
    client.post<ApiResponse<{ taskIds: number[]; count: number }>>('/ai-parse/batch', { songIds }).then(r => r.data.data),

  getStats: (): Promise<AiParseStats> =>
    client.get<ApiResponse<AiParseStats>>('/ai-parse/stats').then(r => r.data.data),

  deleteTask: (taskId: number): Promise<void> =>
    client.delete<ApiResponse<null>>(`/ai-parse/tasks/${taskId}`).then(() => undefined),

  deleteBatch: (taskIds: number[]): Promise<{ deleted: number }> =>
    client.post<ApiResponse<{ deleted: number }>>('/ai-parse/tasks/delete-batch', { taskIds }).then(r => r.data.data),

  reviewTask: (taskId: number, data: AiParseReviewParams): Promise<void> =>
    client.post<ApiResponse<null>>(`/ai-parse/tasks/${taskId}/review`, data).then(() => undefined),
};
