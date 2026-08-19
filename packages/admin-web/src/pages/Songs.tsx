/* Hallmark · component: song-list · genre: modern-minimal · theme: Cobalt
 * pattern: category-chip-bar · unified search · hairline table
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Trash2, Bot, Mic, Music, Search, RotateCcw, Headphones, Film, X, FileText, Upload, RefreshCw, ClipboardCheck } from 'lucide-react';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import AudioPreviewModal from '../components/AudioPreviewModal';
import VideoPreviewModal from '../components/VideoPreviewModal';
import Loading from '../components/Loading';
import SearchableSelect from '../components/SearchableSelect';
import { useToast } from '../components/Toast';
import { songsApi } from '../api/songs';
import { aiParseApi } from '../api/ai-parse';
import { separationApi } from '../api/separation';
import { artistsApi } from '../api/artists';
import { categoriesApi } from '../api/categories';
import type { Song, Artist, CategoryGroup } from '../types';

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function safeParseJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function ReviewCompareRow({ label, current, suggested }: { label: string; current: string; suggested: string }) {
  const changed = suggested !== '—' && suggested !== current;
  return (
    <div className="flex items-start justify-between gap-md text-sm">
      <span className="text-ink-3 shrink-0 w-12">{label}</span>
      <div className="flex-1 min-w-0 text-right">
        <span className={changed ? 'text-ink-3 line-through' : 'text-ink'}>{current}</span>
        {changed && <div className="text-accent font-medium break-words">{suggested}</div>}
      </div>
    </div>
  );
}

function aiParseBadge(aiParsed: number, aiNeedReview?: number): {
  variant: 'success' | 'neutral' | 'warning';
  label: string;
} {
  if (aiParsed === 1) return { variant: 'success', label: '已解析' };
  // aiParsed===2：待审核（仍需处理）与已审阅（已被拒绝/保留本地）区分开
  if (aiParsed === 2 && aiNeedReview === 1) return { variant: 'warning', label: '待审核' };
  if (aiParsed === 2) return { variant: 'neutral', label: '已审阅' };
  return { variant: 'neutral', label: '未解析' };
}

function separationBadge(status?: string | null): {
  variant: 'success' | 'warning' | 'neutral' | 'danger';
  label: string;
} {
  switch (status) {
    case 'completed':
      return { variant: 'success', label: '已完成' };
    case 'processing':
      return { variant: 'warning', label: '处理中' };
    case 'failed':
      return { variant: 'danger', label: '失败' };
    default:
      return { variant: 'neutral', label: '未开始' };
  }
}

function fileTypeBadge(ft: string): { variant: 'neutral' | 'info'; label: string } {
  const v = (ft || '').toLowerCase();
  const isVideo =
    v.startsWith('video') ||
    ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v'].includes(v);
  return { variant: isVideo ? 'info' : 'neutral', label: ft || '—' };
}

function isVideoType(ft: string): boolean {
  const v = (ft || '').toLowerCase();
  return (
    v.startsWith('video') ||
    ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v'].includes(v)
  );
}

export default function Songs() {
  const { showToast, ToastContainer } = useToast();
  const [searchParams] = useSearchParams();

  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [selectedCategoryItemIds, setSelectedCategoryItemIds] = useState<Set<number>>(new Set());
  // 歌手筛选（从歌手管理页跳转进入时由 URL 初始化：artistId + artistName）
  const [artistId, setArtistId] = useState<number | null>(null);
  const [artistName, setArtistName] = useState('');

  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editSong, setEditSong] = useState<Song | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    artistIds: [] as string[],
    duration: '',
    filePath: '',
  });
  const [artistsForModal, setArtistsForModal] = useState<Artist[]>([]);
  const [editCategoryGroups, setEditCategoryGroups] = useState<CategoryGroup[]>([]);
  const [editCategoryItemIds, setEditCategoryItemIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [previewSong, setPreviewSong] = useState<Song | null>(null);
  const [videoPreviewSong, setVideoPreviewSong] = useState<Song | null>(null);

  // Lyrics maintenance
  const [lyricsModalOpen, setLyricsModalOpen] = useState(false);
  const [lyricsSong, setLyricsSong] = useState<Song | null>(null);
  const [lyricsContent, setLyricsContent] = useState('');
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsSaving, setLyricsSaving] = useState(false);
  const [lyricsLineCount, setLyricsLineCount] = useState(0);
  const lyricsFileInputRef = useRef<HTMLInputElement | null>(null);

  // AI 解析审核（歌曲管理页直接审核入口）
  const [reviewSong, setReviewSong] = useState<Song | null>(null);
  const [reviewTask, setReviewTask] = useState<import('../api/ai-parse').AiParseTask | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const [pendingDelete, setPendingDeleteState] = useState<{
    songs: Song[];
    count: number;
  } | null>(null);
  const pendingDeleteRef = useRef<{ songs: Song[]; count: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearLyricsConfirmOpen, setClearLyricsConfirmOpen] = useState(false);

  // 单首 AI 解析 / 人声分离二次确认
  const [pendingAiParse, setPendingAiParse] = useState<Song | null>(null);
  const [pendingSeparation, setPendingSeparation] = useState<Song | null>(null);

  const confirmAiParse = () => {
    const s = pendingAiParse;
    setPendingAiParse(null);
    if (s) triggerAiParse(s);
  };

  const confirmSeparation = () => {
    const s = pendingSeparation;
    setPendingSeparation(null);
    if (s) triggerSeparation(s);
  };

  const setPendingDelete = useCallback((v: { songs: Song[]; count: number } | null) => {
    pendingDeleteRef.current = v;
    setPendingDeleteState(v);
  }, []);

  const allCheckboxRef = useRef<HTMLInputElement | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Load category groups
  useEffect(() => {
    categoriesApi.list().then(setCategoryGroups).catch(() => {});
  }, []);

  // URL 参数同步：歌手管理 / 分类管理页跳转进入时初始化筛选
  useEffect(() => {
    const aid = searchParams.get('artistId');
    setArtistId(aid ? (Number(aid) || null) : null);
    setArtistName(searchParams.get('artistName') ?? '');
    setPage(1);
  }, [searchParams]);

  // 分类组加载后应用 URL 中的 categoryId：选中该组全部分类项
  useEffect(() => {
    const cid = Number(searchParams.get('categoryId'));
    if (!cid || !Number.isFinite(cid)) return;
    const group = categoryGroups.find(g => g.id === cid);
    const ids = new Set((group?.items ?? []).map(i => i.id));
    if (ids.size === 0) return;
    setSelectedCategoryItemIds(ids);
    setPage(1);
  }, [categoryGroups, searchParams]);

  // Debounced keyword
  useEffect(() => {
    const t = window.setTimeout(() => {
      setKeyword(keywordInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [keywordInput]);

  // Fetch songs
  const fetchSongs = useCallback(
    async (opts?: { showLoading?: boolean }) => {
      const showLoading = opts?.showLoading !== false;
      if (showLoading) setLoading(true);
      try {
        const data = await songsApi.list({
          page,
          pageSize,
          keyword: keyword.trim() || undefined,
          artistId: artistId ?? undefined,
          categoryItemIds: selectedCategoryItemIds.size > 0 ? Array.from(selectedCategoryItemIds) : undefined,
        });
        setSongs(data.items);
        setTotal(data.total);
      } catch {
        showToast('error', '加载歌曲列表失败');
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [page, keyword, artistId, selectedCategoryItemIds, showToast]
  );

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  // 手动刷新：保留当前表格内容，仅按钮旋转；强制至少展示 400ms 保证可见
  const handleRefresh = () => {
    setRefreshing(true);
    const minDelay = new Promise<void>((resolve) => window.setTimeout(resolve, 400));
    Promise.all([fetchSongs({ showLoading: false }), minDelay])
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  // All checkbox indeterminate
  const allSelected = songs.length > 0 && songs.every((s) => selectedIds.has(s.id));
  const someSelected = songs.some((s) => selectedIds.has(s.id));
  useEffect(() => {
    const el = allCheckboxRef.current;
    if (el) el.indeterminate = !allSelected && someSelected;
  }, [allSelected, someSelected]);

  // Delete（确认弹窗 → 立即删除）
  const commitDelete = useCallback(
    async (toDelete: Song[]) => {
      try {
        await Promise.all(toDelete.map((s) => songsApi.delete(s.id)));
        showToast('success', `已删除 ${toDelete.length} 首歌曲`);
      } catch {
        showToast('error', '部分删除失败，请刷新页面');
      }
      setDeleting(false);
      setPendingDelete(null);
      fetchSongs();
    },
    [fetchSongs, showToast]
  );

  const performDelete = (toDelete: Song[]) => {
    if (toDelete.length === 0) return;
    setPendingDelete({ songs: toDelete, count: toDelete.length });
  };

  const confirmDelete = () => {
    const cur = pendingDeleteRef.current;
    if (!cur) return;
    setDeleting(true);
    commitDelete(cur.songs);
  };

  // Selection
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        songs.forEach((s) => n.delete(s.id));
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        songs.forEach((s) => n.add(s.id));
        return n;
      });
    }
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // Edit
  const openEdit = async (song: Song) => {
    setEditSong(song);
    setEditForm({
      title: song.title,
      artistIds: song.artistId != null ? [String(song.artistId)] : [],
      duration: String(song.duration || 0),
      filePath: song.filePath,
    });
    setEditCategoryItemIds([]);
    setEditModalOpen(true);
    try {
      const [artistRes, catRes, songDetail] = await Promise.all([
        artistsApi.list({ page: 1, pageSize: 9999 }),
        categoriesApi.list(),
        songsApi.get(song.id),
      ]);
      setArtistsForModal(artistRes.items);
      setEditCategoryGroups(catRes);
      const detailArtistIds = songDetail.artistIds;
      if (detailArtistIds && detailArtistIds.length > 0) {
        setEditForm((f) => ({ ...f, artistIds: detailArtistIds.map(String) }));
      }
      if (songDetail.categories && Array.isArray(songDetail.categories)) {
        setEditCategoryItemIds(
          songDetail.categories.map(c => String(c.categoryItemId)),
        );
      }
    } catch {
      setArtistsForModal([]);
      setEditCategoryGroups([]);
    }
  };

  const handleSave = async () => {
    if (!editSong) return;
    setSaving(true);
    try {
      const artistIds = editForm.artistIds.map(Number);
      await songsApi.update(editSong.id, {
        title: editForm.title.trim(),
        artistIds,
        artistId: artistIds[0] ?? null,
        duration: Number(editForm.duration) || 0,
      });
      await songsApi.updateCategories(
        editSong.id,
        editCategoryItemIds.map(Number),
      );
      showToast('success', '歌曲信息已更新');
      setEditModalOpen(false);
      setEditSong(null);
      fetchSongs();
    } catch {
      showToast('error', '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // Single row AI parse / separation
  const patchSong = (id: number, patch: Partial<Song>) => {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  // Lyrics maintenance
  const openLyrics = async (song: Song) => {
    setLyricsSong(song);
    setLyricsContent('');
    setLyricsLineCount(0);
    setLyricsModalOpen(true);
    setLyricsLoading(true);
    try {
      const { content } = await songsApi.getLyricsRaw(song.id);
      setLyricsContent(content);
      setLyricsLineCount(content.trim() ? content.split('\n').length : 0);
    } catch {
      showToast('error', '加载歌词失败');
    } finally {
      setLyricsLoading(false);
    }
  };

  const handleSaveLyrics = async () => {
    if (!lyricsSong) return;
    setLyricsSaving(true);
    try {
      const { lineCount } = await songsApi.saveLyrics(lyricsSong.id, lyricsContent);
      setLyricsLineCount(lineCount);
      patchSong(lyricsSong.id, { lyricsPath: `${lyricsSong.id}.lrc` });
      showToast('success', `歌词已保存（${lineCount} 行）`);
      fetchSongs();
    } catch (e: unknown) {
      const msg = (
        e as { response?: { data?: { error?: string } } }
      ).response?.data?.error;
      showToast('error', msg || '歌词保存失败');
    } finally {
      setLyricsSaving(false);
    }
  };

  const handleClearLyrics = () => {
    setClearLyricsConfirmOpen(true);
  };

  const confirmClearLyrics = async () => {
    if (!lyricsSong) return;
    setClearLyricsConfirmOpen(false);
    setLyricsSaving(true);
    try {
      await songsApi.clearLyrics(lyricsSong.id);
      setLyricsContent('');
      setLyricsLineCount(0);
      patchSong(lyricsSong.id, { lyricsPath: null });
      showToast('success', '歌词已删除');
      fetchSongs();
    } catch {
      showToast('error', '歌词删除失败');
    } finally {
      setLyricsSaving(false);
    }
  };

  const handleUploadLyricsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !lyricsSong) return;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      // 优先 UTF-8，出现替换字符则按 GBK 解码，避免中文歌词乱码
      const utf8 = new TextDecoder('utf-8').decode(buf);
      const content = (utf8.includes('\uFFFD')
        ? new TextDecoder('gbk').decode(buf)
        : utf8
      ).replace(/^\uFEFF/, '');
      if (!/\[\d{1,2}:\d{1,2}/.test(content)) {
        showToast('error', '文件不是有效的 LRC 格式');
        return;
      }
      setLyricsContent(content);
      setLyricsLineCount(content.split('\n').length);
      showToast('success', `已加载 ${file.name}，可编辑后保存`);
    } catch {
      showToast('error', '读取歌词文件失败');
    }
  };

  const triggerAiParse = async (song: Song) => {
    if (busyIds.has(song.id)) return;
    setBusyIds((prev) => new Set(prev).add(song.id));
    const prev = song.aiParsed;
    patchSong(song.id, { aiParsed: 2 });
    try {
      await aiParseApi.trigger(song.id);
    } catch {
      patchSong(song.id, { aiParsed: prev });
      showToast('error', 'AI 解析任务提交失败');
    } finally {
      setBusyIds((prev) => {
        const n = new Set(prev);
        n.delete(song.id);
        return n;
      });
    }
  };

  const triggerSeparation = async (song: Song) => {
    if (busyIds.has(song.id)) return;
    setBusyIds((prev) => new Set(prev).add(song.id));
    const prev = song.separationStatus;
    patchSong(song.id, { separationStatus: 'processing' });
    try {
      await separationApi.trigger({ songId: song.id });
    } catch {
      patchSong(song.id, { separationStatus: prev });
      showToast('error', '人声分离任务提交失败');
    } finally {
      setBusyIds((prev) => {
        const n = new Set(prev);
        n.delete(song.id);
        return n;
      });
    }
  };

  // AI 解析审核：从歌曲管理页直接打开待审核任务
  const openReview = async (song: Song) => {
    setReviewSong(song);
    setReviewTask(null);
    setReviewLoading(true);
    try {
      const task = await aiParseApi.getTaskBySongId(song.id);
      if (task.needReview !== 1) {
        showToast('warning', '该歌曲暂无待审核的 AI 解析结果');
        setReviewSong(null);
        return;
      }
      setReviewTask(task);
    } catch {
      showToast('error', '未找到该歌曲的 AI 解析任务');
      setReviewSong(null);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleReview = async (action: 'approve' | 'reject') => {
    if (!reviewTask) return;
    setReviewSubmitting(true);
    try {
      await aiParseApi.review(reviewTask.id, { action });
      showToast('success', action === 'approve' ? '已通过审核并应用' : '已拒绝该解析结果');
      setReviewSong(null);
      setReviewTask(null);
      await fetchSongs({ showLoading: false });
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '审核操作失败');
    } finally {
      setReviewSubmitting(false);
    }
  };

  // Batch operations
  const selectedSongs = songs.filter((s) => selectedIds.has(s.id));
  const batchCount = selectedIds.size;

  const batchDelete = () => {
    if (selectedSongs.length === 0) return;
    performDelete(selectedSongs);
  };

  const batchAiParse = async () => {
    const targets = selectedSongs;
    if (targets.length === 0) return;
    const ids = targets.map((s) => s.id);
    const snapshots = new Map(targets.map((s) => [s.id, s.aiParsed]));
    ids.forEach((id) => patchSong(id, { aiParsed: 2 }));
    try {
      await aiParseApi.batchParse(ids);
      showToast('success', `已提交 ${ids.length} 首歌曲的 AI 解析`);
    } catch {
      snapshots.forEach((v, id) => patchSong(id, { aiParsed: v }));
      showToast('error', '批量 AI 解析提交失败');
    }
  };

  const batchSeparation = async () => {
    const targets = selectedSongs;
    if (targets.length === 0) return;
    const snapshots = new Map(targets.map((s) => [s.id, s.separationStatus]));
    targets.forEach((s) => patchSong(s.id, { separationStatus: 'processing' }));
    try {
      await Promise.all(targets.map((s) => separationApi.trigger({ songId: s.id })));
      showToast('success', `已提交 ${targets.length} 首歌曲的分离任务`);
    } catch {
      snapshots.forEach((v, id) => patchSong(id, { separationStatus: v }));
      showToast('error', '批量分离提交失败');
    }
  };

  const handleReset = () => {
    setKeywordInput('');
    setKeyword('');
    setArtistId(null);
    setArtistName('');
    setSelectedCategoryItemIds(new Set());
    setPage(1);
  };

  const hasActiveFilter =
    keyword.trim().length > 0 ||
    artistId != null ||
    selectedCategoryItemIds.size > 0;

  return (
    <div className="p-lg space-y-lg">
      {/* Header */}
      <div className="flex items-center justify-between gap-md">
        <h1 className="text-2xl font-display font-bold text-ink">歌曲管理</h1>
        <div className="flex items-center gap-sm">
          <p className="text-sm text-ink-3">共 {total} 首</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            loading={refreshing}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            刷新
          </Button>
        </div>
      </div>

      {/* Unified search */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          placeholder="搜索歌曲名或歌手名..."
          className={[
            'w-full rounded-lg border border-border bg-paper-2 text-ink text-sm',
            'pl-10 pr-10 py-2.5',
            'placeholder:text-ink-3',
            'transition-colors duration-150 ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
            'hover:border-border-strong',
          ].join(' ')}
          aria-label="搜索歌曲"
        />
        {keywordInput && (
          <button
            onClick={() => { setKeywordInput(''); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-ink-3 hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="清除搜索"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Artist filter bar（歌手管理页跳转进入时显示） */}
      {artistId != null && (
        <div className="bg-paper-2 border border-border rounded-lg p-md flex items-center gap-sm">
          <span className="text-xs font-medium text-ink-2 shrink-0">歌手：</span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-accent text-accent-fg shadow-sm">
            {artistName || `#${artistId}`}
            <button
              onClick={() => {
                setArtistId(null);
                setArtistName('');
                setPage(1);
              }}
              className="p-0.5 rounded-full hover:bg-[color-mix(in_oklch,var(--color-ink)_15%,transparent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="清除歌手筛选"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {/* Category filter bar */}
      {categoryGroups.length > 0 && (
        <div className="bg-paper-2 border border-border rounded-lg p-md space-y-sm">
          {categoryGroups.map((group) => {
            const items = group.items ?? [];
            if (items.length === 0) return null;
            const groupItemIds = items.map(i => i.id);
            const hasGroupSelection = groupItemIds.some(id => selectedCategoryItemIds.has(id));
            return (
              <div key={group.id} className="flex items-start gap-sm">
                <span className="text-xs font-medium text-ink-2 pt-1.5 shrink-0 w-12 text-right">
                  {group.name}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => {
                      setSelectedCategoryItemIds(prev => {
                        const next = new Set(prev);
                        groupItemIds.forEach(id => next.delete(id));
                        return next;
                      });
                      setPage(1);
                    }}
                    className={[
                      'px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 ease-out',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper-2',
                      !hasGroupSelection
                        ? 'bg-accent text-accent-fg shadow-sm'
                        : 'bg-paper-3 text-ink-2 hover:bg-paper hover:text-ink',
                    ].join(' ')}
                    aria-pressed={!hasGroupSelection}
                  >
                    全部
                  </button>
                  {items.map((item) => {
                    const isSelected = selectedCategoryItemIds.has(item.id);
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setSelectedCategoryItemIds(prev => {
                            const next = new Set(prev);
                            groupItemIds.forEach(id => next.delete(id));
                            if (!isSelected) next.add(item.id);
                            return next;
                          });
                          setPage(1);
                        }}
                        className={[
                          'px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 ease-out',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper-2',
                          isSelected
                            ? 'bg-accent text-accent-fg shadow-sm'
                            : 'bg-paper-3 text-ink-2 hover:bg-paper hover:text-ink',
                        ].join(' ')}
                        aria-pressed={isSelected}
                      >
                        {item.name}
                        {item.songCount != null && item.songCount > 0 && (
                          <span className="ml-1 opacity-60">{item.songCount}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {hasActiveFilter && (
            <div className="flex items-center pt-xs">
              <button
                onClick={handleReset}
                className="flex items-center gap-1 text-xs text-ink-3 hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm px-1"
                aria-label="重置所有筛选"
              >
                <RotateCcw className="w-3 h-3" />
                重置筛选
              </button>
            </div>
          )}
        </div>
      )}

      {/* Batch operations */}
      {batchCount > 0 && (
        <div className="flex flex-wrap items-center gap-sm bg-accent-soft border border-border rounded-lg p-md">
          <span className="text-sm text-ink-2">已选 {batchCount} 项</span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="danger"
            onClick={batchDelete}
            leftIcon={<Trash2 className="w-4 h-4" />}
          >
            批量删除
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={batchAiParse}
            leftIcon={<Bot className="w-4 h-4" />}
          >
            批量 AI 解析
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={batchSeparation}
            leftIcon={<Mic className="w-4 h-4" />}
          >
            批量分离
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="bg-paper-2 border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="bg-paper-3 border-b border-border">
              <tr>
                <th className="text-left p-md w-10">
                  <input
                    ref={allCheckboxRef}
                    type="checkbox"
                    className="accent-accent w-4 h-4 cursor-pointer"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="全选当前页"
                  />
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  标题
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  歌手
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  时长
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  文件类型
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  AI 解析
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  分离状态
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  分类
                </th>
                <th className="text-left p-md text-sm font-body font-medium text-ink-2">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9}>
                    <Loading />
                  </td>
                </tr>
              ) : songs.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={<Music className="w-8 h-8" />}
                      title={hasActiveFilter ? '没有匹配的歌曲' : '暂无歌曲数据'}
                      description={
                        hasActiveFilter
                          ? '试试调整筛选条件或清空关键词'
                          : '点击右上角「新增歌曲」导入本地音乐'
                      }
                    />
                  </td>
                </tr>
              ) : (
                songs.map((song) => {
                  const ai = aiParseBadge(song.aiParsed, song.aiNeedReview);
                  const sep = separationBadge(song.separationStatus);
                  const ft = fileTypeBadge(song.fileType);
                  const selected = selectedIds.has(song.id);
                  const busy = busyIds.has(song.id);
                  return (
                    <tr
                      key={song.id}
                      className={[
                        'border-b border-border last:border-b-0 border-l-2 border-l-transparent transition-colors',
                        selected
                          ? 'bg-accent-soft border-l-accent'
                          : 'hover:bg-paper-2',
                      ].join(' ')}
                    >
                      <td className="p-md">
                        <input
                          type="checkbox"
                          className="accent-accent w-4 h-4 cursor-pointer"
                          checked={selected}
                          onChange={() => toggleOne(song.id)}
                          aria-label={`选择 ${song.title}`}
                        />
                      </td>
                      <td className="p-md text-sm text-ink font-medium">
                        {song.title || '—'}
                      </td>
                      <td className="p-md text-sm text-ink-2">
                        {song.artistNames?.length
                          ? song.artistNames.join('、')
                          : (song.artistName || '—')}
                      </td>
                      <td className="p-md text-sm text-ink-2 font-mono">
                        {formatDuration(song.duration)}
                      </td>
                      <td className="p-md">
                        <Badge variant={ft.variant}>{ft.label}</Badge>
                      </td>
                      <td className="p-md">
                        <Badge variant={ai.variant} dot>
                          {ai.label}
                        </Badge>
                      </td>
                      <td className="p-md">
                        <Badge variant={sep.variant} dot>
                          {sep.label}
                        </Badge>
                      </td>
                      <td className="p-md">
                        <div className="flex flex-wrap gap-1">
                          {(song.categories ?? []).length === 0 ? (
                            <span className="text-xs text-ink-3">—</span>
                          ) : (
                            (song.categories ?? []).map((c) => (
                              <Badge key={c.categoryItemId} variant="neutral">
                                {c.categoryItemName}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="p-md">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() =>
                              isVideoType(song.fileType)
                                ? setVideoPreviewSong(song)
                                : setPreviewSong(song)
                            }
                            disabled={busy}
                            className="p-1.5 rounded-md text-ink-2 hover:text-accent hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors disabled:opacity-50"
                            aria-label={isVideoType(song.fileType) ? 'MV 预览' : '试听'}
                            title={isVideoType(song.fileType) ? 'MV 预览' : '试听'}
                          >
                            {isVideoType(song.fileType) ? (
                              <Film className="w-4 h-4" />
                            ) : (
                              <Headphones className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => openEdit(song)}
                            disabled={busy}
                            className="p-1.5 rounded-md text-ink-2 hover:text-accent hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors disabled:opacity-50"
                            aria-label="编辑"
                            title="编辑"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openLyrics(song)}
                            disabled={busy}
                            className={`p-1.5 rounded-md hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors disabled:opacity-50 ${
                              song.lyricsPath ? 'text-accent' : 'text-ink-2 hover:text-accent'
                            }`}
                            aria-label="歌词"
                            title={song.lyricsPath ? '维护歌词' : '添加歌词'}
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => performDelete([song])}
                            disabled={busy}
                            className="p-1.5 rounded-md text-ink-2 hover:text-danger hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors disabled:opacity-50"
                            aria-label="删除"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setPendingAiParse(song)}
                            disabled={busy}
                            className="p-1.5 rounded-md text-ink-2 hover:text-accent hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors disabled:opacity-50"
                            aria-label="AI 解析"
                            title="AI 解析"
                          >
                            <Bot className="w-4 h-4" />
                          </button>
                          {song.aiParsed === 2 && song.aiNeedReview === 1 && (
                            <button
                              onClick={() => openReview(song)}
                              disabled={busy || reviewLoading}
                              className="p-1.5 rounded-md text-warning hover:text-warning hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors disabled:opacity-50"
                              aria-label="审核 AI 解析"
                              title="审核 AI 解析"
                            >
                              <ClipboardCheck className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => setPendingSeparation(song)}
                            disabled={busy}
                            className="p-1.5 rounded-md text-ink-2 hover:text-accent hover:bg-paper-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors disabled:opacity-50"
                            aria-label="人声分离"
                            title="人声分离"
                          >
                            <Mic className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-md">
        <p className="text-sm text-ink-3">
          共 {total} 条 · 第 {page}/{totalPages} 页 · 每页 {pageSize} 条
        </p>
        <div className="flex justify-end">
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
      </div>

      {/* Edit modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="编辑歌曲"
      >
        <div className="space-y-md">
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">标题</label>
            <input
              value={editForm.title}
              onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
              className="rounded-md border border-border bg-paper text-ink text-sm px-3 py-2 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper hover:border-border-strong"
            />
          </div>
          <SearchableSelect
            label="歌手（可多选，第一个为主歌手）"
            placeholder="搜索歌手..."
            multiple
            options={artistsForModal.map(a => ({
              value: String(a.id),
              label: a.name,
            }))}
            value={editForm.artistIds}
            onChange={v => setEditForm(f => ({ ...f, artistIds: Array.isArray(v) ? v : [v] }))}
          />
          <SearchableSelect
            label="分类"
            placeholder="搜索分类..."
            multiple
            options={editCategoryGroups.flatMap(g =>
              (g.items ?? []).map(item => ({
                value: String(item.id),
                label: item.name,
                group: g.name,
              })),
            )}
            value={editCategoryItemIds}
            onChange={v => setEditCategoryItemIds(Array.isArray(v) ? v : [v])}
          />
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">时长（秒）</label>
            <input
              type="number"
              value={editForm.duration}
              onChange={(e) => setEditForm((f) => ({ ...f, duration: e.target.value }))}
              className="rounded-md border border-border bg-paper text-ink text-sm px-3 py-2 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper hover:border-border-strong"
            />
          </div>
          <div className="flex flex-col">
            <label className="block text-xs font-medium text-ink-2 mb-xs">文件路径</label>
            <input
              value={editForm.filePath}
              readOnly
              className="rounded-md border border-border bg-paper-3 text-ink-2 text-sm px-3 py-2"
            />
          </div>
          <div className="flex justify-end gap-sm pt-sm">
            <Button variant="ghost" onClick={() => setEditModalOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} loading={saving}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* Lyrics modal */}
      <Modal
        isOpen={lyricsModalOpen}
        onClose={() => setLyricsModalOpen(false)}
        title={lyricsSong ? `歌词维护 · ${lyricsSong.title}` : '歌词维护'}
      >
        <div className="space-y-md">
          <div className="flex items-center justify-between gap-sm">
            <p className="text-xs text-ink-3">
              LRC 格式：每行 [mm:ss.xx]歌词文本，保存后 TV 端实时生效
              {lyricsLineCount > 0 && (
                <span className="text-accent">（当前 {lyricsLineCount} 行）</span>
              )}
            </p>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Upload className="w-3.5 h-3.5" />}
              onClick={() => lyricsFileInputRef.current?.click()}
              disabled={lyricsLoading || lyricsSaving}
            >
              上传 .lrc
            </Button>
            <input
              ref={lyricsFileInputRef}
              type="file"
              accept=".lrc,.txt"
              className="hidden"
              onChange={handleUploadLyricsFile}
            />
          </div>
          {lyricsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loading />
            </div>
          ) : (
            <textarea
              value={lyricsContent}
              onChange={(e) => setLyricsContent(e.target.value)}
              rows={14}
              spellCheck={false}
              placeholder={'[00:00.00] 在这里粘贴 LRC 歌词…'}
              className="w-full rounded-md border border-border bg-paper text-ink text-sm font-mono leading-relaxed px-3 py-2 resize-y transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper hover:border-border-strong"
            />
          )}
          <div className="flex justify-between gap-sm pt-sm">
            <Button
              variant="danger"
              onClick={handleClearLyrics}
              disabled={lyricsLoading || lyricsSaving}
            >
              清空歌词
            </Button>
            <div className="flex gap-sm">
              <Button variant="ghost" onClick={() => setLyricsModalOpen(false)}>
                关闭
              </Button>
              <Button onClick={handleSaveLyrics} loading={lyricsSaving} disabled={lyricsLoading}>
                保存歌词
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={!!pendingDelete}
        title="确认删除歌曲"
        message={
          pendingDelete ? (
            <>
              确定要删除{' '}
              <strong className="text-ink">{pendingDelete.count}</strong> 首歌曲吗？
              {pendingDelete.count === 1 && pendingDelete.songs[0] && (
                <>
                  {' '}
                  （《{pendingDelete.songs[0].title}》
                  {pendingDelete.songs[0].artistNames?.length
                    ? ` - ${pendingDelete.songs[0].artistNames.join('、')}`
                    : ''}）
                </>
              )}
              删除后将无法恢复。
            </>
          ) : null
        }
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* 歌词删除确认弹窗 */}
      <ConfirmModal
        isOpen={clearLyricsConfirmOpen}
        title="确认删除歌词"
        message={
          lyricsSong ? (
            <>
              确定要删除《<strong className="text-ink">{lyricsSong.title}</strong>
              》的歌词吗？删除后无法恢复。
            </>
          ) : null
        }
        loading={lyricsSaving}
        onConfirm={confirmClearLyrics}
        onCancel={() => setClearLyricsConfirmOpen(false)}
      />

      {/* 单首 AI 解析确认弹窗 */}
      <ConfirmModal
        isOpen={!!pendingAiParse}
        title="确认 AI 解析"
        danger={false}
        confirmLabel="开始解析"
        message={
          pendingAiParse ? (
            <>
              确定要对《<strong className="text-ink">{pendingAiParse.title}</strong>
              》进行 AI 解析吗？若已解析过，将覆盖现有解析结果。
            </>
          ) : null
        }
        onConfirm={confirmAiParse}
        onCancel={() => setPendingAiParse(null)}
      />

      {/* 单首人声分离确认弹窗 */}
      <ConfirmModal
        isOpen={!!pendingSeparation}
        title="确认人声分离"
        danger={false}
        confirmLabel="开始分离"
        message={
          pendingSeparation ? (
            <>
              确定要对《<strong className="text-ink">{pendingSeparation.title}</strong>
              》进行人声分离吗？若已分离过，将覆盖现有分离音频。
            </>
          ) : null
        }
        onConfirm={confirmSeparation}
        onCancel={() => setPendingSeparation(null)}
      />

      {previewSong && (
        <AudioPreviewModal
          isOpen={!!previewSong}
          onClose={() => setPreviewSong(null)}
          songId={previewSong.id}
          songTitle={previewSong.title}
          separationStatus={previewSong.separationStatus}
        />
      )}

      {videoPreviewSong && (
        <VideoPreviewModal
          isOpen={!!videoPreviewSong}
          onClose={() => setVideoPreviewSong(null)}
          songId={videoPreviewSong.id}
          songTitle={videoPreviewSong.title}
          separationStatus={videoPreviewSong.separationStatus}
        />
      )}

      {/* AI 解析审核弹窗（歌曲管理页直接审核入口） */}
      <Modal
        isOpen={!!reviewSong}
        onClose={() => { setReviewSong(null); setReviewTask(null); }}
        title="审核 AI 解析结果"
      >
        {reviewLoading ? (
          <Loading />
        ) : reviewTask ? (
          <div className="space-y-md">
            <p className="text-sm text-ink-3">
              对比本地现有信息与 AI 识别建议，选择通过（应用 AI 结果）或拒绝（保留本地信息）。
            </p>
            <ReviewCompareRow
              label="歌曲名"
              current={reviewSong?.title || '—'}
              suggested={String((safeParseJson(reviewTask.result)?.title) ?? '—')}
            />
            <ReviewCompareRow
              label="歌手"
              current={
                reviewSong?.artistNames?.length
                  ? reviewSong.artistNames.join('、')
                  : (reviewSong?.artistName || '—')
              }
              suggested={(() => {
                const p = safeParseJson(reviewTask.result);
                if (!p) return '—';
                const artists = Array.isArray(p.artists) ? p.artists : (p.artist ? [p.artist] : []);
                return artists.length ? artists.join('、') : '—';
              })()}
            />
            <ReviewCompareRow
              label="专辑"
              current="—"
              suggested={String((safeParseJson(reviewTask.result)?.album) ?? '—')}
            />
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-3">置信度</span>
              <span className="font-mono text-ink">
                {reviewTask.confidence != null ? `${Math.round(reviewTask.confidence * 100)}%` : '—'}
              </span>
            </div>
            <div className="flex items-center gap-sm pt-sm">
              <Button
                variant="primary"
                onClick={() => handleReview('approve')}
                loading={reviewSubmitting}
                className="flex-1"
              >
                通过并应用
              </Button>
              <Button
                variant="ghost"
                onClick={() => handleReview('reject')}
                loading={reviewSubmitting}
                className="flex-1"
              >
                拒绝
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ToastContainer />
    </div>
  );
}
