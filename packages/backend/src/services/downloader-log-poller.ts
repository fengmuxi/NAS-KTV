import http from 'http';
import { addExternalEntry } from './log-service';
import logger from '../logger';

const DOWNLOADER_URL = process.env.DOWNLOADER_SERVICE_URL || 'http://localhost:8002';
const POLL_INTERVAL_MS = 5000;
const POLL_LIMIT = 200;

let lastTimestamp: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;

interface RawLogEntry {
  timestamp?: string;
  time?: string;
  level?: string;
  message?: string;
  msg?: string;
  logger?: string;
}

function mapLevel(raw: string): 'debug' | 'info' | 'warn' | 'error' {
  const lower = raw.toLowerCase();
  if (lower === 'debug' || lower === 'trace') return 'debug';
  if (lower === 'warning') return 'warn';
  if (lower === 'error' || lower === 'critical' || lower === 'fatal') return 'error';
  return 'info';
}

function poll(): void {
  const url = new URL('/api/logs', DOWNLOADER_URL);
  url.searchParams.set('limit', String(POLL_LIMIT));

  const req = http.get(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      timeout: 3000,
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        consecutiveFailures = 0;
        try {
          const parsed = JSON.parse(data);
          const raw: RawLogEntry[] = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.logs)
              ? parsed.logs
              : [];

          for (const item of raw) {
            const ts = item.timestamp || item.time || new Date().toISOString();
            if (lastTimestamp && ts <= lastTimestamp) continue;

            addExternalEntry({
              timestamp: ts,
              level: mapLevel(item.level || 'info'),
              service: 'downloader',
              message: item.message || item.msg || '',
              ...(item.logger ? { meta: { logger: item.logger } } : {}),
            });

            lastTimestamp = ts;
          }
        } catch {
          // parse error, skip
        }
      });
    },
  );

  req.on('error', () => {
    consecutiveFailures++;
  });

  req.on('timeout', () => {
    req.destroy();
    consecutiveFailures++;
  });
}

export function startDownloaderLogPoller(): void {
  if (timer) return;
  timer = setInterval(poll, POLL_INTERVAL_MS);
  logger.info('Downloader log poller started');
}

export function stopDownloaderLogPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Downloader log poller stopped');
  }
}
