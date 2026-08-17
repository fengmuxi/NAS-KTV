/* Hallmark · page: scan · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * contrast: pass (46–50)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderSearch,
  FolderOpen,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  CopyX,
  ChevronRight,
  Eye,
  X,
} from 'lucide-react';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Loading from '../components/Loading';
import Pagination from '../components/Pagination';
import FolderPicker from '../components/FolderPicker';
import Modal from '../components/Modal';
import { scanApi, type ScanResultsResponse, type ScanResultItem } from '../api/scan';
import { settingsApi } from '../api/settings';
import { dedupApi, type DedupTaskItem } from '../api/dedup';
import { useToast } from '../components/Toast';
import type { ScanTask } from '../types';

const PAGE_SIZE = 10;
const RESULT_PAGE_SIZE = 20;

const RESULT_STATUS_META: Record<ScanResultItem['status'], { label: string; color: string }> = {
  new: { label: '新增', color: 'text-success' },
  updated: { label: '更新', color: 'text-info' },
  skipped: { label: '跳过', color: 'text-ink-3' },
  error: { label: '错误', color: 'text-danger' },
};

type ResultFilter = '' | ScanResultItem['status'];

interface ScanProgressPayload {
  percentage?: number;
  currentFile?: string;
  currentPath?: string;
  processed?: number;
  total?: number;
}

interface ScanWsMessage {
  type: 'SCAN_STARTED' | 'SCAN_PROGRESS' | 'SCAN_COMPLETED' | 'SCAN_FAILED';
  payload?: ScanProgressPayload & { error?: string };
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function formatDuration(start: number, end?: number): string {
  const endTs = end ?? Date.now();
  const totalSec = Math.max(0, Math.floor((endTs - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatusIcon({ status }: { status: ScanTask['status'] }) {
  if (status === 'completed')
    return <CheckCircle className="w-4 h-4 text-success shrink-0" aria-hidden="true" />;
  if (status === 'failed')
    return <XCircle className="w-4 h-4 text-danger shrink-0" aria-hidden="true" />;
  return <Loader2 className="w-4 h-4 text-warning shrink-0 animate-spin" aria-hidden="true" />;
}

function StatusBadge({ status }: { status: ScanTask['status'] }) {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="success" dot>
          完成
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="danger" dot>
          失败
        </Badge>
      );
    case 'running':
    default:
      return (
        <Badge variant="warning" dot>
          进行中
        </Badge>
      );
  }
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-sm text-left group disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span
        className={[
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-base',
          'group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-paper',
          checked ? 'bg-accent' : 'bg-paper-3',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-4 w-4 rounded-full bg-paper shadow-sm transition-transform duration-base',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          ].join(' ')}
        />
      </span>
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && (
          <span className="block text-xs text-ink-3">{description}</span>
        )}
      </span>
    </button>
  );
}

export default function Scan() {
  const { showToast, ToastContainer } = useToast();
  const [scanPath, setScanPath] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [autoParse, setAutoParse] = useState(false);
  const [autoSeparate, setAutoSeparate] = useState(false);
  const [md5Dedup, setMd5Dedup] = useState(true);
  const [dedupByScan, setDedupByScan] = useState<Record<string, DedupTaskItem>>({});

  const [triggering, setTriggering] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [historyItems, setHistoryItems] = useState<ScanTask[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalHistory, setTotalHistory] = useState(0);
  const [selectedTask, setSelectedTask] = useState<ScanTask | null>(null);
  const [results, setResults] = useState<ScanResultsResponse | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>('');
  const [resultPage, setResultPage] = useState(1);
  const [resultsLoading, setResultsLoading] = useState(false);

  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const loadHistoryRef = useRef<(targetPage?: number) => void>(() => {});

  const loadHistory = useCallback(
    async (targetPage: number = page) => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const res = await scanApi.history({
          limit: PAGE_SIZE,
          offset: (targetPage - 1) * PAGE_SIZE,
        });
        setHistoryItems(res.items);
        setTotalHistory(res.total);
      } catch {
        setHistoryError('加载扫描历史失败');
      } finally {
        setHistoryLoading(false);
      }
    },
    [page]
  );

  loadHistoryRef.current = loadHistory;

  const loadStatus = useCallback(async () => {
    try {
      const s = await scanApi.status();
      if (s.isScanning) {
        setScanning(true);
        setProcessed(s.processed);
        setTotal(s.total);
        if (s.currentFile) setCurrentFile(s.currentFile);
        if (s.total > 0) {
          setProgress(Math.round((s.processed / s.total) * 100));
        }
      }
    } catch {
      // 状态查询失败不阻塞页面
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadStatus();
  }, [loadHistory, loadStatus]);

  // 加载后端自动开关配置（设置页保存的键）
  useEffect(() => {
    settingsApi
      .getAll()
      .then((all) => {
        const byKey = new Map(all.map((s) => [s.key, s.value]));
        const ai = byKey.get('ai_parse_auto_enable');
        const sep = byKey.get('separation_auto_enable');
        const md5 = byKey.get('scan_md5_dedup');
        if (ai !== undefined) setAutoParse(ai === 'true');
        if (sep !== undefined) setAutoSeparate(sep === 'true');
        if (md5 !== undefined) setMd5Dedup(md5 !== 'false');
      })
      .catch(() => {
        // 读取失败保持默认值
      });
  }, []);

  // 加载去重任务（scanId → 任务映射，供历史列表关联展示）
  const loadDedupTasks = useCallback(async () => {
    try {
      const tasks = await dedupApi.tasks(50);
      const map: Record<string, DedupTaskItem> = {};
      for (const t of tasks) {
        if (t.scanId) map[t.scanId] = t;
      }
      setDedupByScan(map);
    } catch {
      // 任务列表读取失败不阻塞页面
    }
  }, []);

  useEffect(() => {
    loadDedupTasks();
    const timer = window.setInterval(loadDedupTasks, 30000);
    return () => window.clearInterval(timer);
  }, [loadDedupTasks]);

  // 弹窗打开时懒加载文件处理结果明细；切换筛选/分页时重新加载
  useEffect(() => {
    const scanId = selectedTask?.id;
    if (!scanId) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setResultsLoading(true);
    scanApi
      .results(scanId, {
        status: resultFilter || undefined,
        limit: RESULT_PAGE_SIZE,
        offset: (resultPage - 1) * RESULT_PAGE_SIZE,
      })
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch(() => {
        if (!cancelled) setResults(null);
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.id, resultFilter, resultPage]);

  const handleOpenDetail = (task: ScanTask) => {
    setResults(null);
    setResultPage(1);
    setResultFilter('');
    setSelectedTask(task);
  };

  const handleCloseDetail = () => {
    setSelectedTask(null);
    setResults(null);
  };

  const toggleAutoParse = (v: boolean) => {
    setAutoParse(v);
    settingsApi
      .update([{ key: 'ai_parse_auto_enable', value: String(v) }])
      .then(() => showToast('success', '自动 AI 解析已' + (v ? '开启' : '关闭')))
      .catch(() => showToast('error', '保存自动 AI 解析设置失败'));
  };

  const toggleAutoSeparate = (v: boolean) => {
    setAutoSeparate(v);
    settingsApi
      .update([{ key: 'separation_auto_enable', value: String(v) }])
      .then(() => showToast('success', '自动人声分离已' + (v ? '开启' : '关闭')))
      .catch(() => showToast('error', '保存自动人声分离设置失败'));
  };

  const toggleMd5Dedup = (v: boolean) => {
    setMd5Dedup(v);
    settingsApi
      .update([{ key: 'scan_md5_dedup', value: String(v) }])
      .then(() => showToast('success', 'MD5 文件去重已' + (v ? '开启' : '关闭')))
      .catch(() => showToast('error', '保存 MD5 去重设置失败'));
  };

  useEffect(() => {
    const wsBaseUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws?token=${encodeURIComponent(localStorage.getItem('token') ?? '')}`;
    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed) return;
      if (reconnectTimerRef.current) return;
      const attempts = reconnectAttemptsRef.current;
      if (attempts >= 5) {
        setError('WebSocket 连接失败，请刷新页面重试');
        return;
      }
      const delay = Math.min(1000 * 2 ** attempts, 16000);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        reconnectAttemptsRef.current += 1;
        connect();
      }, delay);
    };

    const handleMessage = (message: ScanWsMessage) => {
      switch (message.type) {
        case 'SCAN_STARTED':
          setScanning(true);
          setProgress(0);
          setProcessed(0);
          setTotal(0);
          setCurrentFile('');
          setError(null);
          break;
        case 'SCAN_PROGRESS': {
          const p = message.payload ?? {};
          if (typeof p.percentage === 'number') {
            setProgress(p.percentage);
          } else if (p.total && p.total > 0 && typeof p.processed === 'number') {
            setProgress(Math.round((p.processed / p.total) * 100));
          }
          if (typeof p.currentFile === 'string') setCurrentFile(p.currentFile);
          if (typeof p.currentPath === 'string') setCurrentPath(p.currentPath);
          if (typeof p.processed === 'number') setProcessed(p.processed);
          if (typeof p.total === 'number') setTotal(p.total);
          break;
        }
        case 'SCAN_COMPLETED':
          setScanning(false);
          setProgress(100);
          setCurrentFile('');
          setPage(1);
          loadHistoryRef.current(1);
          break;
        case 'SCAN_FAILED':
          setScanning(false);
          setError(message.payload?.error || '扫描失败');
          setPage(1);
          loadHistoryRef.current(1);
          break;
      }
    };

    function connect() {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsBaseUrl);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ScanWsMessage;
          handleMessage(message);
        } catch {
          // 忽略无法解析的消息
        }
      };

      ws.onerror = () => {
        // close 回调会触发重连
      };

      ws.onclose = () => {
        if (disposed) return;
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, []);

  const handleTrigger = async () => {
    const path = scanPath.trim();
    if (!path) {
      setError('请输入扫描路径');
      return;
    }
    setTriggering(true);
    setError(null);
    try {
      await scanApi.trigger(path);
      showToast('success', '扫描已启动');
      setCurrentPath(path);
      setProgress(0);
    } catch {
      setError('触发扫描失败，请稍后重试');
      showToast('error', '触发扫描失败，请稍后重试');
    } finally {
      setTriggering(false);
    }
  };

  const handleRerun = async (path: string) => {
    setTriggering(true);
    setError(null);
    try {
      await scanApi.trigger(path);
      showToast('success', '扫描已启动');
      setScanPath(path);
      setCurrentPath(path);
      setProgress(0);
      setScanning(true);
    } catch {
      setError('触发扫描失败，请稍后重试');
      showToast('error', '触发扫描失败，请稍后重试');
    } finally {
      setTriggering(false);
    }
  };

  const busy = triggering || scanning;
  const showProgress = scanning || triggering;

  return (
    <div className="p-lg space-y-lg">
      <ToastContainer />
      <h1 className="text-2xl font-display font-bold text-ink">扫描任务</h1>

      {/* 扫描触发 */}
      <div className="bg-paper-2 border border-border rounded-lg p-lg space-y-md">
        {/* 选择文件夹 */}
        <div className="flex flex-col gap-sm">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4 text-accent" aria-hidden="true" />
            扫描文件夹
          </h3>
          <div className="flex flex-wrap items-center gap-sm">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={busy}
              title={scanPath || '点击选择扫描文件夹'}
              className={[
                'flex-1 min-w-56 flex items-center gap-2 px-3 py-2 rounded-md border border-border',
                'bg-paper text-sm',
                scanPath ? 'text-ink font-mono' : 'text-ink-3',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'transition-colors',
              ].join(' ')}
            >
              <FolderSearch className="w-4 h-4 shrink-0 text-ink-3" aria-hidden="true" />
              <span className="truncate">{scanPath || '点击选择扫描文件夹'}</span>
              {scanPath && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="清除路径"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!busy) setScanPath('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      if (!busy) setScanPath('');
                    }
                  }}
                  className="ml-auto shrink-0 p-0.5 rounded-sm text-ink-3 hover:text-ink hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </span>
              )}
            </button>
            <Button
              size="md"
              variant="secondary"
              disabled={busy}
              onClick={() => setPickerOpen(true)}
              leftIcon={<FolderOpen className="w-4 h-4" aria-hidden="true" />}
            >
              浏览文件夹
            </Button>
            <Button
              size="md"
              loading={busy}
              disabled={busy || !scanPath.trim()}
              onClick={handleTrigger}
              leftIcon={<Play className="w-4 h-4" aria-hidden="true" />}
            >
              开始扫描
            </Button>
          </div>
        </div>
        <FolderPicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(p) => setScanPath(p)}
          initialPath={scanPath || undefined}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-md">
          <div className="border border-border rounded-md p-md space-y-md">
            <h3 className="text-sm font-semibold text-ink">扫描后处理</h3>
            <Toggle
              checked={autoParse}
              onChange={toggleAutoParse}
              label="自动 AI 解析"
              description="完成扫描后自动调用 AI 解析歌曲元数据"
            />
            <Toggle
              checked={autoSeparate}
              onChange={toggleAutoSeparate}
              label="自动人声分离"
              description="完成扫描后自动执行人声分离处理"
            />
          </div>
          <div className="border border-border rounded-md p-md space-y-md">
            <h3 className="text-sm font-semibold text-ink">扫描去重</h3>
            <Toggle
              checked={md5Dedup}
              onChange={toggleMd5Dedup}
              label="MD5 文件去重"
              description="跳过文件哈希与库中歌曲相同的文件"
            />
            <p className="text-xs text-ink-3">
              智能去重（同名 + 同歌手 + 同版本比对）已移至「去重管理」，可控制开关、查看任务与结果并还原。
            </p>
            <Link
              to="/dedup"
              className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
            >
              <CopyX className="w-4 h-4" aria-hidden="true" />
              去重管理
            </Link>
          </div>
        </div>
        {error && (
          <div
            className="flex items-center gap-2 text-sm text-danger"
            role="alert"
          >
            <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* 进度条 */}
      {showProgress && (
        <div className="bg-paper-2 border border-border rounded-lg p-lg space-y-sm">
          <div className="flex justify-between text-sm text-ink-2">
            <span className="flex items-center gap-1.5 min-w-0">
              <Loader2
                className="w-3.5 h-3.5 animate-spin text-accent shrink-0"
                aria-hidden="true"
              />
              <span>{scanning ? '扫描中' : '准备中'}</span>
              {currentPath && (
                <span className="text-ink-3 font-mono truncate">
                  · {currentPath}
                </span>
              )}
            </span>
            <span className="font-mono text-ink shrink-0">{progress}%</span>
          </div>
          <div className="h-2 bg-paper-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-base ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-ink-3 font-mono truncate">
            {currentFile ? `当前文件: ${currentFile}` : '准备中...'}
          </p>
          <div className="flex justify-end text-xs text-ink-3 font-mono">
            <span>
              已扫描 {processed}/{total > 0 ? total : '?'}
            </span>
          </div>
        </div>
      )}

      {/* 扫描历史 */}
      <div className="bg-paper-2 border border-border rounded-lg overflow-hidden">
        <div className="p-md border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-display font-semibold text-ink">
            扫描历史
          </h2>
          <button
            type="button"
            onClick={() => loadHistory()}
            disabled={historyLoading}
            className="text-sm text-accent enabled:hover:text-accent-hover disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm inline-flex items-center gap-1"
          >
            {historyLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                刷新中
              </>
            ) : (
              '刷新'
            )}
          </button>
        </div>
        {historyLoading && historyItems.length === 0 ? (
          <Loading />
        ) : historyError ? (
          <div
            className="p-lg text-sm text-danger flex items-center gap-2"
            role="alert"
          >
            <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {historyError}
          </div>
        ) : historyItems.length === 0 ? (
          <div className="p-lg text-sm text-ink-3">暂无扫描记录</div>
        ) : (
          <div className="divide-y divide-border">
            {historyItems.map((task) => {
              const r = task.result;
              const dedupTask = dedupByScan[task.id];
              return (
                <div
                  key={task.id}
                  className="px-md py-sm hover:bg-paper-3 transition-colors"
                >
                  <div className="flex items-center gap-md flex-wrap min-w-0">
                    <div className="flex items-center gap-sm min-w-0 flex-1">
                      <StatusIcon status={task.status} />
                      <span
                        className="text-sm text-ink font-mono truncate"
                        title={task.scanPath}
                      >
                        {task.scanPath}
                      </span>
                    </div>
                    <div className="flex items-center gap-xs text-xs text-ink-3">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      <span>{formatTimestamp(task.startTime)}</span>
                    </div>
                    <div className="text-xs text-ink-3 font-mono w-20 text-right">
                      {formatDuration(task.startTime, task.endTime)}
                    </div>
                    {r?.newSongs !== undefined && (
                      <div className="text-xs text-success font-mono">
                        +{r.newSongs}
                      </div>
                    )}
                    {r?.updatedSongs !== undefined && (
                      <div className="text-xs text-info font-mono">
                        ~{r.updatedSongs}
                      </div>
                    )}
                    {r?.errorCount !== undefined && r.errorCount > 0 && (
                      <div className="text-xs text-danger font-mono">
                        ✕{r.errorCount}
                      </div>
                    )}
                    <StatusBadge status={task.status} />
                    {dedupTask && (
                      <Link
                        to={`/dedup?task=${dedupTask.id}`}
                        title={`查看去重结果：检查 ${dedupTask.checked} 首，删除 ${dedupTask.removed} 首`}
                        className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                      >
                        <CopyX className="w-3.5 h-3.5" aria-hidden="true" />
                        去重：删 {dedupTask.removed} 首
                        <ChevronRight className="w-3 h-3" aria-hidden="true" />
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenDetail(task)}
                      leftIcon={<Eye className="w-3.5 h-3.5" aria-hidden="true" />}
                    >
                      详情
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
                      onClick={() => handleRerun(task.scanPath)}
                      disabled={busy}
                    >
                      重新扫描
                    </Button>
                  </div>
                  {task.status === 'failed' && task.error && (
                    <p
                      className="mt-xs text-xs text-danger truncate"
                      title={task.error}
                    >
                      {task.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!historyLoading && !historyError && totalHistory > 0 && (
          <div className="px-md py-sm border-t border-border flex items-center justify-between gap-md flex-wrap">
            <span className="text-sm text-ink-3">
              第 {page}/{Math.max(1, Math.ceil(totalHistory / PAGE_SIZE))} 页，共{' '}
              {totalHistory} 条
            </span>
            <Pagination
              currentPage={page}
              totalPages={Math.max(1, Math.ceil(totalHistory / PAGE_SIZE))}
              onPageChange={setPage}
              state={historyLoading ? 'loading' : 'default'}
            />
          </div>
        )}
      </div>

      {/* 扫描详情弹窗 */}
      <Modal isOpen={selectedTask !== null} onClose={handleCloseDetail} title="扫描详情" size="lg">
        {selectedTask && (
          <div className="space-y-md">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-sm text-sm">
              <div>
                <p className="text-xs text-ink-3">新增</p>
                <p className="font-mono text-success">
                  +{selectedTask.result?.newSongs ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-3">更新</p>
                <p className="font-mono text-info">
                  ~{selectedTask.result?.updatedSongs ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-3">跳过</p>
                <p className="font-mono text-ink-2">
                  {selectedTask.result?.skippedSongs ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-3">错误</p>
                <p
                  className={`font-mono ${(selectedTask.result?.errorCount ?? 0) > 0 ? 'text-danger' : 'text-ink-2'}`}
                >
                  {selectedTask.result?.errorCount ?? 0}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-lg gap-y-sm text-sm">
              <div className="space-y-xs min-w-0">
                <dt className="text-xs text-ink-3">扫描路径</dt>
                <dd className="font-mono text-ink break-all">
                  {selectedTask.scanPath}
                </dd>
              </div>
              <div className="space-y-xs min-w-0">
                <dt className="text-xs text-ink-3">扫描时间</dt>
                <dd className="text-ink-2">
                  {formatTimestamp(selectedTask.startTime)}
                  {selectedTask.endTime
                    ? ` ~ ${formatTimestamp(selectedTask.endTime)}（${formatDuration(selectedTask.startTime, selectedTask.endTime)}）`
                    : '（进行中）'}
                </dd>
              </div>
            </dl>
            {selectedTask.status === 'failed' && selectedTask.error && (
              <div className="space-y-xs">
                <p className="text-xs text-ink-3">失败原因</p>
                <p className="text-sm text-danger break-all">
                  {selectedTask.error}
                </p>
              </div>
            )}
            <div className="space-y-sm">
              <div className="flex items-center justify-between gap-sm flex-wrap">
                <p className="text-xs text-ink-3">
                  文件处理结果
                  {results &&
                    `（共 ${results.counts.new + results.counts.updated + results.counts.skipped + results.counts.error} 首）`}
                </p>
                <div className="flex gap-xs" role="tablist" aria-label="结果状态筛选">
                  {(['', 'new', 'updated', 'skipped', 'error'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      aria-selected={resultFilter === s}
                      onClick={() => {
                        setResultFilter(s);
                        setResultPage(1);
                      }}
                      className={[
                        'px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        resultFilter === s
                          ? 'bg-paper-3 text-accent'
                          : 'text-ink-3 hover:text-ink',
                      ].join(' ')}
                    >
                      {s === '' ? '全部' : RESULT_STATUS_META[s].label}
                      {results && (
                        <span className="ml-1 font-mono">
                          {s === '' ? results.total : results.counts[s]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              {resultsLoading ? (
                <div className="text-sm text-ink-3 py-sm">加载中...</div>
              ) : !results || results.items.length === 0 ? (
                <div className="text-sm text-ink-3 py-sm">暂无记录</div>
              ) : (
                <ul className="divide-y divide-border max-h-60 overflow-y-auto pr-sm">
                  {results.items.map((item) => (
                    <li key={item.id} className="py-xs flex items-center gap-sm min-w-0">
                      <span
                        className={[
                          'shrink-0 text-xs font-medium w-8',
                          RESULT_STATUS_META[item.status].color,
                        ].join(' ')}
                      >
                        {RESULT_STATUS_META[item.status].label}
                      </span>
                      <span
                        className="text-xs font-mono text-ink-2 truncate"
                        title={item.filePath}
                      >
                        {item.filePath}
                      </span>
                      {(item.reason || item.error) && (
                        <span
                          className="text-xs text-ink-3 truncate ml-auto"
                          title={item.reason || item.error || undefined}
                        >
                          {item.reason || item.error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {results && results.total > RESULT_PAGE_SIZE && (
                <Pagination
                  currentPage={resultPage}
                  totalPages={Math.ceil(results.total / RESULT_PAGE_SIZE)}
                  onPageChange={setResultPage}
                  state={resultsLoading ? 'loading' : 'default'}
                />
              )}
            </div>
            {selectedTask.result && selectedTask.result.errors.length > 0 && (
              <div className="space-y-xs">
                <p className="text-xs text-ink-3">
                  错误明细（共 {selectedTask.result.errorCount} 条，显示前{' '}
                  {Math.min(selectedTask.result.errors.length, 50)} 条）
                </p>
                <ul className="space-y-1 max-h-40 overflow-y-auto pr-sm">
                  {selectedTask.result.errors.slice(0, 50).map((e, i) => (
                    <li key={i} className="text-xs text-danger font-mono break-all">
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
