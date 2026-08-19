import { Writable } from 'stream';
import { WebSocket } from 'ws';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface LogFilters {
  level?: string;
  service?: string;
}

interface LogClient {
  ws: WebSocket;
  filters?: LogFilters;
}

const MAX_BUFFER_SIZE = 5000;
const LEVEL_PRIORITY: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const PINO_LEVEL_MAP: Record<number, LogEntry['level']> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};

let nextId = 1;
const buffer: LogEntry[] = [];
const clients = new Set<LogClient>();

function addEntry(entry: LogEntry): void {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }
  broadcast(entry);
}

export function addExternalEntry(entry: Omit<LogEntry, 'id'>): void {
  const fullEntry: LogEntry = { ...entry, id: nextId++ };
  addEntry(fullEntry);
}

function broadcast(entry: LogEntry): void {
  const data = JSON.stringify(entry);
  clients.forEach(client => {
    if (client.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (client.filters?.level) {
      const minPriority = LEVEL_PRIORITY[client.filters.level] ?? 0;
      const entryPriority = LEVEL_PRIORITY[entry.level] ?? 0;
      if (entryPriority < minPriority) {
        return;
      }
    }
    if (client.filters?.service && client.filters.service !== entry.service) {
      return;
    }
    client.ws.send(data);
  });
}

export function createLogTransport(): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
      try {
        const line = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        const parsed = JSON.parse(line);
        const levelNum: number = parsed.level ?? 30;
        const level = PINO_LEVEL_MAP[levelNum] ?? 'info';
        const message: string = parsed.msg ?? '';

        const meta: Record<string, unknown> = {};
        const skipKeys = new Set([
          'level', 'time', 'msg', 'pid', 'hostname', 'v',
        ]);
        for (const key of Object.keys(parsed)) {
          if (!skipKeys.has(key)) {
            meta[key] = parsed[key];
          }
        }

        const entry: LogEntry = {
          id: nextId++,
          timestamp: parsed.time
            ? new Date(parsed.time).toISOString()
            : new Date().toISOString(),
          level,
          service: 'backend',
          message,
          ...(Object.keys(meta).length > 0 ? { meta } : {}),
        };

        addEntry(entry);
      } catch {
        // 忽略无法解析的日志行
      }
      callback();
    },
  });
}

export function registerLogClient(ws: WebSocket, filters?: LogFilters): void {
  const client: LogClient = { ws, filters };
  clients.add(client);
  ws.on('close', () => {
    clients.delete(client);
  });
}

export function unregisterLogClient(ws: WebSocket): void {
  for (const client of clients) {
    if (client.ws === ws) {
      clients.delete(client);
      break;
    }
  }
}

export function queryLogs(filters: {
  level?: string;
  service?: string;
  keyword?: string;
  startTime?: string | number;
  endTime?: string | number;
  limit?: number;
  offset?: number;
}): LogEntry[] {
  const {
    level,
    service,
    keyword,
    startTime,
    endTime,
    limit = 100,
    offset = 0,
  } = filters;

  const minPriority = level ? (LEVEL_PRIORITY[level] ?? 0) : 0;
  const lowerKeyword = keyword ? keyword.toLowerCase() : null;
  // 统一按绝对时间戳（epoch ms）比较，避免 ISO 字符串与本地 datetime-local
  // 做字典序比较在非 UTC 环境下误判的问题。
  const startMs = startTime != null ? new Date(startTime as string | number).getTime() : null;
  const endMs = endTime != null ? new Date(endTime as string | number).getTime() : null;

  const filtered: LogEntry[] = [];
  for (let i = buffer.length - 1; i >= 0; i--) {
    const entry = buffer[i];
    const entryMs = new Date(entry.timestamp).getTime();

    if (startMs != null && entryMs < startMs) {
      continue;
    }

    if (endMs != null && entryMs > endMs) {
      continue;
    }

    if (minPriority > 0) {
      const entryPriority = LEVEL_PRIORITY[entry.level] ?? 0;
      if (entryPriority < minPriority) {
        continue;
      }
    }

    if (service && entry.service !== service) {
      continue;
    }

    if (lowerKeyword && !entry.message.toLowerCase().includes(lowerKeyword)) {
      continue;
    }

    filtered.push(entry);
  }

  return filtered.slice(offset, offset + limit);
}

export function getLogStats(): Record<string, Record<string, number>> {
  const stats: Record<string, Record<string, number>> = {};
  for (const entry of buffer) {
    if (!stats[entry.service]) {
      stats[entry.service] = {};
    }
    stats[entry.service][entry.level] = (stats[entry.service][entry.level] || 0) + 1;
  }
  return stats;
}

export const logService = {
  registerLogClient,
  unregisterLogClient,
  queryLogs,
  addExternalEntry,
  getLogStats,
};
