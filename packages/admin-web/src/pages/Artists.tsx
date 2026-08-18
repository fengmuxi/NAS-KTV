import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search, User, Users, ListMusic } from 'lucide-react';
import { artistsApi } from '../api/artists';
import type { Artist } from '../types';
import Button from '../components/Button';
import Input from '../components/Input';
import Badge from '../components/Badge';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../components/Toast';
import Pagination from '../components/Pagination';
import Loading from '../components/Loading';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const sortArtists = (list: Artist[]) =>
  [...list].sort((a, b) => {
    const la = a.firstLetter.toUpperCase();
    const lb = b.firstLetter.toUpperCase();
    if (la !== lb) return la.localeCompare(lb);
    return a.pinyin.localeCompare(b.pinyin);
  });

export default function Artists() {
  const navigate = useNavigate();
  const { showToast, ToastContainer } = useToast();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Artist | null>(null);
  const [formName, setFormName] = useState('');
  const [formBio, setFormBio] = useState('');
  const [formAvatar, setFormAvatar] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSource, setMergeSource] = useState<Artist | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Artist | null>(null);
  const [merging, setMerging] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<Artist | null>(null);
  const [deleting, setDeleting] = useState(false);

  // debounce search
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchArtists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await artistsApi.list({
        page,
        pageSize,
        keyword: search || undefined,
      });
      setArtists(res.items);
      setTotal(res.total);
    } catch {
      setError('加载歌手失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchArtists();
  }, [fetchArtists]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const displayed = selectedLetter
    ? sortArtists(
        artists.filter((a) => a.firstLetter.toUpperCase() === selectedLetter)
      )
    : sortArtists(artists);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormBio('');
    setFormAvatar('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (a: Artist) => {
    setEditing(a);
    setFormName(a.name);
    setFormBio(a.bio || '');
    setFormAvatar(a.avatar || '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('请输入歌手名称');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await artistsApi.update(editing.id, {
          name: formName.trim(),
          bio: formBio.trim() || undefined,
          avatar: formAvatar.trim() || null,
        });
      } else {
        await artistsApi.create({
          name: formName.trim(),
          bio: formBio.trim() || undefined,
          avatar: formAvatar.trim() || null,
        });
      }
      setModalOpen(false);
      fetchArtists();
    } catch {
      setFormError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const commitDelete = useCallback(
    async (a: Artist) => {
      try {
        await artistsApi.delete(a.id);
        showToast('success', `已删除歌手「${a.name}」`);
      } catch {
        showToast('error', '删除失败');
      }
      setDeleting(false);
      setPendingDelete(null);
      fetchArtists();
    },
    [fetchArtists, showToast]
  );

  const handleDelete = (a: Artist) => {
    setPendingDelete(a);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setDeleting(true);
    commitDelete(pendingDelete);
  };

  const startMerge = () => {
    setMergeMode(true);
    setMergeSource(null);
    setMergeTarget(null);
  };

  const cancelMerge = () => {
    setMergeMode(false);
    setMergeSource(null);
    setMergeTarget(null);
  };

  const handleArtistClick = (a: Artist) => {
    if (!mergeMode) {
      openEdit(a);
      return;
    }
    if (!mergeSource) {
      setMergeSource(a);
      return;
    }
    if (mergeSource.id === a.id) {
      setMergeSource(null);
      setMergeTarget(null);
      return;
    }
    setMergeTarget(a);
  };

  const confirmMerge = async () => {
    if (!mergeSource || !mergeTarget) return;
    setMerging(true);
    try {
      await artistsApi.merge(mergeSource.id, mergeTarget.id);
      cancelMerge();
      fetchArtists();
    } catch {
      setError('合并失败，请重试');
    } finally {
      setMerging(false);
    }
  };

  const letterBtnClass = (active: boolean) =>
    [
      'inline-flex items-center justify-center min-w-[2rem] h-8 px-2',
      'text-xs font-medium rounded-md border transition-colors duration-150 ease-out',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
      active
        ? 'border-accent bg-accent text-paper'
        : 'border-border text-ink-2 hover:bg-paper-2 hover:text-ink',
    ].join(' ');

  return (
    <div className="p-lg space-y-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-ink">歌手管理</h1>
        <div className="flex gap-sm">
          {mergeMode ? (
            <>
              <Button variant="ghost" onClick={cancelMerge} disabled={merging}>
                取消
              </Button>
              <Button
                onClick={confirmMerge}
                disabled={!mergeSource || !mergeTarget || merging}
                loading={merging}
              >
                确认合并
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                leftIcon={<Users size={16} />}
                onClick={startMerge}
              >
                合并歌手
              </Button>
              <Button leftIcon={<Plus size={16} />} onClick={openCreate}>
                新增歌手
              </Button>
            </>
          )}
        </div>
      </div>

      <Input
        placeholder="搜索歌手..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        prefix={<Search size={16} />}
      />

      {mergeMode && (
        <div className="bg-accent-soft border border-border rounded-md p-md text-sm text-ink-2">
          {!mergeSource && '请选择要合并的源歌手（将被合并到目标）'}
          {mergeSource && !mergeTarget &&
            `已选源歌手：${mergeSource.name}，请选择目标歌手（保留）`}
          {mergeSource && mergeTarget &&
            `将合并「${mergeSource.name}」到「${mergeTarget.name}」，源歌手将被删除`}
        </div>
      )}

      {error && <div className="text-sm text-danger">{error}</div>}

      <div className="flex gap-xs flex-wrap">
        <button
          className={letterBtnClass(selectedLetter === null)}
          onClick={() => setSelectedLetter(null)}
        >
          全部
        </button>
        {LETTERS.map((L) => {
          const active = selectedLetter === L;
          return (
            <button
              key={L}
              className={letterBtnClass(active)}
              onClick={() => setSelectedLetter(active ? null : L)}
            >
              {L}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Loading />
      ) : displayed.length === 0 ? (
        <div className="text-center py-xl text-ink-3">
          {selectedLetter
            ? `当前页没有以 ${selectedLetter} 开头的歌手`
            : search
            ? '没有匹配的歌手'
            : '暂无歌手，点击右上角新增'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
          {displayed.map((a) => {
            const isSource = mergeSource?.id === a.id;
            const isTarget = mergeTarget?.id === a.id;
            return (
              <div
                key={a.id}
                onClick={() => handleArtistClick(a)}
                className={[
                  'group bg-paper-2 border rounded-lg p-md flex items-center gap-md cursor-pointer transition-colors duration-150 ease-out',
                  isSource
                    ? 'border-accent bg-accent-soft'
                    : isTarget
                    ? 'border-success bg-accent-soft'
                    : 'border-border hover:bg-paper-3',
                ].join(' ')}
              >
                {a.avatar ? (
                  <img
                    src={a.avatar}
                    alt={a.name}
                    className="w-12 h-12 rounded-full object-cover shrink-0 bg-paper-3"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-paper-3 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-ink-3" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ink truncate">{a.name}</div>
                  <div className="text-xs text-ink-3 mt-xs">
                    {a.songCount} 首歌曲
                  </div>
                </div>
                {mergeMode ? (
                  (isSource || isTarget) && (
                    <Badge variant={isSource ? 'info' : 'success'}>
                      {isSource ? '源' : '目标'}
                    </Badge>
                  )
                ) : (
                  <div className="flex items-center gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/songs?artistId=${a.id}&artistName=${encodeURIComponent(a.name)}`);
                      }}
                      className="p-1 rounded text-ink-3 hover:text-accent hover:bg-paper"
                      aria-label={`查看 ${a.name} 的歌曲`}
                      title="查看歌曲"
                    >
                      <ListMusic className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(a);
                      }}
                      className="p-1 rounded text-ink-3 hover:text-ink hover:bg-paper"
                      aria-label="编辑歌手"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(a);
                      }}
                      className="p-1 rounded text-ink-3 hover:text-danger hover:bg-paper"
                      aria-label="删除歌手"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && artists.length > 0 && (
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
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑歌手' : '新增歌手'}
      >
        <div className="space-y-md">
          <Input
            label="名称"
            placeholder="请输入歌手名称"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          />
          <Input
            label="拼音"
            placeholder="自动生成"
            value={editing?.pinyin || ''}
            disabled
            hint="由系统根据名称自动生成"
          />
          <div className="w-full">
            <label className="block text-sm font-medium text-ink-2 mb-xs">
              简介
            </label>
            <textarea
              className={[
                'w-full rounded-md border bg-paper text-ink text-sm',
                'px-3 py-2 min-h-[80px] resize-y',
                'placeholder:text-ink-3',
                'transition-colors duration-150 ease-out focus-visible:outline-none',
                'border-border hover:border-border-strong',
                'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent',
              ].join(' ')}
              placeholder="请输入歌手简介（可选）"
              value={formBio}
              onChange={(e) => setFormBio(e.target.value)}
            />
          </div>
          <Input
            label="头像 URL"
            placeholder="https://example.com/avatar.jpg（可选）"
            value={formAvatar}
            onChange={(e) => setFormAvatar(e.target.value)}
          />
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <div className="flex justify-end gap-sm pt-xs">
            <Button
              variant="ghost"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={handleSave} loading={saving}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* 删除确认弹窗 */}
      <ConfirmModal
        isOpen={!!pendingDelete}
        title="确认删除歌手"
        message={
          pendingDelete ? (
            <>
              确定要删除歌手{' '}
              <strong className="text-ink">「{pendingDelete.name}」</strong> 吗？
              该歌手关联的歌曲将不受影响，删除后无法恢复。
            </>
          ) : null
        }
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ToastContainer />
    </div>
  );
}
