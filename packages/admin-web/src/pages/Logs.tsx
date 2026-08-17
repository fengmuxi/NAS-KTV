/* Hallmark · component: logs-page · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * contrast: pass (AA on paper/ink pairings)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Search,
  Pause,
  Play,
  Trash2,
  Terminal,
  Server,
  Wifi,
  WifiOff,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import Badge, { type BadgeVariant } from '../components/Badge';
import Button from '../components/Button';
import Loading from '../components/Loading';
import { fetchLogs, fetchLogStats, connectLogStream } from '../api/logs';
import type { LogEntry, LogQueryParams } from '../api/logs';

const LEVEL_BADGE_VARIANT: Record<string, BadgeVariant> = {
  debug: 'neutral',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};

const LEVEL_LABEL: Record<string, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

const LEVEL_PRIORITY: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getLevelBorderClass(level: string): string {
  const map: Record<string, string> = {
    debug: 'border-l-[var(--color-ink-3)]',
    info: 'border-l-[var(--color-info)]',
    warn: 'border-l-[var(--color-warning)]',
    error: 'border-l-[var(--color-danger)]',
  };
  return map[level] ?? 'border-l-border';
}

function getLevelBadgeVariant(level: string): BadgeVariant {
  return LEVEL_BADGE_VARIANT[level] ?? 'neutral';
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return ts;
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  } catch {
    return ts;
  }
}

function matchesFilters(
  entry: LogEntry,
  filters: { level?: string; service?: string; keyword?: string },
): boolean {
  if (filters.level) {
    const minPri = LEVEL_PRIORITY[filters.level] ?? 0;
    const entryPri = LEVEL_PRIORITY[entry.level] ?? 0;
    if (entryPri < minPri) return false;
  }
  if (filters.service && entry.service !== filters.service) return false;
  if (filters.keyword && !entry.message.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
  return true;
}

function highlightMatches(text: string, kw: string): React.ReactNode[] {
  const lower = text.toLowerCase();
  const lowerKw = kw.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let idx = lower.indexOf(lowerKw, last);
  let key = 0;
  while (idx !== -1) {
    if (idx > last) {
      parts.push(text.slice(last, idx));
    }
    parts.push(
      <mark
        key={key++}
        style={{ backgroundColor: 'color-mix(in oklch, var(--color-warning) 30%, transparent)', color: 'inherit', borderRadius: '2px', padding: '0 1px' }}
      >
        {text.slice(idx, idx + kw.length)}
      </mark>,
    );
    last = idx + kw.length;
    idx = lower.indexOf(lowerKw, last);
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

const MIN_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // 手动刷新专用 loading：仅控制刷新按钮的旋转动画，不影响首屏 loading 遮罩
  const [refreshing, setRefreshing] = useState(false);
  const [levelFilter, setLevelFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [stats, setStats] = useState<Record<string, Record<string, number>>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(MIN_RECONNECT_DELAY);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(autoScroll);
  const pausedRef = useRef(paused);
  const filtersRef = useRef({ level: '', service: '', keyword: '' });
  const unmountedRef = useRef(false);

  autoScrollRef.current = autoScroll;
  pausedRef.current = paused;
  filtersRef.current = { level: levelFilter, service: serviceFilter, keyword: keyword.trim() };

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (autoScrollRef.current !== atBottom) {
      setAutoScroll(atBottom);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: LogQueryParams = { limit: 200 };
      if (levelFilter) params.level = levelFilter;
      if (serviceFilter) params.service = serviceFilter;
      if (keyword.trim()) params.keyword = keyword.trim();
      if (startTime) params.startTime = startTime;
      if (endTime) params.endTime = endTime;
      const result = await fetchLogs(params);
      if (!unmountedRef.current) setLogs(result.logs ?? []);
    } catch {
      if (!unmountedRef.current) setLogs([]);
    } finally {
      if (!unmountedRef.current) setLoading(false);
    }
  }, [levelFilter, serviceFilter, keyword, startTime, endTime]);

  useEffect(() => {
    unmountedRef.current = false;
    loadLogs();
    return () => { unmountedRef.current = true; };
  }, [loadLogs]);

  useEffect(() => {
    if (!loading) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [loading, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        const data = await fetchLogStats();
        if (!cancelled) setStats(data);
      } catch {
        // ignore
      }
    }
    loadStats();
    const timer = setInterval(loadStats, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsFilters: { level?: string; service?: string } = {};
    if (levelFilter) wsFilters.level = levelFilter;
    if (serviceFilter) wsFilters.service = serviceFilter;

    const ws = connectLogStream(
      wsFilters,
      (entry) => {
        if (unmountedRef.current) return;
        if (pausedRef.current) return;
        if (!matchesFilters(entry, filtersRef.current)) return;
        setLogs((prev) => [...prev, entry]);
        reconnectDelayRef.current = MIN_RECONNECT_DELAY;
        if (autoScrollRef.current) {
          requestAnimationFrame(scrollToBottom);
        }
      },
      () => {
        setConnected(false);
      },
    );

    ws.onopen = () => {
      if (unmountedRef.current) return;
      setConnected(true);
      reconnectDelayRef.current = MIN_RECONNECT_DELAY;
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setConnected(false);
      scheduleReconnect();
    };

    wsRef.current = ws;
  }, [levelFilter, serviceFilter, scrollToBottom]);

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    const delay = reconnectDelayRef.current;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [logs.length, autoScroll, scrollToBottom]);

  const handleClear = () => {
    setPaused(true);
    setLogs([]);
  };

  const handleResume = () => {
    setPaused(false);
  };

  const handleRefresh = () => {
    setPaused(false);
    setRefreshing(true);
    loadLogs().finally(() => setRefreshing(false));
  };

  const toggleAutoScroll = () => {
    setAutoScroll((prev) => {
      const next = !prev;
      if (next) {
        requestAnimationFrame(scrollToBottom);
      }
      return next;
    });
  };

  const selectClasses = [
    'rounded-md border border-border bg-paper text-ink text-sm',
    'px-3 py-2 pr-8',
    'transition-colors duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
    'hover:border-border-strong',
    'appearance-none bg-no-repeat bg-[right_0.5rem_center] bg-[length:1rem]',
    "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")]",
  ].join(' ');

  const searchInputClasses = [
    'w-full rounded-md border border-border bg-paper text-ink text-sm',
    'pl-9 pr-3 py-2',
    'placeholder:text-ink-3',
    'transition-colors duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
    'hover:border-border-strong',
  ].join(' ');

  return (
    <div className="p-lg flex flex-col h-[calc(100vh-var(--space-lg)*2)]">
      <div className="mb-md shrink-0">
        <h1 className="text-2xl font-display font-bold text-ink mb-xs">系统日志</h1>
        <p className="text-sm text-ink-3">
          实时查看后端与 Separator 服务的运行日志
        </p>
      </div>

      {/* Stats overview */}
      {Object.keys(stats).length > 0 && (
        <div className="bg-paper-2 border border-border rounded-lg p-md mb-md shrink-0 flex flex-wrap items-center gap-sm">
          <span className="text-xs font-medium text-ink-2 mr-xs">统计：</span>
          {Object.entries(stats).map(([svc, levels]) =>
            Object.entries(levels).map(([lvl, count]) => (
              <Badge
                key={`${svc}-${lvl}`}
                variant={LEVEL_BADGE_VARIANT[lvl] ?? 'neutral'}
                size="sm"
              >
                {svc === 'separator' ? (
                  <Server className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <Terminal className="w-3 h-3" aria-hidden="true" />
                )}
                {' '}{svc} · {LEVEL_LABEL[lvl] ?? lvl.toUpperCase()} {count}
              </Badge>
            )),
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-paper-2 border border-border rounded-lg p-md mb-md shrink-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-sm">
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">
              服务
            </label>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className={selectClasses}
              aria-label="按服务筛选"
            >
              <option value="">全部服务</option>
              <option value="backend">后端</option>
              <option value="separator">Separator</option>
            </select>
          </div>

          <div className="flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">
              日志级别
            </label>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className={selectClasses}
              aria-label="按日志级别筛选"
            >
              <option value="">全部级别</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">
              开始时间
            </label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-md border border-border bg-paper text-ink text-sm px-3 py-2 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper hover:border-border-strong"
              aria-label="开始时间"
            />
          </div>

          <div className="flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">
              结束时间
            </label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-md border border-border bg-paper text-ink text-sm px-3 py-2 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper hover:border-border-strong"
              aria-label="结束时间"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-2 flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">
              关键字搜索
            </label>
            <div className="relative flex items-center">
              <Search
                className="absolute left-3 w-4 h-4 text-ink-3 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索日志内容..."
                className={searchInputClasses}
                aria-label="搜索日志内容"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Log list */}
      <div className="flex-1 min-h-0 bg-paper-2 border border-border rounded-lg overflow-hidden flex flex-col">
        {loading ? (
          <Loading />
        ) : logs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-xl text-ink-3 gap-sm">
            <Inbox className="w-10 h-10" aria-hidden="true" />
            <span className="text-sm">{paused ? '日志已暂停接收' : '暂无日志记录'}</span>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto"
            role="log"
            aria-label="系统日志列表"
            aria-live="polite"
          >
            {logs.map((entry, idx) => (
              <div
                key={`${entry.id}-${idx}`}
                className={[
                  'border-l-4 px-md py-2 border-b border-b-border',
                  'hover:bg-paper-3 transition-colors',
                  getLevelBorderClass(entry.level),
                ].join(' ')}
              >
                <div className="flex items-center gap-sm flex-wrap">
                  <span className="text-xs text-ink-3 font-mono shrink-0 w-[8.5rem]">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <Badge
                    variant={entry.service === 'separator' ? 'info' : 'neutral'}
                    size="sm"
                  >
                    <span className="flex items-center gap-1">
                      {entry.service === 'separator' ? (
                        <Server className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <Terminal className="w-3 h-3" aria-hidden="true" />
                      )}
                      {entry.service}
                    </span>
                  </Badge>
                  <Badge
                    variant={getLevelBadgeVariant(entry.level)}
                    size="sm"
                    dot
                  >
                    {LEVEL_LABEL[entry.level] ?? entry.level.toUpperCase()}
                  </Badge>
                </div>
                <div className="mt-1 text-sm text-ink font-mono break-all whitespace-pre-wrap leading-relaxed">
                  {keyword.trim() ? highlightMatches(entry.message, keyword.trim()) : entry.message}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bottom control bar */}
        <div className="shrink-0 border-t border-border bg-paper-2 px-md py-2 flex items-center gap-sm flex-wrap">
          <div className="flex items-center gap-xs">
            {paused ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleResume}
                leftIcon={<Play className="w-4 h-4" aria-hidden="true" />}
                aria-label="恢复接收日志"
              >
                恢复接收
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAutoScroll}
                leftIcon={
                  autoScroll ? (
                    <Pause className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Play className="w-4 h-4" aria-hidden="true" />
                  )
                }
                aria-label={autoScroll ? '暂停自动滚动' : '恢复自动滚动'}
              >
                {autoScroll ? '暂停滚动' : '自动滚动'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              leftIcon={<Trash2 className="w-4 h-4" aria-hidden="true" />}
              disabled={logs.length === 0 && !paused}
              aria-label="清空日志"
            >
              清空
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              loading={refreshing}
              leftIcon={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              aria-label="刷新日志"
            >
              刷新
            </Button>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-sm text-xs text-ink-3">
            {paused && (
              <Badge variant="warning" size="sm" dot>
                已暂停
              </Badge>
            )}
            <span className="font-mono">
              {logs.length} 条日志
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={connected ? 'WebSocket 已连接' : 'WebSocket 已断开'}
            >
              {connected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                  <span className="text-success">已连接</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-ink-3" aria-hidden="true" />
                  <span>已断开</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
