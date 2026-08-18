/* Hallmark · component: separation-page · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (46–50)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  RefreshCw,
  Loader2,
  AlertCircle,
  Music,
  Search,
  Trash2,
  StopCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Plus,
  Square,
  CheckSquare,
} from 'lucide-react';
import { separationApi } from '../api/separation';
import { songsApi } from '../api/songs';
import type { SeparationTask, Song } from '../types';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Loading from '../components/Loading';
import AudioPreviewModal from '../components/AudioPreviewModal';
import { useToast } from '../components/Toast';
import Pagination from '../components/Pagination';
import { SEPARATION_MODELS, separationModelLabel } from '../constants';

type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

const statusVariantMap: Record<TaskStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  pending: 'neutral',
  processing: 'warning',
  completed: 'success',
  failed: 'danger',
};

const statusLabel: Record<TaskStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
};

/** separator 阶段英文 → 中文进度名 */
const STAGE_LABELS: Record<string, string> = {
  queued: '排队中',
  pending: '等待中',
  extracting_audio: '提取音频',
  audio_extracted: '音频提取完成',
  loading_model: '加载模型',
  loading_audio: '读取音频',
  separating: '人声分离中',
  processing_results: '处理分离结果',
  saving_results: '保存分离结果',
  transcoding_vocals: '转码人声',
  transcoding_instrumental: '转码伴奏',
  completed: '完成',
  done: '完成',
};

function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '';
  return STAGE_LABELS[stage] ?? stage;
}

function isKnownStatus(s: string): s is TaskStatus {
  return Object.prototype.hasOwnProperty.call(statusLabel, s);
}

const filterTabs: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Separation() {
  const [tasks, setTasks] = useState<SeparationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [batchRetrying, setBatchRetrying] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<{ songId: number; songTitle?: string } | null>(null);

  const [showSongModal, setShowSongModal] = useState(false);
  const [songSearch, setSongSearch] = useState('');
  const [songResults, setSongResults] = useState<Song[]>([]);
  const [songLoading, setSongLoading] = useState(false);
  const [songPage, setSongPage] = useState(1);
  const [songTotal, setSongTotal] = useState(0);

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const { showToast, ToastContainer } = useToast();

  const hasProcessing = tasks.some(t => t.status === 'processing');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const songTotalPages = Math.max(1, Math.ceil(songTotal / 10));

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params: { page: number; pageSize: number; status?: string } = {
        page,
        pageSize,
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await separationApi.getTasks(params);
      setTasks(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载任务列表失败';
      showToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, showToast]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [statusFilter]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page]);

  useEffect(() => {
    if (!hasProcessing) return;
    let hidden = false;
    const interval = setInterval(() => {
      if (!hidden) loadTasks();
    }, 5000);
    const onVis = () => { hidden = document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [hasProcessing, loadTasks]);

  useEffect(() => {
    const wsBaseUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws?token=${encodeURIComponent(localStorage.getItem('token') ?? '')}`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsBaseUrl);
    } catch {
      return;
    }
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const type: string = message.type;
        const payload = message.payload ?? message.data ?? {};
        const taskId: number | undefined = payload.taskId ?? payload.id;
        if (!taskId) return;

        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            if (type === 'SEPARATION_STARTED') {
              return { ...t, status: 'processing', progress: 0, stage: payload.stage ?? null };
            }
            if (type === 'SEPARATION_PROGRESS') {
              const progress =
                typeof payload.progress === 'number' ? payload.progress : t.progress;
              return { ...t, status: 'processing', progress, stage: payload.stage ?? t.stage };
            }
            if (type === 'SEPARATION_COMPLETED') {
              return {
                ...t,
                status: 'completed',
                progress: 100,
                completedAt: new Date().toISOString(),
                error: null,
              };
            }
            if (type === 'SEPARATION_FAILED') {
              return { ...t, status: 'failed', error: payload.error || '分离失败' };
            }
            return t;
          })
        );
      } catch {
        // ignore malformed message
      }
    };
    return () => { ws?.close(); };
  }, []);

  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const t of tasks) {
    if (isKnownStatus(t.status)) stats[t.status] += 1;
  }

  const refreshTaskRow = useCallback((updated: SeparationTask) => {
    setTasks(prev => prev.map(t => (t.id === updated.id ? { ...t, ...updated } : t)));
  }, []);

  const handleRetry = async (task: SeparationTask) => {
    setActionLoadingId(task.id);
    try {
      const updated = await separationApi.retryTask(task.id);
      refreshTaskRow(updated);
      showToast('success', '重试已触发');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '重试失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReSeparate = (task: SeparationTask) => {
    const song = (task as SeparationTask & { song?: { title?: string } }).song;
    setConfirmDialog({
      title: '重新分离',
      message: `确定要重新分离「${song?.title || `歌曲 #${task.songId}`}」吗？重新分离将覆盖现有结果。`,
      onConfirm: async () => {
        setActionLoadingId(task.id);
        try {
          await separationApi.retryTask(task.id);
          showToast('success', '重新分离已触发');
          await loadTasks();
        } catch (err) {
          showToast('error', err instanceof Error ? err.message : '重新分离失败');
        } finally {
          setActionLoadingId(null);
        }
      },
    });
  };

  const handleStop = (task: SeparationTask) => {
    const song = (task as SeparationTask & { song?: { title?: string } }).song;
    setConfirmDialog({
      title: '确认停止',
      message: `确定要停止「${song?.title || `歌曲 #${task.songId}`}」的分离任务吗？停止后任务将标记为失败。`,
      onConfirm: async () => {
        setActionLoadingId(task.id);
        try {
          await separationApi.stopTask(task.id);
          setTasks(prev =>
            prev.map(t => (t.id === task.id ? { ...t, status: 'failed', error: '用户手动停止' } : t))
          );
          showToast('success', '任务已停止');
        } catch (err) {
          showToast('error', err instanceof Error ? err.message : '停止失败');
        } finally {
          setActionLoadingId(null);
        }
      },
    });
  };

  const doBatchRetry = async (ids: number[]) => {
    setBatchRetrying(true);
    try {
      const res = await separationApi.batchRetry(ids);
      showToast('success', `批量重试完成：成功 ${res.succeeded}，跳过 ${res.skipped}`);
      setSelectedIds(new Set());
      await loadTasks();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '批量重试失败');
    } finally {
      setBatchRetrying(false);
    }
  };

  const handleBatchRetry = () => {
    const ids = [...selectedIds].filter(id => {
      const t = tasks.find(x => x.id === id);
      return t && (t.status === 'failed' || t.status === 'pending' || t.status === 'completed');
    });
    if (ids.length === 0) {
      showToast('warning', '没有可重试的选中任务');
      return;
    }
    const completedCount = ids.filter(id => {
      const t = tasks.find(x => x.id === id);
      return t?.status === 'completed';
    }).length;
    if (completedCount > 0) {
      setConfirmDialog({
        title: '批量重新分离',
        message: `选中的任务中有 ${completedCount} 个已完成任务，重新分离将覆盖现有结果。是否继续？`,
        onConfirm: () => doBatchRetry(ids),
      });
      return;
    }
    doBatchRetry(ids);
  };

  const handleBatchDelete = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setConfirmDialog({
      title: '确认删除',
      message: `确定要删除选中的 ${ids.length} 个任务吗？此操作不可撤销。`,
      onConfirm: async () => {
        try {
          const res = await separationApi.batchDelete(ids);
          showToast('success', `批量删除完成：成功 ${res.succeeded}，跳过 ${res.skipped}`);
          setSelectedIds(new Set());
          await loadTasks();
        } catch (err) {
          showToast('error', err instanceof Error ? err.message : '批量删除失败');
        }
      },
    });
  };

  const handleBatchStop = () => {
    const ids = [...selectedIds].filter(id => {
      const t = tasks.find(x => x.id === id);
      return t && t.status === 'processing';
    });
    if (ids.length === 0) {
      showToast('warning', '没有正在处理的选中任务');
      return;
    }
    setConfirmDialog({
      title: '确认停止',
      message: `确定要停止选中的 ${ids.length} 个正在处理的任务吗？停止后任务将标记为失败。`,
      onConfirm: async () => {
        try {
          const res = await separationApi.batchStop(ids);
          showToast('success', `批量停止完成：成功 ${res.succeeded}，跳过 ${res.skipped}`);
          setSelectedIds(new Set());
          await loadTasks();
        } catch (err) {
          showToast('error', err instanceof Error ? err.message : '批量停止失败');
        }
      },
    });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === tasks.length && tasks.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map(t => t.id)));
    }
  };

  const openPreview = (task: SeparationTask) => {
    const song = (task as SeparationTask & { song?: { title?: string } }).song;
    setPreview({ songId: task.songId, songTitle: song?.title });
  };

  const loadSongs = useCallback(async (keyword: string, p: number) => {
    setSongLoading(true);
    try {
      const res = await songsApi.list({ page: p, pageSize: 10, keyword: keyword || undefined });
      setSongResults(res.items ?? []);
      setSongTotal(res.total ?? 0);
    } catch {
      showToast('error', '加载歌曲列表失败');
    } finally {
      setSongLoading(false);
    }
  }, [showToast]);

  const songSearchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!showSongModal) return;
    clearTimeout(songSearchTimerRef.current);
    songSearchTimerRef.current = setTimeout(() => {
      setSongPage(1);
      loadSongs(songSearch, 1);
    }, 300);
    return () => clearTimeout(songSearchTimerRef.current);
  }, [songSearch, showSongModal, loadSongs]);

  useEffect(() => {
    if (!showSongModal) return;
    loadSongs(songSearch, songPage);
  }, [songPage, showSongModal, songSearch, loadSongs]);

  const triggerSongSeparation = async (song: Song) => {
    try {
      await songsApi.separate(song.id);
      showToast('success', `歌曲「${song.title}」分离任务已触发`);
      setShowSongModal(false);
      setSongSearch('');
      await loadTasks();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '触发分离失败');
    }
  };

  const handleSongSelect = (song: Song) => {
    const ss = song.separationStatus;
    if (ss === 'processing') {
      showToast('warning', '该歌曲正在分离中');
      return;
    }
    if (ss === 'completed') {
      setConfirmDialog({
        title: '重新分离',
        message: `歌曲「${song.title}」已完成分离，重新分离将覆盖现有结果。是否继续？`,
        onConfirm: () => triggerSongSeparation(song),
      });
      return;
    }
    triggerSongSeparation(song);
  };

  const getSongStatusBadge = (status?: string | null) => {
    if (!status || status === 'none') return null;
    if (!isKnownStatus(status)) return null;
    return <Badge variant={statusVariantMap[status]} size="sm">{statusLabel[status]}</Badge>;
  };

  const allSelected = tasks.length > 0 && selectedIds.size === tasks.length;

  const statCards: {
    label: string;
    value: number;
    variant: 'neutral' | 'warning' | 'success' | 'danger';
  }[] = [
    { label: '待处理', value: stats.pending, variant: 'neutral' },
    { label: '处理中', value: stats.processing, variant: 'warning' },
    { label: '已完成', value: stats.completed, variant: 'success' },
    { label: '失败', value: stats.failed, variant: 'danger' },
  ];

  return (
    <div className="p-lg">
      <ToastContainer />

      <div className="flex items-start justify-between gap-md mb-lg flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-ink mb-xs">
            人声分离
          </h1>
          <p className="text-sm text-ink-3">
            管理歌曲的人声/伴奏分离任务，支持实时进度与试听
          </p>
        </div>
        <div className="flex items-center gap-sm">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setShowSongModal(true)}
          >
            选择歌曲
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm mb-md">
        {statCards.map(card => (
          <div
            key={card.label}
            className="bg-paper border border-border rounded-lg p-md"
          >
            <div className="flex items-center justify-between mb-xs">
              <span className="text-sm text-ink-3">{card.label}</span>
              <Badge variant={card.variant} dot>{card.label}</Badge>
            </div>
            <div className="text-2xl font-display font-bold text-ink font-mono">
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-paper border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between gap-md px-md py-sm border-b border-border flex-wrap">
          <div className="flex items-center gap-xs flex-wrap">
            {filterTabs.map(tab => {
              const active = statusFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setStatusFilter(tab.value)}
                  className={[
                    'inline-flex items-center px-sm py-1.5 rounded-md text-sm font-medium',
                    'border transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active
                      ? 'border-accent bg-accent text-paper'
                      : 'border-border bg-paper text-ink-2 hover:bg-paper-2 hover:text-ink',
                  ].join(' ')}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          {hasProcessing && (
            <div className="flex items-center gap-1.5 text-xs text-warning">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              自动刷新中
            </div>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-sm px-md py-sm bg-accent-soft border-b border-border flex-wrap">
            <span className="text-sm text-accent font-medium">
              已选 {selectedIds.size} 项
            </span>
            <div className="flex items-center gap-xs">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={handleBatchRetry}
              loading={batchRetrying}
            >
              批量重试
            </Button>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<StopCircle className="w-3.5 h-3.5" />}
                onClick={handleBatchStop}
              >
                批量停止
              </Button>
              <Button
                size="sm"
                variant="danger"
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={handleBatchDelete}
              >
                批量删除
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto"
            >
              取消选择
            </Button>
          </div>
        )}

        {loading ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <div className="py-xl text-center text-ink-3 text-sm">
            暂无分离任务
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-ink-3">
                <tr>
                  <th className="w-10 px-md py-sm">
                    <button
                      onClick={toggleSelectAll}
                      className="inline-flex items-center justify-center w-4 h-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                      aria-label={allSelected ? '取消全选' : '全选'}
                    >
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4 text-accent" />
                      ) : selectedIds.size > 0 ? (
                        <Square className="w-4 h-4 text-accent fill-accent/30" />
                      ) : (
                        <Square className="w-4 h-4 text-ink-3" />
                      )}
                    </button>
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">歌曲</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">状态</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap min-w-[180px]">进度</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">模型</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">创建时间</th>
                  <th className="text-right font-medium px-md py-sm whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => {
                  const status = isKnownStatus(task.status) ? task.status : 'pending';
                  const isLoading = actionLoadingId === task.id;
                  const song = (task as SeparationTask & {
                    song?: { title?: string; artistName?: string; separationStatus?: string | null };
                  }).song;
                  // 任务失败但歌曲仍为 completed：重新分离异常，已回滚使用旧版产物
                  const isRolledBack =
                    status === 'failed' && song?.separationStatus === 'completed';
                  const progress = Math.max(0, Math.min(100, Math.round(task.progress ?? 0)));
                  const isSelected = selectedIds.has(task.id);

                  return (
                    <tr
                      key={task.id}
                      className={[
                        'border-t border-border transition-colors',
                        isSelected ? 'bg-accent-soft/30' : 'hover:bg-paper-2',
                      ].join(' ')}
                    >
                      <td className="px-md py-sm">
                        <button
                          onClick={() => toggleSelect(task.id)}
                          className="inline-flex items-center justify-center w-4 h-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                          aria-label={isSelected ? '取消选择' : '选择'}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-accent" />
                          ) : (
                            <Square className="w-4 h-4 text-ink-3" />
                          )}
                        </button>
                      </td>
                      <td className="px-md py-sm text-ink">
                        <div className="flex items-center gap-sm">
                          <Music className="w-4 h-4 text-ink-3 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {song?.title || `歌曲 #${task.songId}`}
                            </div>
                            {song?.artistName && (
                              <div className="text-xs text-ink-3 truncate">
                                {song.artistName}
                              </div>
                            )}
                            {task.error && status === 'failed' && (
                              <div className="text-xs truncate flex items-center gap-1 mt-0.5">
                                <AlertCircle className="w-3 h-3 shrink-0 text-danger" />
                                {isRolledBack && (
                                  <span className="text-warning font-medium shrink-0">
                                    分离异常，已回滚旧版结果：
                                  </span>
                                )}
                                <span className="text-danger truncate">{task.error}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-md py-sm">
                        <div className="flex items-center gap-xs flex-wrap">
                          <Badge variant={statusVariantMap[status]} dot>
                            {statusLabel[status]}
                          </Badge>
                          {isRolledBack && (
                            <Badge variant="warning" size="sm">
                              已回滚旧版
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-md py-sm">
                        <div className="flex items-center gap-sm">
                          <div
                            className="flex-1 h-1.5 bg-paper-3 rounded-full overflow-hidden"
                            role="progressbar"
                            aria-valuenow={progress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="h-full bg-accent transition-[width] duration-300 ease-out"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-ink-2 w-10 text-right">
                            {progress}%
                          </span>
                        </div>
                        {task.stage && (
                          <div className="text-xs text-ink-3 mt-1 truncate">
                            {stageLabel(task.stage)}
                          </div>
                        )}
                      </td>
                      <td className="px-md py-sm text-ink-2 font-mono text-xs">
                        {separationModelLabel(task.model)}
                      </td>
                      <td className="px-md py-sm text-ink-3 text-xs">
                        {formatTime(task.createdAt)}
                      </td>
                      <td className="px-md py-sm">
                        <div className="flex items-center justify-end gap-xs flex-wrap">
                          {status === 'completed' && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                leftIcon={<Play className="w-3.5 h-3.5" />}
                                onClick={() => openPreview(task)}
                              >
                                试听
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                leftIcon={
                                  isLoading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  )
                                }
                                onClick={() => handleReSeparate(task)}
                                disabled={isLoading}
                              >
                                重新分离
                              </Button>
                            </>
                          )}
                          {status === 'processing' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              leftIcon={
                                isLoading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <StopCircle className="w-3.5 h-3.5" />
                                )
                              }
                              onClick={() => handleStop(task)}
                              disabled={isLoading}
                            >
                              停止
                            </Button>
                          )}
                          {(status === 'failed' || status === 'pending') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              leftIcon={
                                isLoading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5" />
                                )
                              }
                              onClick={() => handleRetry(task)}
                              disabled={isLoading}
                            >
                              重试
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <div className="border-t border-border">
            <div className="px-md pt-sm text-xs text-ink-3">共 {total} 条任务</div>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              state={loading ? 'loading' : 'default'}
              pageSize={pageSize}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>

      <Modal
        isOpen={showSongModal}
        onClose={() => { setShowSongModal(false); setSongSearch(''); }}
        title="选择歌曲"
      >
        <div className="space-y-md" style={{ minHeight: '400px' }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
            <input
              type="text"
              value={songSearch}
              onChange={e => setSongSearch(e.target.value)}
              placeholder="搜索歌曲名称..."
              className={[
                'w-full rounded-md border border-border bg-paper text-ink text-sm',
                'pl-9 pr-3 py-2 placeholder:text-ink-3',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              ].join(' ')}
              autoFocus
            />
            {songSearch && (
              <button
                onClick={() => setSongSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink p-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
                aria-label="清除搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {songLoading ? (
            <Loading />
          ) : songResults.length === 0 ? (
            <div className="py-lg text-center text-ink-3 text-sm">
              {songSearch ? '未找到匹配的歌曲' : '暂无歌曲'}
            </div>
          ) : (
            <div className="space-y-xs max-h-80 overflow-y-auto">
              {songResults.map(song => (
                <div
                  key={song.id}
                  className="flex items-center justify-between gap-sm p-sm rounded-md border border-border hover:bg-paper-2 transition-colors"
                >
                  <div className="flex items-center gap-sm min-w-0">
                    <Music className="w-4 h-4 text-ink-3 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-sm">
                        <span className="text-sm font-medium text-ink truncate">
                          {song.title}
                        </span>
                        {getSongStatusBadge(song.separationStatus)}
                      </div>
                      <div className="text-xs text-ink-3 truncate">
                        {song.artistName || '未知歌手'}
                        {song.duration > 0 && ` · ${formatDuration(song.duration)}`}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSongSelect(song)}
                    disabled={song.separationStatus === 'processing'}
                  >
                    {song.separationStatus === 'completed'
                      ? '重新分离'
                      : song.separationStatus === 'processing'
                        ? '处理中'
                        : '选择'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {songTotal > 10 && (
            <div className="flex items-center justify-between pt-sm border-t border-border">
              <span className="text-xs text-ink-3">共 {songTotal} 首歌曲</span>
              <div className="flex items-center gap-xs">
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<ChevronLeft className="w-4 h-4" />}
                  disabled={songPage <= 1}
                  onClick={() => setSongPage(p => p - 1)}
                >
                  上一页
                </Button>
                <span className="text-xs text-ink-2 px-sm">
                  {songPage}/{songTotalPages}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  rightIcon={<ChevronRight className="w-4 h-4" />}
                  disabled={songPage >= songTotalPages}
                  onClick={() => setSongPage(p => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {preview && (
        <AudioPreviewModal
          isOpen={!!preview}
          onClose={() => setPreview(null)}
          songId={preview.songId}
          songTitle={preview.songTitle || `歌曲 #${preview.songId}`}
          separationStatus="completed"
        />
      )}

      <Modal
        isOpen={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || '确认操作'}
      >
        {confirmDialog && (
          <div className="space-y-md">
            <p className="text-sm text-ink-2">{confirmDialog.message}</p>
            <div className="flex items-center justify-end gap-sm">
              <Button variant="ghost" onClick={() => setConfirmDialog(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                确认
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
