import client from './client';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  service: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface LogQueryParams {
  level?: string;
  service?: string;
  keyword?: string;
  startTime?: string | number;
  endTime?: string | number;
  limit?: number;
  icode?: number;
  offset?: number;
}

/** datetime-local 字符串（本地时区）转 epoch 毫秒；后端按绝对时间比较，规避时区误判。 */
function toEpoch(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export async function fetchLogs(params: LogQueryParams = {}): Promise<{ logs: LogEntry[];  total: number }> {
  const query: Record<string, string | number | undefined> = {
    level: params.level,
    service: params.service,
    keyword: params.keyword,
    limit: params.limit,
    offset: params.offset,
    startTime: toEpoch(params.startTime as string | undefined),
    endTime: toEpoch(params.endTime as string | undefined),
  };
  const { data } = await client.get('/system/logs', { params: query });
  return data.data;
}

/** 导出当前筛选结果为文件（json 保留完整 meta；csv 便于表格查看）。 */
export async function exportLogs(params: LogQueryParams = {}, format: 'json' | 'csv' = 'json'): Promise<void> {
  const query: Record<string, string | number | undefined> = {
    level: params.level,
    service: params.service,
    keyword: params.keyword,
    startTime: toEpoch(params.startTime as string | undefined),
    endTime: toEpoch(params.endTime as string | undefined),
    format,
  };
  const resp = await client.get('/system/logs/export', { params: query, responseType: 'blob' });
  const blob = new Blob([resp.data as BlobPart], {
    type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = format === 'csv' ? 'nasktv-logs.csv' : 'nasktv-logs.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchLogStats(): Promise<Record<string, Record<string, number>>> {
  const { data } = await client.get('/system/logs/stats');
  return data.data;
}

export function connectLogStream(
  filters: { level?: string; service?: string },
  onMessage: (entry: LogEntry) => void,
  onError?: (err: Event) => void,
): WebSocket {
  const params = new URLSearchParams();
  if (filters.level) params.set('level', filters.level);
  if (filters.service) params.set('service', filters.service);
  const token = localStorage.getItem('token');
  if (token) params.set('token', token);
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const qs = params.toString();
  const url = `${protocol}//${host}/ws/logs${qs ? '?' + qs : ''}`;
  
  const ws = new WebSocket(url);
  
  ws.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data) as LogEntry;
      onMessage(entry);
    } catch {
      // ignore parse errors
    }
  };
  
  if (onError) {
    ws.onerror = onError;
  }
  
  return ws;
}
