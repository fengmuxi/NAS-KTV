/**
 * 下载服务客户端 - 调用 Python 下载微服务 (FastAPI, musicdl)
 *
 * 与 separator-client 一致：项目未安装 axios，使用 Node 内置 fetch。
 */
const DOWNLOADER_URL =
  process.env.DOWNLOADER_SERVICE_URL || 'http://localhost:8002';
const DEFAULT_TIMEOUT_MS = 30000;

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

export interface SearchResponse {
  search_id: string;
  total: number;
  results: SongDescriptor[];
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

export interface DownloadSubmitResponse {
  task_ids: string[];
  count: number;
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

class DownloaderClient {
  private async request<T>(
    apiPath: string,
    init?: RequestInit,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${DOWNLOADER_URL}${apiPath}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`downloader ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  getHealth() {
    return this.request<{ status: string; download_dir: string; enabled_sources: string[]; concurrency?: number }>(
      '/api/health',
      undefined,
      5000,
    );
  }

  /** 运行时推送配置到下载服务（enabledSources / concurrency 任一为 undefined 表示不修改）。 */
  configure(body: { enabledSources?: string[]; concurrency?: number }) {
    return this.request<{ status: string; enabled_sources: string[]; concurrency: number }>(
      '/api/config',
      {
        method: 'POST',
        body: JSON.stringify({
          enabled_sources: body.enabledSources,
          concurrency: body.concurrency,
        }),
      },
    );
  }

  getPlatforms() {
    return this.request<PlatformInfo[]>('/api/download/platforms');
  }

  submitSearch(keyword: string, sources?: string[]) {
    // 异步搜索：立即返回 search_id，结果经 getSearch 轮询获取（不再同步阻塞）。
    return this.request<SearchSubmitResponse>('/api/download/search', {
      method: 'POST',
      body: JSON.stringify({ keyword, sources }),
    });
  }

  getSearch(searchId: string) {
    return this.request<SearchResultResponse>(
      `/api/download/search/${encodeURIComponent(searchId)}`,
    );
  }

  submit(keys: string[]) {
    return this.request<DownloadSubmitResponse>('/api/download', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    });
  }

  getTask(taskId: string) {
    return this.request<TaskStatus>(`/api/download/${taskId}`);
  }

  cancel(taskId: string) {
    return this.request<{ task_id: string; status: string }>(
      `/api/download/${taskId}/cancel`,
      { method: 'POST' },
    );
  }
}

export const downloaderClient = new DownloaderClient();
