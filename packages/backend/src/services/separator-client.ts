/**
 * 分离服务客户端 - 调用 Python 分离微服务 (FastAPI)
 *
 * 注：项目未安装 axios，使用 Node 18+ 内置 fetch 实现，
 * 接口与 axios 版本保持一致。
 */

const SEPARATOR_URL =
  process.env.SEPARATOR_SERVICE_URL || 'http://localhost:8001';
const DEFAULT_TIMEOUT_MS = 30000;
// torch 探测/安装状态查询可能触发慢速子进程，放宽超时避免首次请求 502
const INSTALL_TIMEOUT_MS = 60000;

export const SEPARATION_MODELS = [
  'htdemucs',
  'htdemucs_ft',
  'mdx_extra',
  'sdx_extra',
  'bsrnn',
] as const;

export type SeparationModel = (typeof SEPARATION_MODELS)[number];

export interface SeparationTaskRequest {
  input_path: string;
  output_dir: string;
  model?: SeparationModel;
  callback_url?: string;
}

export interface SeparationTaskResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message?: string;
  progress?: number;
  stage?: 'extracting' | 'separating' | 'encoding' | 'done' | null;
  vocals_path?: string | null;
  instrumental_path?: string | null;
  error?: string | null;
  created_at?: number;
  started_at?: number;
  completed_at?: number;
}

export interface SeparationHealthResponse {
  status: string;
  device?: string;
  ffmpeg_available?: boolean;
  model_loaded?: boolean;
  queue_size?: number;
}

export interface GpuInfo {
  available: boolean;
  name?: string | null;
  memory_mb?: number | null;
  driver_version?: string | null;
  driver_cuda_version?: string | null;
  cuda_available: boolean;
  torch_version?: string | null;
  torch_cuda_version?: string | null;
  venv_exists: boolean;
  torch_available?: boolean;
  install_state?: 'installed' | 'installing' | 'failed' | 'not_installed' | 'unknown';
  install_stage?: string | null;
  install_progress?: number;
}

export interface InstallStatus {
  state: 'installed' | 'installing' | 'failed' | 'not_installed';
  mode?: string | null;
  target?: string | null;
  stage?: string | null;
  progress: number;
  error?: string | null;
  torch_available: boolean;
  torch_version?: string | null;
  torch_cuda_version?: string | null;
  demucs_available: boolean;
  demucs_version?: string | null;
  install_dir: string;
  wheel_files: string[];
  logs: string[];
  started_at?: number | null;
  finished_at?: number | null;
  reason?: string | null;
}

class SeparatorClient {
  private baseURL: string;
  private timeoutMs: number;

  constructor(baseURL: string = SEPARATOR_URL, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.baseURL = baseURL;
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          // FastAPI 错误格式: { detail: "..." }
          const msg = (errBody as any)?.detail || (errBody as any)?.error;
          if (msg) detail = typeof msg === 'string' ? msg : JSON.stringify(msg);
        } catch {
          // 忽略 JSON 解析错误
        }
        throw new Error(`Separator service error: ${detail}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async createSeparationTask(
    params: SeparationTaskRequest,
  ): Promise<SeparationTaskResponse> {
    return this.request<SeparationTaskResponse>('POST', '/api/separate', params);
  }

  async getTaskStatus(taskId: string): Promise<SeparationTaskResponse> {
    return this.request<SeparationTaskResponse>(
      'GET',
      `/api/separate/${encodeURIComponent(taskId)}`,
    );
  }

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      await this.request<unknown>(
        'DELETE',
        `/api/separate/${encodeURIComponent(taskId)}`,
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return false;
      }
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const data = await this.request<SeparationHealthResponse>(
        'GET',
        '/api/health',
        undefined,
        5000,
      );
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  async getGpuInfo(): Promise<GpuInfo> {
    return this.request<GpuInfo>('GET', '/api/gpu/info', undefined, INSTALL_TIMEOUT_MS);
  }

  async installGpu(proxy?: string): Promise<Response> {
    const qs = proxy ? `?proxy=${encodeURIComponent(proxy)}` : '';
    return fetch(`${this.baseURL}/api/gpu/install-gpu${qs}`, {
      method: 'POST',
    });
  }

  async installCpu(proxy?: string): Promise<Response> {
    const qs = proxy ? `?proxy=${encodeURIComponent(proxy)}` : '';
    return fetch(`${this.baseURL}/api/gpu/install-cpu${qs}`, {
      method: 'POST',
    });
  }

  async getInstallStatus(): Promise<InstallStatus> {
    return this.request<InstallStatus>('GET', '/api/install/status', undefined, INSTALL_TIMEOUT_MS);
  }

  async triggerInstall(body: {
    target?: 'auto' | 'cpu' | 'cuda';
    mode?: 'pip' | 'wheel';
    proxy?: string;
  }): Promise<{ accepted: boolean; message: string }> {
    return this.request<{ accepted: boolean; message: string }>(
      'POST',
      '/api/install/trigger',
      body,
    );
  }

  async uploadInstallFile(filename: string, buffer: Buffer, mimetype: string): Promise<{
    uploaded: string;
    wheel_files: string[];
    install_state: string;
    auto_started: boolean;
    message: string;
  }> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }), filename);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${this.baseURL}/api/install/upload`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          const msg = (errBody as any)?.detail;
          if (msg) detail = typeof msg === 'string' ? msg : JSON.stringify(msg);
        } catch {
          // 忽略 JSON 解析错误
        }
        throw new Error(`Separator service error: ${detail}`);
      }
      return (await response.json()) as {
        uploaded: string;
        wheel_files: string[];
        install_state: string;
        auto_started: boolean;
        message: string;
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const separatorClient = new SeparatorClient();
