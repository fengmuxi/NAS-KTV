import client from './client';
import type { ApiResponse } from '../types';

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

export const separatorApi = {
  getGpuInfo: (): Promise<GpuInfo> =>
    client.get<ApiResponse<GpuInfo>>('/separator/gpu/info', { timeout: 60000 })
      .then(res => res.data.data),

  getInstallStatus: (): Promise<InstallStatus> =>
    client.get<ApiResponse<InstallStatus>>('/separator/gpu/install/status', { timeout: 60000 })
      .then(res => res.data.data),

  triggerInstall: (body: { target?: 'auto' | 'cpu' | 'cuda'; mode?: 'pip' | 'wheel' }): Promise<{
    accepted: boolean;
    message: string;
  }> =>
    client.post<ApiResponse<{ accepted: boolean; message: string }>>(
      '/separator/gpu/install/trigger',
      body,
    ).then(res => res.data.data),

  uploadInstallFile: (file: File): Promise<{
    uploaded: string;
    wheel_files: string[];
    install_state: string;
    auto_started: boolean;
    message: string;
  }> => {
    const form = new FormData();
    form.append('file', file);
    return client.post<ApiResponse<any>>(
      '/separator/gpu/install/upload',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 },
    ).then(res => res.data.data);
  },

  getProxy: (): Promise<string> =>
    client.get<ApiResponse<{ proxy: string }>>('/separator/gpu/proxy')
      .then(res => res.data.data.proxy),

  saveProxy: (proxy: string): Promise<void> =>
    client.put<ApiResponse<{ proxy: string }>>('/separator/gpu/proxy', { proxy })
      .then(() => undefined),

  installGpu: async (onLine: (line: string) => void): Promise<void> => {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/separator/gpu/install-gpu', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          onLine(data);
        }
      }
    }
  },

  installCpu: async (onLine: (line: string) => void): Promise<void> => {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/separator/gpu/install-cpu', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          onLine(data);
        }
      }
    }
  },
};
