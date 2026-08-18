/* Hallmark · page: dedup · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * 去重开关控制 + 任务列表 + 结果详情 + 手动还原
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw, Clock, CopyX, Eye } from 'lucide-react';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import {
  dedupApi,
  type DedupResult,
  type DedupTaskItem,
  type DedupProgress,
} from '../api/dedup';
import { settingsApi } from '../api/settings';
import { useToast } from '../components/Toast';

const css = `
/* 去重页自定义样式（Hallmark 令牌：--color-* / --space-*） */
.dedup-status-note {
  font-size: 12px;
  color: var(--color-ink-3);
  line-height: 1.6;
}
`;

function SwitchToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-sm text-left group"
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

function TaskStatusBadge({ status }: { status: string }) {
  if (status === 'completed')
    return (
      <Badge variant="success" dot>
        完成
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge variant="danger" dot>
        失败
      </Badge>
    );
  return (
    <Badge variant="warning" dot>
      进行中
    </Badge>
  );
}

function formatDateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function formatDuration(start: number, end: number): string {
  const totalSec = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function Dedup() {
  const { showToast, ToastContainer } = useToast();
  const [searchParams] = useSearchParams();
  const focusTaskId = searchParams.get('task');

  const [aiDedup, setAiDedup] = useState(false);
  const [dedupRunning, setDedupRunning] = useState(false);
  const [dedupProgress, setDedupProgress] = useState<DedupProgress>({
    running: false,
    stage: '',
    processed: 0,
    total: 0,
    percent: 0,
  });
  const [dedupResult, setDedupResult] = useState<DedupResult | null>(null);
  const [dedupTasks, setDedupTasks] = useState<DedupTaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(
    focusTaskId ? Number(focusTaskId) || null : null,
  );
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const loadDedupTasks = useCallback(async () => {
    try {
      const tasks = await dedupApi.tasks(20);
      setDedupTasks(tasks);
    } catch {
      // 任务列表读取失败不阻塞页面
    }
  }, []);

  // 加载开关配置 + 去重状态 + 任务记录
  useEffect(() => {
    settingsApi
      .getAll()
      .then((all) => {
        const byKey = new Map(all.map((s) => [s.key, s.value]));
        const aiDedupVal = byKey.get('ai_dedup_enabled');
        if (aiDedupVal !== undefined) setAiDedup(aiDedupVal === 'true');
      })
      .catch(() => {
        // 读取失败保持默认值
      });

    dedupApi
      .status()
      .then((s) => {
        setDedupResult(s.lastResult);
        if (s.progress.running) {
          setDedupRunning(true);
          setDedupProgress(s.progress);
        }
      })
      .catch(() => {
        // 状态查询失败不阻塞页面
      });
    loadDedupTasks();
  }, [loadDedupTasks]);

  // 从扫描页跳转：自动打开指定任务
  useEffect(() => {
    if (focusTaskId) {
      setSelectedTaskId(Number(focusTaskId) || null);
    }
  }, [focusTaskId]);

  const toggleAiDedup = (v: boolean) => {
    setAiDedup(v);
    settingsApi
      .update([{ key: 'ai_dedup_enabled', value: String(v) }])
      .then(() => showToast('success', '智能去重已' + (v ? '开启' : '关闭')))
      .catch(() => showToast('error', '保存 AI 去重设置失败'));
  };

  const handleRunDedup = async () => {
    if (dedupRunning) return;
    setDedupRunning(true);
    setDedupProgress({ running: true, stage: '启动中', processed: 0, total: 0, percent: 0 });
    try {
      await dedupApi.run();
    } catch {
      showToast('error', '启动去重失败');
      setDedupRunning(false);
    }
  };

  // 去重运行中轮询进度（每 1s），完成后刷新结果与任务记录
  useEffect(() => {
    if (!dedupRunning) return;
    const timer = window.setInterval(async () => {
      try {
        const s = await dedupApi.status();
        setDedupProgress(s.progress);
        if (!s.progress.running) {
          window.clearInterval(timer);
          setDedupRunning(false);
          setDedupResult(s.lastResult);
          loadDedupTasks();
          if (s.lastResult) {
            showToast(
              'success',
              `去重完成：检查 ${s.lastResult.checked} 首，删除重复 ${s.lastResult.removed} 首`,
            );
          }
        }
      } catch {
        // 轮询失败继续等待
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [dedupRunning, loadDedupTasks, showToast]);

  const handleRestore = async (taskId: number, removedId: number) => {
    if (restoringId !== null) return;
    setRestoringId(removedId);
    try {
      const data = await dedupApi.restore(taskId, removedId);
      if (data.restored) {
        showToast('success', '还原成功，后续去重将跳过该文件');
      } else if (data.songId === null) {
        showToast('warning', '文件已不存在，已记录例外（不再被去重删除）');
      }
      loadDedupTasks();
    } catch {
      showToast('error', '还原失败');
    } finally {
      setRestoringId(null);
    }
  };

  const selectedTask = dedupTasks.find((t) => t.id === selectedTaskId) ?? null;

  return (
    <>
      <style>{css}</style>
      <div className="space-y-md">
        {/* 去重开关与执行 */}
        <div className="border border-border rounded-md p-md space-y-md">
          <div className="flex items-center gap-sm">
            <CopyX className="w-4 h-4 text-accent" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-ink">去重控制</h3>
          </div>
          <SwitchToggle
            checked={aiDedup}
            onChange={toggleAiDedup}
            label="智能去重（本地脚本）"
            description="基于库内歌曲信息本地比对：同名 + 同歌手 + 同版本视为重复（音频与视频不互判，不调用 AI 接口），默认关闭"
          />
          <div className="flex flex-wrap items-center gap-sm pt-xs">
            <Button
              size="sm"
              variant="secondary"
              loading={dedupRunning}
              disabled={dedupRunning || !aiDedup}
              onClick={handleRunDedup}
              leftIcon={<RotateCcw className="w-4 h-4" aria-hidden="true" />}
            >
              {dedupRunning ? '去重中…' : '立即执行去重'}
            </Button>
            {aiDedup && (
              <span className="text-xs text-ink-3">
                已检查歌曲数：{dedupResult?.checked ?? 0}
                {dedupResult && dedupResult.removed > 0
                  ? `，删除重复 ${dedupResult.removed} 首`
                  : ''}
              </span>
            )}
          </div>

          {/* 去重进度条 */}
          {dedupRunning && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-ink-3">
                <span>{dedupProgress.stage || '处理中…'}</span>
                <span>{dedupProgress.percent}%</span>
              </div>
              <div
                className="h-1.5 rounded-full bg-paper-3 overflow-hidden"
                role="progressbar"
                aria-valuenow={dedupProgress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-accent transition-[width] duration-300"
                  style={{ width: `${dedupProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          <p className="dedup-status-note">
            开启后，扫描任务的 AI 解析完成后会自动执行去重；手动执行随时可触发。还原的歌曲会记录例外，后续去重不再删除。扫描任务列表可点击「查看去重」直接跳转到对应任务。
          </p>
        </div>

        {/* 去重任务列表 */}
        <div className="border border-border rounded-md overflow-hidden">
          <div className="flex items-center gap-2 px-md py-sm bg-paper-2 border-b border-border">
            <h3 className="text-sm font-semibold text-ink">去重任务记录</h3>
            <span className="text-xs text-ink-3">（点击「详情」查看结果并还原）</span>
          </div>

          {dedupTasks.length === 0 && (
            <EmptyState
              icon={<CopyX className="w-8 h-8" />}
              title="暂无去重任务"
              description="开启开关并执行去重后，记录会显示在这里"
            />
          )}

          <div className="divide-y divide-border">
            {dedupTasks.map((task) => (
              <div
                key={task.id}
                className="px-md py-sm hover:bg-paper-3 transition-colors"
              >
                <div className="flex items-center gap-md flex-wrap min-w-0">
                  <div className="flex items-center gap-sm min-w-0 flex-1">
                    <Clock className="w-4 h-4 shrink-0 text-ink-3" aria-hidden="true" />
                    <span className="text-sm text-ink font-mono truncate">
                      #{task.id} · {formatDateTime(task.startedAt)}
                    </span>
                    {task.scanId && (
                      <span className="text-xs text-ink-3 font-mono truncate">
                        {task.scanId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-sm shrink-0">
                    <span className="text-xs text-ink-3 font-mono">
                      检查 {task.checked} · 删除 {task.removed}
                    </span>
                    <TaskStatusBadge status={task.status} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTaskId(task.id)}
                      leftIcon={<Eye className="w-3.5 h-3.5" aria-hidden="true" />}
                    >
                      详情
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <ToastContainer />
      </div>

      {/* 去重任务详情弹窗 */}
      <Modal
        isOpen={selectedTask !== null}
        onClose={() => setSelectedTaskId(null)}
        title="去重任务详情"
        size="lg"
      >
        {selectedTask && (
          <div className="space-y-md">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-sm text-sm">
              <div>
                <p className="text-xs text-ink-3">检查</p>
                <p className="font-mono text-ink">{selectedTask.checked}</p>
              </div>
              <div>
                <p className="text-xs text-ink-3">删除</p>
                <p
                  className={`font-mono ${selectedTask.removed > 0 ? 'text-danger' : 'text-ink-2'}`}
                >
                  {selectedTask.removed}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-3">状态</p>
                <TaskStatusBadge status={selectedTask.status} />
              </div>
              <div>
                <p className="text-xs text-ink-3">任务 ID</p>
                <p className="font-mono text-ink-2">#{selectedTask.id}</p>
              </div>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-lg gap-y-sm text-sm">
              <div className="space-y-xs min-w-0">
                <dt className="text-xs text-ink-3">开始时间</dt>
                <dd className="text-ink-2">{formatDateTime(selectedTask.startedAt)}</dd>
              </div>
              <div className="space-y-xs min-w-0">
                <dt className="text-xs text-ink-3">完成时间</dt>
                <dd className="text-ink-2">
                  {selectedTask.completedAt
                    ? `${formatDateTime(selectedTask.completedAt)}（耗时 ${formatDuration(selectedTask.startedAt, selectedTask.completedAt)}）`
                    : '（进行中）'}
                </dd>
              </div>
            </dl>
            {selectedTask.scanId && (
              <div className="space-y-xs">
                <p className="text-xs text-ink-3">关联扫描</p>
                <p className="text-sm font-mono text-ink break-all">
                  {selectedTask.scanId}
                </p>
              </div>
            )}
            {selectedTask.status === 'failed' && selectedTask.error && (
              <div className="space-y-xs">
                <p className="text-xs text-ink-3">失败原因</p>
                <p className="text-sm text-danger break-all">{selectedTask.error}</p>
              </div>
            )}
            <div className="space-y-sm">
              <p className="text-xs text-ink-3">
                删除明细
                {selectedTask.duplicates.length > 0 &&
                  `（${selectedTask.duplicates.length} 首）`}
              </p>
              {selectedTask.duplicates.length === 0 ? (
                <p className="text-sm text-ink-3 py-sm">未发现重复歌曲</p>
              ) : (
                <ul className="divide-y divide-border max-h-60 overflow-y-auto pr-sm">
                  {selectedTask.duplicates.map((d) => (
                    <li
                      key={d.removedId}
                      className="py-xs flex items-center gap-sm min-w-0"
                    >
                      <span className="shrink-0 text-xs font-medium text-danger w-8">
                        删除
                      </span>
                      <span
                        className="text-xs font-mono text-ink-2 truncate"
                        title={d.filePath}
                      >
                        #{d.removedId}「{d.title}」
                      </span>
                      <span
                        className="text-xs text-ink-3 truncate ml-auto"
                        title={d.reason}
                      >
                        {d.reason}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={restoringId === d.removedId}
                        disabled={restoringId !== null}
                        onClick={() => handleRestore(selectedTask.id, d.removedId)}
                      >
                        还原
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
