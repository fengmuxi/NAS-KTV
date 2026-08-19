import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Search,
  SearchX,
  Download as DownloadIcon,
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import { downloadApi, type PlatformInfo, type SongDescriptor, type TaskStatus, type SearchResultResponse } from '../api/download';

/* Hallmark · component: page · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */

const STATUS_META: Record<string, { label: string; cls: string; icon: ReactNode }> = {
  pending: { label: '等待中', cls: 'text-ink-2', icon: <Clock className="w-4 h-4" /> },
  processing: { label: '下载中', cls: 'text-accent', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
  completed: { label: '已完成', cls: 'text-success', icon: <CheckCircle2 className="w-4 h-4" /> },
  failed: { label: '失败', cls: 'text-danger', icon: <AlertCircle className="w-4 h-4" /> },
  cancelled: { label: '已取消', cls: 'text-ink-2', icon: <X className="w-4 h-4" /> },
};

// 歌曲下载最多同时选择的音乐平台源数量
const MAX_SOURCES = 3;

/** 搜索按钮旁的圆形进度下载按钮：外圈显示整体下载进度，点击打开详情弹框。 */
function CircularDownloadButton({
  percent,
  total,
  completed,
  active,
  onClick,
}: {
  percent: number;
  total: number;
  completed: number;
  active: boolean;
  onClick: () => void;
}) {
  const size = 40;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, percent)) / 100);
  const label = total > 0 ? `下载进度 ${completed}/${total} 完成，点击查看详情` : '暂无下载任务，点击查看详情';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label="查看下载详情"
      className={[
        'relative inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
        'hover:bg-paper-2 transition-colors',
      ].join(' ')}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="color-mix(in oklch, var(--color-ink) 12%, transparent)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      {total > 0 ? (
        <span className="text-[11px] font-semibold text-accent tabular-nums">
          {completed}/{total}
        </span>
      ) : (
        <DownloadIcon className={['w-4 h-4 text-ink', active ? 'animate-pulse' : ''].join(' ')} />
      )}
    </button>
  );
}

export default function Download() {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SongDescriptor[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [tasks, setTasks] = useState<Record<string, TaskStatus>>({});
  const [detailOpen, setDetailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const pollRef = useRef<number | null>(null);
  const searchPollRef = useRef<number | null>(null);
  // 防抖：用 ref 同步记录「搜索进行中」，避免快速重复触发（React state 异步更新期间漏拦）
  const searchingRef = useRef(false);
  // 记录上次成功提交的查询（关键词|排序后的源集合），相同查询直接复用结果、不重复提交
  const lastSearchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      downloadApi.platforms().catch(() => null),
      downloadApi.config().catch(() => null),
    ]).then(([list, cfg]) => {
      if (cancelled) return;
      if (!list) {
        setError('无法连接下载服务');
        return;
      }
      setPlatforms(list);
      // 默认选中源：优先用后台系统设置（downloader_default_sources），
      // 未配置时回落到 qq；再与可用平台求交集，并按 MAX_SOURCES 截断。
      const wanted = cfg?.defaultSources?.length ? cfg.defaultSources : ['qq'];
      const available = list.filter((p) => p.enabled);
      const initial = wanted
        .filter((k) => available.some((p) => p.key === k))
        .slice(0, MAX_SOURCES);
      const fallback = initial.length
        ? initial
        : available[0]?.key
          ? [available[0].key]
          : [];
      setSelectedSources(new Set(fallback));
    });
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (searchPollRef.current) window.clearInterval(searchPollRef.current);
    };
  }, []);

  const activeTaskIds = useMemo(
    () => Object.values(tasks).filter((t) => t.status === 'pending' || t.status === 'processing').map((t) => t.task_id),
    [tasks],
  );

  // 轮询任务状态直到全部结束
  // 依赖用「活跃任务 id 拼接串」而非 length：避免下载中新增任务导致闭包捕获的旧 id 列表
  // 漏轮询（stale-closure），从而出现「提交成功却一直不更新进度」的假象。
  const activeIdsKey = activeTaskIds.join(',');
  useEffect(() => {
    if (!activeIdsKey) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const updated = await downloadApi.tasks(activeTaskIds);
        setTasks((prev) => {
          const next = { ...prev };
          for (const t of updated) next[t.task_id] = t;
          return next;
        });
      } catch {
        /* 忽略轮询抖动 */
      }
    }, 2000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeIdsKey]);

  // 详情弹框：ESC 关闭
  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen]);

  const toggleSource = (key: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        if (next.size >= MAX_SOURCES) return prev; // 已达上限，忽略新增
        next.add(key);
      }
      return next;
    });
  };

  const toggleSong = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelectedKeys(new Set(results.map((r) => r.key)));
  const clearAll = () => setSelectedKeys(new Set());

  const doSearch = async () => {
    const kw = keyword.trim();
    if (!kw) return;
    if (searchingRef.current) return; // 防抖：搜索进行中，忽略重复触发
    const sources = platforms.filter((p) => selectedSources.has(p.key)).map((p) => p.key);
    const key = `${kw}|${[...selectedSources].sort().join(',')}`;
    // 相同查询（关键词+源组合）且已有结果：直接复用，避免重复提交与轮询
    if (lastSearchKeyRef.current === key && searched) {
      return;
    }
    searchingRef.current = true;
    setSearching(true);
    setError(null);
    setResults([]);
    setSelectedKeys(new Set());
    setSearched(true);
    lastSearchKeyRef.current = key;
    try {
      const data = await downloadApi.searchSubmit(kw, sources.length ? sources : undefined);
      pollSearch(data.search_id);
    } catch {
      setError('搜索提交失败，请检查下载服务');
      setSearching(false);
      searchingRef.current = false;
    }
  };

  // 异步搜索：提交后轮询结果，直到 done / failed（或超时兜底）。
  const pollSearch = (searchId: string) => {
    if (searchPollRef.current) window.clearInterval(searchPollRef.current);
    let attempts = 0;
    const MAX_ATTEMPTS = 80; // 80 × 1.5s ≈ 120s 兜底
    searchPollRef.current = window.setInterval(async () => {
      attempts += 1;
      try {
        const r: SearchResultResponse = await downloadApi.getSearch(searchId);
        if (r.status === 'done') {
          setResults(r.results);
          setSelectedKeys(new Set());
          setSearching(false);
          searchingRef.current = false;
          if (searchPollRef.current) {
            window.clearInterval(searchPollRef.current);
            searchPollRef.current = null;
          }
        } else if (r.status === 'failed') {
          setError(r.error || '搜索失败');
          setSearching(false);
          searchingRef.current = false;
          if (searchPollRef.current) {
            window.clearInterval(searchPollRef.current);
            searchPollRef.current = null;
          }
        } else if (attempts >= MAX_ATTEMPTS) {
          setError('搜索超时，请稍后重试');
          setSearching(false);
          searchingRef.current = false;
          if (searchPollRef.current) {
            window.clearInterval(searchPollRef.current);
            searchPollRef.current = null;
          }
        }
        // pending：继续轮询
      } catch {
        /* 忽略轮询抖动，下一轮继续 */
      }
    }, 1500);
  };

  const doDownload = async () => {
    if (selectedKeys.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await downloadApi.submit([...selectedKeys]);
      const initial: Record<string, TaskStatus> = {};
      for (const id of data.task_ids) {
        initial[id] = {
          task_id: id,
          status: 'pending',
          created_at: Date.now(),
          updated_at: Date.now(),
        };
      }
      setTasks((prev) => ({ ...prev, ...initial }));
      setSelectedKeys(new Set());
      // 立即打开下载详情，给出明确反馈（否则只是悄悄清空选择，用户以为没反应）
      setDetailOpen(true);
    } catch {
      setError('提交下载失败');
    } finally {
      setSubmitting(false);
    }
  };

  const doCancel = async (id: string) => {
    try {
      await downloadApi.cancel(id);
      setTasks((prev) => ({ ...prev, [id]: { ...prev[id], status: 'cancelled' } }));
    } catch {
      /* ignore */
    }
  };

  const taskList = Object.values(tasks);
  const totalTasks = taskList.length;
  const completedTasks = taskList.filter((t) => t.status === 'completed').length;
  const terminalTasks = taskList.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled',
  ).length;
  const activeTasks = totalTasks - terminalTasks;
  const ringPercent = totalTasks > 0 ? Math.round((terminalTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display text-ink">歌曲下载</h1>
        <p className="text-sm text-ink-2 mt-1">
          搜索各大音乐平台，勾选后下载到本地并自动扫描入库、分离伴奏与 AI 解析。
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-danger bg-paper px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* 搜索区 */}
      <div className="rounded-lg border border-border bg-paper p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {platforms.map((p) => {
            const active = selectedSources.has(p.key);
            const atLimit = selectedSources.size >= MAX_SOURCES;
            const disabled = !p.enabled || (atLimit && !active);
            return (
              <button
                key={p.key}
                type="button"
                disabled={disabled}
                onClick={() => toggleSource(p.key)}
                aria-pressed={active}
                title={atLimit && !active ? `最多同时选择 ${MAX_SOURCES} 个音乐平台` : undefined}
                className={[
                  'inline-flex items-center h-8 px-3 rounded-md text-sm border transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
                  disabled
                    ? 'opacity-40 cursor-not-allowed border-border text-ink-2'
                    : active
                      ? 'border-accent bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)] text-accent'
                      : 'border-border text-ink-2 hover:bg-paper-2',
                ].join(' ')}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-ink-2">
          已选 {selectedSources.size} / {MAX_SOURCES}，最多同时选择 {MAX_SOURCES} 个音乐平台
        </span>

        <div className="flex gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="输入歌名 / 歌手 / 关键词"
            className="flex-1 h-10 px-3 rounded-md border border-border bg-paper text-ink placeholder:text-ink-2
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          />
          <Button onClick={doSearch} loading={searching} leftIcon={<Search className="w-4 h-4" />}>
            搜索
          </Button>
          <CircularDownloadButton
            percent={ringPercent}
            total={totalTasks}
            completed={completedTasks}
            active={activeTasks > 0}
            onClick={() => setDetailOpen(true)}
          />
        </div>
      </div>

      {/* 搜索中提示 */}
      {searching && results.length === 0 && (
        <div className="rounded-lg border border-border bg-paper p-4 flex items-center gap-3 text-sm text-ink-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          正在搜索各大音源，请稍候（慢源可能需数十秒）…
        </div>
      )}

      {/* 空结果 / 初始引导 */}
      {!searching && results.length === 0 && (
        searched ? (
          <div className="rounded-lg border border-border bg-paper">
            <EmptyState
              icon={<SearchX className="w-8 h-8" />}
              title="未找到相关歌曲"
              description="换个关键词，或在上方多勾选几个音乐平台后重试"
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-paper">
            <EmptyState
              icon={<Search className="w-8 h-8" />}
              title="输入歌名或歌手开始搜索"
              description="勾选上方音乐平台后，输入关键词即可检索可下载的音源"
            />
          </div>
        )
      )}

      {/* 结果表 */}
      {results.length > 0 && (
        <div className="rounded-lg border border-border bg-paper overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm text-ink-2">
              共 {results.length} 条结果，已选 {selectedKeys.size} 条
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={selectAll}>
                全选
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selectedKeys.size === 0}
                onClick={clearAll}
              >
                取消全选
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={submitting}
                leftIcon={<DownloadIcon className="w-4 h-4" />}
                onClick={doDownload}
              >
                下载选中
              </Button>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper-2 text-ink-2">
                <tr className="text-left">
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2">平台</th>
                  <th className="px-3 py-2">歌名</th>
                  <th className="px-3 py-2">歌手</th>
                  <th className="px-3 py-2">专辑</th>
                  <th className="px-3 py-2">时长</th>
                  <th className="px-3 py-2">大小</th>
                  <th className="px-3 py-2">歌词</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map((r) => {
                  const checked = selectedKeys.has(r.key);
                  return (
                    <tr
                      key={r.key}
                      onClick={() => toggleSong(r.key)}
                      className={[
                        'cursor-pointer transition-colors',
                        checked ? 'bg-[color-mix(in_oklch,var(--color-accent)_10%,transparent)]' : 'hover:bg-paper-2',
                      ].join(' ')}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          aria-label={`选择 ${r.song_name}`}
                          className="accent-[var(--color-accent)]"
                        />
                      </td>
                      <td className="px-3 py-2 text-ink-2">{r.source_label}</td>
                      <td className="px-3 py-2 text-ink">{r.song_name}</td>
                      <td className="px-3 py-2 text-ink-2">{r.singers || '-'}</td>
                      <td className="px-3 py-2 text-ink-2">{r.album || '-'}</td>
                      <td className="px-3 py-2 text-ink-2">{r.duration || '-'}</td>
                      <td className="px-3 py-2 text-ink-2">{r.file_size || '-'}</td>
                      <td className="px-3 py-2">
                        {r.lyric_available ? (
                          <span className="text-success">有</span>
                        ) : (
                          <span className="text-ink-2">无</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 下载详情弹框 */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'color-mix(in oklch, var(--color-ink) 50%, transparent)' }}
          onClick={() => setDetailOpen(false)}
          aria-hidden={false}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="下载详情"
            className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg border border-border bg-paper shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">下载详情</h2>
                {totalTasks > 0 && (
                  <span className="text-xs text-ink-2">
                    {completedTasks}/{totalTasks} 完成
                    {activeTasks > 0 ? ` · ${activeTasks} 进行中` : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                aria-label="关闭"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-2 hover:text-ink hover:bg-paper-2
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-auto space-y-1">
              {taskList.length === 0 ? (
                <p className="text-sm text-ink-2">暂无下载任务</p>
              ) : (
                taskList.map((t) => {
                  const meta = STATUS_META[t.status] || STATUS_META.pending;
                  const terminal = t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled';
                  return (
                    <div
                      key={t.task_id}
                      className="px-3 py-2 rounded-md border border-border space-y-1.5"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center gap-1.5 text-sm ${meta.cls} shrink-0`}>
                          {meta.icon}
                          {meta.label}
                        </span>
                        <span className="flex-1 text-sm text-ink truncate">
                          {t.song_name || t.task_id}
                          {t.singers ? ` - ${t.singers}` : ''}
                        </span>
                        {t.status === 'failed' && t.error && (
                          <span className="text-xs text-danger truncate max-w-[40%]">{t.error}</span>
                        )}
                        {!terminal && (
                          <button
                            type="button"
                            onClick={() => doCancel(t.task_id)}
                            className="text-xs text-ink-2 hover:text-danger rounded px-2 py-1 shrink-0
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            取消
                          </button>
                        )}
                      </div>
                      {/* 进度条：完成/失败/取消=满格；下载中=accent 半透明脉冲（不确定进度）；等待中=空轨道 */}
                      <div className="h-1.5 w-full rounded-full overflow-hidden bg-[color-mix(in_oklch,var(--color-ink)_12%,transparent)]">
                        {t.status === 'completed' && (
                          <div className="h-full bg-success" style={{ width: '100%' }} />
                        )}
                        {t.status === 'processing' && (
                          <div className="h-full w-full bg-[color-mix(in_oklch,var(--color-accent)_35%,transparent)] animate-pulse" />
                        )}
                        {t.status === 'failed' && (
                          <div className="h-full bg-danger" style={{ width: '100%' }} />
                        )}
                        {(t.status === 'cancelled' || t.status === 'pending') && (
                          <div className="h-full bg-ink-2" style={{ width: '100%' }} />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
