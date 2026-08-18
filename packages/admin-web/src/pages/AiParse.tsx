/* Hallmark · page: ai-parse · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (46–50)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot,
  Save,
  RefreshCw,
  Check,
  X,
  AlertCircle,
  Eye,
  Loader2,
  Settings,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Undo2,
  Trash2,
  Plus,
  Search,
  Pencil,
} from 'lucide-react';
import { aiParseApi } from '../api/ai-parse';
import type { AiParseTask, AiConfig, PromptTemplate, AiParseStats } from '../api/ai-parse';
import { songsApi } from '../api/songs';
import type { Song } from '../types';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import Input from '../components/Input';
import Loading from '../components/Loading';
import Pagination from '../components/Pagination';
import { useToast } from '../components/Toast';

const statusVariantMap: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  pending: 'neutral',
  processing: 'info',
  completed: 'success',
  failed: 'danger',
  rejected: 'warning',
  rolled_back: 'warning',
};

const statusLabel: Record<string, string> = {
  pending: '待处理',
  processing: '解析中',
  completed: '已完成',
  failed: '失败',
  rejected: '已拒绝',
  rolled_back: '已回滚',
};

const filterTabs = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'need_review', label: '待审核' },
];

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的音乐元数据解析助手。你的任务是分析歌曲文件信息，推断出歌曲的完整元数据。

你需要返回一个JSON对象，包含以下字段：
- title: 歌曲标题（字符串）
- artist: 歌手名（字符串）
- album: 专辑名（字符串，可选）
- year: 发行年份（数字，可选）
- genre: 音乐风格（字符串，可选）
- language: 语种（字符串，可选）
- mood: 心情标签（字符串，可选）
- confidence: 置信度（0-1之间的数字，表示你对解析结果的信心）

语种可选值：国语、粤语、英语、日语、韩语、闽南语、其他
风格可选值：流行、摇滚、民谣、古典、电子、说唱、R&B、爵士、其他
心情可选值：伤感、欢快、励志、浪漫、激情、安静、思念、其他

请只返回JSON对象，不要包含其他文字。`;

const DEFAULT_USER_PROMPT = `请解析以下歌曲信息：

文件名: {fileName}
当前标题: {title}
当前歌手: {artistName}
文件类型: {fileType}

已有歌手参考列表（如果匹配请使用已有歌手名）：
{existingArtists}

已有分类参考：
{existingCategories}

请根据文件名和已有信息，推断歌曲的完整元数据，并以JSON格式返回。`;

const PROMPT_VARIABLES = [
  { name: '{fileName}', desc: '歌曲文件名' },
  { name: '{title}', desc: '当前歌曲标题' },
  { name: '{artistName}', desc: '当前歌手名' },
  { name: '{fileType}', desc: '文件类型 (audio/video)' },
  { name: '{existingArtists}', desc: '已有歌手参考列表' },
  { name: '{existingCategories}', desc: '已有分类参考' },
];

function formatConfidence(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 100)}%`;
}

function confidenceClass(value: number | null): string {
  if (value === null || value === undefined) return 'text-ink-3';
  if (value >= 0.8) return 'text-success';
  if (value >= 0.5) return 'text-warning';
  return 'text-danger';
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function safeParseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatJson(obj: unknown): string {
  try {
    if (typeof obj === 'string') return JSON.stringify(JSON.parse(obj), null, 2);
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={[
          'w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-ink-2',
          'bg-paper-2 hover:bg-paper-3 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        ].join(' ')}
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

export default function AiParse() {
  const [config, setConfig] = useState<AiConfig>({
    baseUrl: '',
    apiKey: '',
    model: '',
    enabled: false,
  });
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  const [stats, setStats] = useState<AiParseStats>({ pending: 0, completed: 0, failed: 0, needReview: 0 });
  const [tasks, setTasks] = useState<AiParseTask[]>([]);
  const [total, setTotal] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [batchRetrying, setBatchRetrying] = useState(false);

  const [detailTask, setDetailTask] = useState<AiParseTask | null>(null);
  const [draftResult, setDraftResult] = useState<Record<string, any> | null>(null);
  const [draftMode, setDraftMode] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState<PromptTemplate>({
    systemPrompt: '',
    userPromptTemplate: '',
  });

  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [songPickerLoading, setSongPickerLoading] = useState(false);
  const [songPickerSongs, setSongPickerSongs] = useState<Song[]>([]);
  const [songPickerSelected, setSongPickerSelected] = useState<Set<number>>(new Set());
  const [songPickerKeyword, setSongPickerKeyword] = useState('');
  const [songPickerPage, setSongPickerPage] = useState(1);
  const [songPickerTotal, setSongPickerTotal] = useState(0);
  const [songPickerSubmitting, setSongPickerSubmitting] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: React.ReactNode;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const { showToast, ToastContainer } = useToast();
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const data = await aiParseApi.getConfig();
      setConfig(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载 AI 配置失败';
      showToast('error', msg);
    } finally {
      setConfigLoading(false);
    }
  }, [showToast]);

  const loadStats = useCallback(async () => {
    try {
      const data = await aiParseApi.getStats();
      setStats(data);
    } catch {
      // silent
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const params: { limit: number; offset: number; status?: string } = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      };
      if (statusFilter !== 'all' && statusFilter !== 'need_review') {
        params.status = statusFilter;
      }
      const res = await aiParseApi.getTasks(params);
      let items = res.items ?? [];
      if (statusFilter === 'need_review') {
        items = items.filter(t => t.needReview === 1);
      }
      setTasks(items);
      setTotal(res.total ?? items.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加载任务列表失败';
      showToast('error', msg);
    } finally {
      setTasksLoading(false);
    }
  }, [page, pageSize, statusFilter, showToast]);

  useEffect(() => {
    loadConfig();
    loadStats();
  }, [loadConfig, loadStats]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const hasActiveTasks = stats.pending > 0;

  useEffect(() => {
    if (hasActiveTasks) {
      refreshRef.current = setInterval(() => {
        loadTasks();
        loadStats();
      }, 10000);
    }
    return () => {
      if (refreshRef.current) {
        clearInterval(refreshRef.current);
        refreshRef.current = null;
      }
    };
  }, [hasActiveTasks, loadTasks, loadStats]);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [statusFilter]);

  useEffect(() => {
    setSelected(new Set());
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(
    (statusFilter === 'need_review' ? stats.needReview : total) / pageSize
  ));

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      await aiParseApi.updateConfig(config);
      showToast('success', '配置已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存配置失败';
      showToast('error', msg);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await aiParseApi.testConnection();
      setTestResult(result);
      if (result.success) {
        showToast('success', result.message || '连接正常');
      } else {
        showToast('warning', result.message || '连接测试失败');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '连接测试失败';
      setTestResult({ success: false, message: msg });
      showToast('error', msg);
    } finally {
      setTesting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(prev => {
      if (prev.size === tasks.length) return new Set();
      return new Set(tasks.map(t => t.id));
    });
  };

  const handleReparse = async (task: AiParseTask) => {
    setActionLoadingId(task.id);
    try {
      await aiParseApi.reparse(task.id);
      showToast('success', '重新解析已触发');
      await loadTasks();
      await loadStats();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '重新解析失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRollback = async (task: AiParseTask) => {
    setActionLoadingId(task.id);
    try {
      await aiParseApi.rollback(task.id);
      showToast('success', '回滚成功');
      setDetailTask(null);
      await loadTasks();
      await loadStats();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '回滚失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleApprove = async (task: AiParseTask) => {
    setActionLoadingId(task.id);
    try {
      await aiParseApi.review(task.id, { action: 'approve' });
      showToast('success', '已通过审核');
      setDetailTask(null);
      await loadTasks();
      await loadStats();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '审核操作失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (task: AiParseTask) => {
    setActionLoadingId(task.id);
    try {
      await aiParseApi.review(task.id, { action: 'reject' });
      showToast('success', '已拒绝');
      setDetailTask(null);
      await loadTasks();
      await loadStats();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '审核操作失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleBatchParse = async () => {
    const selectedTasks = tasks.filter(t => selected.has(t.id));
    if (selectedTasks.length === 0) {
      showToast('warning', '请先选择任务');
      return;
    }
    const songIds = Array.from(new Set(selectedTasks.map(t => t.songId)));
    try {
      await aiParseApi.batchParse(songIds);
      showToast('success', `已提交 ${songIds.length} 首歌曲的批量解析`);
      setSelected(new Set());
      await loadTasks();
      await loadStats();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '批量解析失败';
      showToast('error', msg);
    }
  };

  const handleBatchRetry = async () => {
    const failedSelected = tasks.filter(t => selected.has(t.id) && t.status === 'failed');
    if (failedSelected.length === 0) {
      showToast('warning', '请选择失败的任务');
      return;
    }
    setBatchRetrying(true);
    try {
      let ok = 0;
      let fail = 0;
      for (const task of failedSelected) {
        try {
          await aiParseApi.retry(task.id);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      setSelected(new Set());
      await loadTasks();
      await loadStats();
      if (fail > 0) {
        showToast('error', `批量重试完成：成功 ${ok}，失败 ${fail}`);
      } else {
        showToast('success', `批量重试完成：${ok} 个任务`);
      }
    } finally {
      setBatchRetrying(false);
    }
  };

  const handleBatchRollback = async () => {
    const completedSelected = tasks.filter(
      t => selected.has(t.id) && t.status === 'completed' && t.originalTitle
    );
    if (completedSelected.length === 0) {
      showToast('warning', '请选择可回滚的任务');
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const task of completedSelected) {
      try {
        await aiParseApi.rollback(task.id);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setSelected(new Set());
    await loadTasks();
    await loadStats();
    if (fail > 0) {
      showToast('error', `批量回滚完成：成功 ${ok}，失败 ${fail}`);
    } else {
      showToast('success', `批量回滚完成：${ok} 个任务`);
    }
  };

  const handleDelete = (task: AiParseTask) => {
    setConfirmDialog({
      title: '确认删除任务',
      message: (
        <>
          确定要删除 AI 解析任务{' '}
          <strong className="text-ink">#{task.id}</strong> 吗？删除后无法恢复。
        </>
      ),
      onConfirm: async () => {
        setActionLoadingId(task.id);
        try {
          await aiParseApi.deleteTask(task.id);
          showToast('success', '已删除');
          setSelected(prev => { const next = new Set(prev); next.delete(task.id); return next; });
          await loadTasks();
          await loadStats();
        } catch (err) {
          showToast('error', err instanceof Error ? err.message : '删除失败');
        } finally {
          setActionLoadingId(null);
        }
      },
    });
  };

  const handleBatchDelete = () => {
    const deletableIds = tasks.filter(t => selected.has(t.id) && t.status !== 'pending' && t.status !== 'processing').map(t => t.id);
    if (deletableIds.length === 0) {
      showToast('warning', '请选择已完成或失败的任务');
      return;
    }
    setConfirmDialog({
      title: '确认批量删除',
      message: (
        <>
          确定要删除选中的{' '}
          <strong className="text-ink">{deletableIds.length}</strong> 个 AI 解析任务吗？
          删除后无法恢复。
        </>
      ),
      onConfirm: async () => {
        try {
          const res = await aiParseApi.deleteBatch(deletableIds);
          showToast('success', `已删除 ${res.deleted} 个任务`);
          setSelected(new Set());
          await loadTasks();
          await loadStats();
        } catch (err) {
          showToast('error', err instanceof Error ? err.message : '批量删除失败');
        }
      },
    });
  };

  const openSongPicker = async () => {
    setSongPickerOpen(true);
    setSongPickerSelected(new Set());
    setSongPickerKeyword('');
    setSongPickerPage(1);
    await loadSongPicker(1, '');
  };

  const loadSongPicker = async (p: number, keyword: string) => {
    setSongPickerLoading(true);
    try {
      const res = await songsApi.list({ page: p, pageSize: 20, keyword: keyword || undefined });
      setSongPickerSongs(res.items);
      setSongPickerTotal(res.total);
    } catch {
      setSongPickerSongs([]);
    } finally {
      setSongPickerLoading(false);
    }
  };

  const handleSongPickerSearch = () => {
    setSongPickerPage(1);
    loadSongPicker(1, songPickerKeyword);
  };

  const handleSongPickerSubmit = async () => {
    const songIds = Array.from(songPickerSelected);
    if (songIds.length === 0) {
      showToast('warning', '请选择歌曲');
      return;
    }
    setSongPickerSubmitting(true);
    try {
      const res = await aiParseApi.batchTrigger(songIds);
      showToast('success', `已提交 ${res.count} 首歌曲的 AI 解析`);
      setSongPickerOpen(false);
      await loadTasks();
      await loadStats();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '提交失败');
    } finally {
      setSongPickerSubmitting(false);
    }
  };

  const openDetail = async (task: AiParseTask) => {
    setDetailLoading(true);
    setDraftMode(false);
    setDraftResult(null);
    try {
      const full = await aiParseApi.getTask(task.id);
      setDetailTask(full);
    } catch {
      setDetailTask(task);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApplyModified = async () => {
    if (!detailTask || !draftResult) return;
    setActionLoadingId(detailTask.id);
    try {
      await aiParseApi.review(detailTask.id, {
        action: 'modify',
        modifiedResult: draftResult,
      });
      showToast('success', '已应用修改');
      setDetailTask(null);
      setDraftMode(false);
      setDraftResult(null);
      await loadTasks();
      await loadStats();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '修改应用失败');
    } finally {
      setActionLoadingId(null);
    }
  };

  const openPromptConfig = async () => {
    setPromptModalOpen(true);
    try {
      const tpl = await aiParseApi.getPrompt();
      setPromptTemplate(tpl);
    } catch {
      setPromptTemplate({
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        userPromptTemplate: DEFAULT_USER_PROMPT,
      });
    }
  };

  const handleSavePrompt = async () => {
    setPromptSaving(true);
    try {
      await aiParseApi.updatePrompt(promptTemplate);
      showToast('success', '提示词配置已保存');
      setPromptModalOpen(false);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '保存失败');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetPrompt = () => {
    setPromptTemplate({
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      userPromptTemplate: DEFAULT_USER_PROMPT,
    });
  };

  const detailParsed = detailTask ? safeParseJson(detailTask.result) : null;
  const detailMessages = detailTask ? safeParseJson(detailTask.requestMessages) : null;
  const selectedCount = selected.size;

  return (
    <div className="p-lg">
      <ToastContainer />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={!!confirmDialog}
        title={confirmDialog?.title || '确认操作'}
        message={confirmDialog?.message ?? null}
        loading={confirmLoading}
        onConfirm={() => {
          const dialog = confirmDialog;
          if (!dialog) return;
          setConfirmLoading(true);
          Promise.resolve(dialog.onConfirm()).finally(() => {
            setConfirmLoading(false);
            setConfirmDialog(null);
          });
        }}
        onCancel={() => setConfirmDialog(null)}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-md mb-lg">
        <div>
          <h1 className="text-2xl font-display font-bold text-ink mb-xs">AI 解析管理</h1>
          <p className="text-sm text-ink-3">
            配置 AI 模型，管理歌曲元数据解析任务和识别记录
          </p>
        </div>
        <div className="flex items-center gap-sm">
          <Button
            size="sm"
            onClick={openSongPicker}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            选择歌曲解析
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestConnection}
            loading={testing}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            测试连接
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={openPromptConfig}
            leftIcon={<Settings className="w-3.5 h-3.5" />}
          >
            提示词配置
          </Button>
        </div>
      </div>

      <div className="bg-paper border border-border rounded-lg mb-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setConfigExpanded(v => !v)}
          className={[
            'w-full flex items-center justify-between px-md py-sm',
            'hover:bg-paper-2 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          ].join(' ')}
        >
          <div className="flex items-center gap-sm">
            <Bot className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold font-display text-ink">AI 模型配置</h2>
            {testResult && (
              <span
                className={[
                  'inline-flex items-center gap-1 text-xs',
                  testResult.success ? 'text-success' : 'text-danger',
                ].join(' ')}
              >
                {testResult.success ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5" />
                )}
                {testResult.success ? '连接正常' : testResult.message || '连接失败'}
              </span>
            )}
          </div>
          {configExpanded ? (
            <ChevronDown className="w-4 h-4 text-ink-3" />
          ) : (
            <ChevronRight className="w-4 h-4 text-ink-3" />
          )}
        </button>
        {configExpanded && (
          <div className="px-md pb-md border-t border-border pt-md">
            {configLoading ? (
              <Loading />
            ) : (
              <div className="space-y-md">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                  <Input
                    label="Base URL"
                    value={config.baseUrl}
                    onChange={e => setConfig(c => ({ ...c, baseUrl: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                  />
                  <Input
                    label="Model"
                    value={config.model}
                    onChange={e => setConfig(c => ({ ...c, model: e.target.value }))}
                    placeholder="gpt-4o-mini"
                  />
                </div>
                <Input
                  label="API Key"
                  type="password"
                  value={config.apiKey}
                  onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
                  placeholder="sk-..."
                />
                <div className="flex items-center justify-between flex-wrap gap-sm">
                  <label className="inline-flex items-center gap-sm cursor-pointer">
                    <span className="text-sm font-medium text-ink-2">扫描后自动 AI 解析</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config.enabled}
                      onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                      className={[
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper',
                        config.enabled ? 'bg-accent' : 'bg-paper-3',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'inline-block h-5 w-5 transform rounded-full bg-paper shadow-sm transition-transform',
                          config.enabled ? 'translate-x-5' : 'translate-x-0.5',
                        ].join(' ')}
                      />
                    </button>
                  </label>
                  <Button
                    size="sm"
                    onClick={handleSaveConfig}
                    loading={configSaving}
                    leftIcon={<Save className="w-3.5 h-3.5" />}
                  >
                    保存配置
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
        <div className="bg-paper border border-border rounded-lg p-md">
          <div className="flex items-center gap-sm mb-xs">
            <Clock className="w-4 h-4 text-info" />
            <span className="text-xs text-ink-3">待处理</span>
          </div>
          <span className="text-2xl font-display font-bold text-ink">{stats.pending}</span>
        </div>
        <div className="bg-paper border border-border rounded-lg p-md">
          <div className="flex items-center gap-sm mb-xs">
            <CheckCircle className="w-4 h-4 text-success" />
            <span className="text-xs text-ink-3">已完成</span>
          </div>
          <span className="text-2xl font-display font-bold text-ink">{stats.completed}</span>
        </div>
        <div className="bg-paper border border-border rounded-lg p-md">
          <div className="flex items-center gap-sm mb-xs">
            <XCircle className="w-4 h-4 text-danger" />
            <span className="text-xs text-ink-3">失败</span>
          </div>
          <span className="text-2xl font-display font-bold text-ink">{stats.failed}</span>
        </div>
        <div className="bg-paper border border-border rounded-lg p-md">
          <div className="flex items-center gap-sm mb-xs">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-xs text-ink-3">待审核</span>
          </div>
          <span className="text-2xl font-display font-bold text-ink">{stats.needReview}</span>
        </div>
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

          <div className="flex items-center gap-xs flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBatchParse}
              disabled={selectedCount === 0}
              leftIcon={<Bot className="w-3.5 h-3.5" />}
            >
              批量解析{selectedCount > 0 ? ` (${selectedCount})` : ''}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBatchRetry}
              disabled={selectedCount === 0}
              loading={batchRetrying}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              批量重试
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBatchRollback}
              disabled={selectedCount === 0}
              leftIcon={<Undo2 className="w-3.5 h-3.5" />}
            >
              批量回滚
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleBatchDelete}
              disabled={selectedCount === 0}
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              批量删除
            </Button>
          </div>
        </div>

        {tasksLoading ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <div className="py-xl text-center text-ink-3 text-sm">暂无解析任务</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-ink-3">
                <tr>
                  <th className="text-left font-medium px-md py-sm w-10">
                    <input
                      type="checkbox"
                      aria-label="全选"
                      checked={tasks.length > 0 && selected.size === tasks.length}
                      onChange={toggleSelectAll}
                      className="cursor-pointer accent-[var(--color-accent)]"
                    />
                  </th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">ID</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">歌曲标题</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">歌手</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">状态</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">置信度</th>
                  <th className="text-left font-medium px-md py-sm whitespace-nowrap">创建时间</th>
                  <th className="text-right font-medium px-md py-sm whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => {
                  const song = task.song;
                  const status = task.status in statusLabel ? task.status : 'pending';
                  const isActionLoading = actionLoadingId === task.id;
                  return (
                    <tr
                      key={task.id}
                      className="border-t border-border hover:bg-paper-2 transition-colors"
                    >
                      <td className="px-md py-sm">
                        <input
                          type="checkbox"
                          aria-label={`选择任务 ${task.id}`}
                          checked={selected.has(task.id)}
                          onChange={() => toggleSelect(task.id)}
                          className="cursor-pointer accent-[var(--color-accent)]"
                        />
                      </td>
                      <td className="px-md py-sm font-mono text-ink-3">{task.id}</td>
                      <td className="px-md py-sm text-ink">
                        <span className="font-medium">
                          {song?.title || `歌曲 #${task.songId}`}
                        </span>
                      </td>
                      <td className="px-md py-sm text-ink-2">
                        {song?.artistNames?.length
                          ? song.artistNames.join('、')
                          : song?.artistName || task.originalArtistName || '—'}
                      </td>
                      <td className="px-md py-sm">
                        <Badge variant={statusVariantMap[status] ?? 'neutral'} dot>
                          {statusLabel[status] ?? status}
                        </Badge>
                        {task.needReview === 1 && status === 'completed' && (
                          <Badge variant="warning" size="sm" className="ml-1">
                            待审核
                          </Badge>
                        )}
                      </td>
                      <td className="px-md py-sm">
                        <span className={['font-mono text-sm', confidenceClass(task.confidence)].join(' ')}>
                          {formatConfidence(task.confidence)}
                        </span>
                      </td>
                      <td className="px-md py-sm text-ink-3 whitespace-nowrap">
                        {formatTime(task.createdAt)}
                      </td>
                      <td className="px-md py-sm">
                        <div className="flex items-center justify-end gap-xs flex-wrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Eye className="w-3.5 h-3.5" />}
                            onClick={() => openDetail(task)}
                          >
                            日志
                          </Button>
                          {status === 'completed' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={isActionLoading}
                                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                                onClick={() => handleReparse(task)}
                              >
                                重解析
                              </Button>
                              {task.originalTitle && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  loading={isActionLoading}
                                  leftIcon={<Undo2 className="w-3.5 h-3.5" />}
                                  onClick={() => handleRollback(task)}
                                >
                                  回滚
                                </Button>
                              )}
                              {task.needReview === 1 && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={isActionLoading}
                                  leftIcon={<Check className="w-3.5 h-3.5" />}
                                  onClick={() => handleApprove(task)}
                                >
                                  通过
                                </Button>
                              )}
                            </>
                          )}
                          {(status === 'failed' || status === 'rejected' || status === 'rolled_back') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={isActionLoading}
                              leftIcon={
                                isActionLoading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5" />
                                )
                              }
                              onClick={() => handleReparse(task)}
                            >
                              重新解析
                            </Button>
                          )}
                          {status !== 'pending' && status !== 'processing' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={isActionLoading}
                              leftIcon={<Trash2 className="w-3.5 h-3.5 text-danger" />}
                              onClick={() => handleDelete(task)}
                              className="text-danger hover:text-danger"
                            >
                              删除
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
          <div className="px-md pb-md">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>

      {detailTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'color-mix(in oklch, var(--color-ink) 50%, transparent)' }}
          onClick={() => setDetailTask(null)}
        >
          <div
            className="bg-paper rounded-lg shadow-lg border border-border w-full max-w-4xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
              <h3 className="text-lg font-semibold font-display text-ink">
                识别日志 · 任务 #{detailTask.id}
              </h3>
              <button
                onClick={() => setDetailTask(null)}
                className={[
                  'inline-flex items-center justify-center w-8 h-8 rounded-md',
                  'text-ink-3 hover:text-ink hover:bg-paper-2',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'transition-colors',
                ].join(' ')}
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-md">
              {detailLoading ? (
                <Loading />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-md">
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">任务 ID</span>
                      <span className="text-sm font-mono text-ink">{detailTask.id}</span>
                    </div>
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">歌曲</span>
                      <span className="text-sm text-ink">
                        {detailTask.song?.title || `#${detailTask.songId}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">状态</span>
                      <Badge variant={statusVariantMap[detailTask.status] ?? 'neutral'} dot>
                        {statusLabel[detailTask.status] ?? detailTask.status}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">模型</span>
                      <span className="text-sm font-mono text-ink">{detailTask.model || '—'}</span>
                    </div>
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">置信度</span>
                      <span className={['text-sm font-mono', confidenceClass(detailTask.confidence)].join(' ')}>
                        {formatConfidence(detailTask.confidence)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">创建时间</span>
                      <span className="text-sm text-ink">{formatTime(detailTask.createdAt)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">开始时间</span>
                      <span className="text-sm text-ink">{formatTime(detailTask.startedAt)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-ink-3 block mb-xs">完成时间</span>
                      <span className="text-sm text-ink">{formatTime(detailTask.completedAt)}</span>
                    </div>
                    {detailTask.error && (
                      <div className="sm:col-span-2 lg:col-span-3">
                        <span className="text-xs text-ink-3 block mb-xs">错误信息</span>
                        <span className="text-sm text-danger">{detailTask.error}</span>
                      </div>
                    )}
                  </div>

                  {detailTask.originalTitle && (
                    <div className="bg-paper-2 rounded-md p-md">
                      <h4 className="text-sm font-semibold text-ink mb-sm">原始值 vs AI 结果</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-md text-sm">
                        <div>
                          <span className="text-xs text-ink-3 block mb-xs">原始标题</span>
                          <span className="text-ink-2">{detailTask.originalTitle}</span>
                        </div>
                        <div>
                          <span className="text-xs text-ink-3 block mb-xs">AI 标题</span>
                          <span className="text-accent font-medium">
                            {String(detailParsed?.title ?? '—')}
                          </span>
                        </div>
                        <div>
                          <span className="text-xs text-ink-3 block mb-xs">原始歌手</span>
                          <span className="text-ink-2">{detailTask.originalArtistName || '—'}</span>
                        </div>
                        <div>
                          <span className="text-xs text-ink-3 block mb-xs">AI 歌手</span>
                          <span className="text-accent font-medium">
                            {Array.isArray(detailParsed?.artists)
                              ? detailParsed.artists.join('、')
                              : String(detailParsed?.artist ?? '—')}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {detailMessages && (
                    <CollapsibleSection title="请求消息 (Request Messages)">
                      <pre className="bg-paper-3 rounded-md p-sm text-xs font-mono text-ink-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                        {formatJson(detailMessages)}
                      </pre>
                    </CollapsibleSection>
                  )}

                  {detailTask.responseRaw && (
                    <CollapsibleSection title="AI 原始响应 (Response Raw)">
                      <pre className="bg-paper-3 rounded-md p-sm text-xs font-mono text-ink-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                        {detailTask.responseRaw}
                      </pre>
                    </CollapsibleSection>
                  )}

                  {detailParsed && (
                    <CollapsibleSection
                      title="解析结果 (Parsed Result)"
                      defaultOpen
                    >
                      {draftMode ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
                          <div>
                            <label className="block text-xs text-ink-3 mb-xs">歌手</label>
                            <input
                              type="text"
                              className="w-full rounded-md border border-border bg-paper-2 text-sm text-ink px-3 py-1.5 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              value={Array.isArray(draftResult?.artists)
                                ? draftResult.artists.join('、')
                                : String(draftResult?.artists ?? '')}
                              onChange={(e) =>
                                setDraftResult((d) => ({
                                  ...(d ?? {}),
                                  artists: e.target.value
                                    .split(/[、/,，&]/)
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                }))
                              }
                            />
                          </div>
                          {[
                            ['title', '标题'],
                            ['album', '专辑'],
                            ['genre', '风格'],
                            ['language', '语种'],
                            ['mood', '心情'],
                          ].map(([key, label]) => (
                            <div key={key}>
                              <label className="block text-xs text-ink-3 mb-xs">
                                {label}
                              </label>
                              <input
                                type="text"
                                className="w-full rounded-md border border-border bg-paper-2 text-sm text-ink px-3 py-1.5 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                value={String(draftResult?.[key] ?? '')}
                                onChange={(e) =>
                                  setDraftResult((d) => ({
                                    ...(d ?? {}),
                                    [key]: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          ))}
                          {[
                            ['year', '年份'],
                            ['confidence', '置信度'],
                          ].map(([key, label]) => (
                            <div key={key}>
                              <label className="block text-xs text-ink-3 mb-xs">
                                {label}
                              </label>
                              <input
                                type="number"
                                className="w-full rounded-md border border-border bg-paper-2 text-sm text-ink px-3 py-1.5 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                value={String(draftResult?.[key] ?? '')}
                                onChange={(e) =>
                                  setDraftResult((d) => ({
                                    ...(d ?? {}),
                                    [key]: e.target.value === ''
                                      ? ''
                                      : Number(e.target.value),
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre className="bg-paper-3 rounded-md p-sm text-xs font-mono text-ink-2 overflow-x-auto whitespace-pre-wrap break-all">
                          {formatJson(detailParsed)}
                        </pre>
                      )}
                    </CollapsibleSection>
                  )}

                  {detailTask.promptTemplate && (
                    <CollapsibleSection title="提示词模板 (Prompt Template)">
                      <pre className="bg-paper-3 rounded-md p-sm text-xs font-mono text-ink-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                        {detailTask.promptTemplate}
                      </pre>
                    </CollapsibleSection>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-sm p-4 border-t border-border shrink-0">
              <div className="flex items-center gap-xs">
                {detailTask.needReview === 1 && detailTask.status === 'completed' && (
                  <>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionLoadingId === detailTask.id}
                      leftIcon={<X className="w-3.5 h-3.5" />}
                      onClick={() => handleReject(detailTask)}
                    >
                      拒绝
                    </Button>
                    {!draftMode ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!detailParsed}
                          leftIcon={<Pencil className="w-3.5 h-3.5" />}
                          onClick={() => {
                            setDraftResult({ ...(detailParsed ?? {}) });
                            setDraftMode(true);
                          }}
                        >
                          修改
                        </Button>
                        <Button
                          size="sm"
                          loading={actionLoadingId === detailTask.id}
                          leftIcon={<Check className="w-3.5 h-3.5" />}
                          onClick={() => handleApprove(detailTask)}
                        >
                          通过
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        loading={actionLoadingId === detailTask.id}
                        leftIcon={<Check className="w-3.5 h-3.5" />}
                        onClick={handleApplyModified}
                      >
                        保存修改并应用
                      </Button>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-xs">
                {detailTask.status === 'completed' && detailTask.originalTitle && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoadingId === detailTask.id}
                    leftIcon={<Undo2 className="w-3.5 h-3.5" />}
                    onClick={() => handleRollback(detailTask)}
                  >
                    回滚
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={actionLoadingId === detailTask.id}
                  leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={() => handleReparse(detailTask)}
                >
                  重新解析
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title="提示词配置"
      >
        <div className="space-y-md max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-xs">System Prompt</label>
            <textarea
              value={promptTemplate.systemPrompt}
              onChange={e => setPromptTemplate(p => ({ ...p, systemPrompt: e.target.value }))}
              rows={8}
              className={[
                'w-full rounded-md border border-border bg-paper text-ink text-sm',
                'px-3 py-2 font-mono',
                'placeholder:text-ink-3',
                'transition-colors duration-150 ease-out',
                'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2',
                'focus-visible:ring-accent',
                'resize-y',
              ].join(' ')}
              placeholder="输入系统提示词..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-xs">User Prompt Template</label>
            <textarea
              value={promptTemplate.userPromptTemplate}
              onChange={e => setPromptTemplate(p => ({ ...p, userPromptTemplate: e.target.value }))}
              rows={8}
              className={[
                'w-full rounded-md border border-border bg-paper text-ink text-sm',
                'px-3 py-2 font-mono',
                'placeholder:text-ink-3',
                'transition-colors duration-150 ease-out',
                'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2',
                'focus-visible:ring-accent',
                'resize-y',
              ].join(' ')}
              placeholder="输入用户提示词模板..."
            />
          </div>
          <div className="bg-paper-2 rounded-md p-sm">
            <span className="text-xs font-medium text-ink-2 block mb-xs">可用变量</span>
            <div className="flex flex-wrap gap-xs">
              {PROMPT_VARIABLES.map(v => (
                <span
                  key={v.name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-paper-3 text-xs"
                >
                  <code className="font-mono text-accent">{v.name}</code>
                  <span className="text-ink-3">{v.desc}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-sm pt-sm border-t border-border">
            <Button variant="ghost" size="sm" onClick={handleResetPrompt}>
              恢复默认
            </Button>
            <Button
              size="sm"
              loading={promptSaving}
              onClick={handleSavePrompt}
              leftIcon={<Check className="w-3.5 h-3.5" />}
            >
              保存
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={songPickerOpen}
        onClose={() => setSongPickerOpen(false)}
        title="选择歌曲进行 AI 解析"
      >
        <div className="space-y-md">
          <div className="flex gap-sm">
            <div className="flex-1">
              <Input
                placeholder="搜索歌曲标题..."
                value={songPickerKeyword}
                onChange={e => setSongPickerKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSongPickerSearch()}
              />
            </div>
            <Button
              size="sm"
              onClick={handleSongPickerSearch}
              leftIcon={<Search className="w-3.5 h-3.5" />}
            >
              搜索
            </Button>
          </div>

          {songPickerLoading ? (
            <Loading />
          ) : songPickerSongs.length === 0 ? (
            <div className="py-lg text-center text-ink-3 text-sm">暂无歌曲</div>
          ) : (
            <div className="max-h-80 overflow-y-auto border border-border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-paper-2 text-ink-3 sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-md py-sm w-10">
                      <input
                        type="checkbox"
                        aria-label="全选"
                        checked={songPickerSongs.length > 0 && songPickerSelected.size === songPickerSongs.length}
                        onChange={() => {
                          if (songPickerSelected.size === songPickerSongs.length) {
                            setSongPickerSelected(new Set());
                          } else {
                            setSongPickerSelected(new Set(songPickerSongs.map(s => s.id)));
                          }
                        }}
                        className="cursor-pointer accent-[var(--color-accent)]"
                      />
                    </th>
                    <th className="text-left font-medium px-md py-sm">歌曲标题</th>
                    <th className="text-left font-medium px-md py-sm">歌手</th>
                  </tr>
                </thead>
                <tbody>
                  {songPickerSongs.map(song => (
                    <tr
                      key={song.id}
                      className="border-t border-border hover:bg-paper-2 transition-colors cursor-pointer"
                      onClick={() => {
                        setSongPickerSelected(prev => {
                          const next = new Set(prev);
                          if (next.has(song.id)) next.delete(song.id);
                          else next.add(song.id);
                          return next;
                        });
                      }}
                    >
                      <td className="px-md py-sm">
                        <input
                          type="checkbox"
                          checked={songPickerSelected.has(song.id)}
                          readOnly
                          className="cursor-pointer accent-[var(--color-accent)]"
                        />
                      </td>
                      <td className="px-md py-sm text-ink font-medium">{song.title}</td>
                      <td className="px-md py-sm text-ink-2">
                        {song.artistNames?.length
                          ? song.artistNames.join('、')
                          : song.artistName || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {Math.ceil(songPickerTotal / 20) > 1 && (
            <Pagination
              currentPage={songPickerPage}
              totalPages={Math.ceil(songPickerTotal / 20)}
              onPageChange={p => {
                setSongPickerPage(p);
                loadSongPicker(p, songPickerKeyword);
              }}
            />
          )}

          <div className="flex items-center justify-between pt-sm border-t border-border">
            <span className="text-sm text-ink-3">
              已选 {songPickerSelected.size} 首
            </span>
            <div className="flex gap-sm">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSongPickerOpen(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                loading={songPickerSubmitting}
                disabled={songPickerSelected.size === 0}
                onClick={handleSongPickerSubmit}
                leftIcon={<Bot className="w-3.5 h-3.5" />}
              >
                提交解析 ({songPickerSelected.size})
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
