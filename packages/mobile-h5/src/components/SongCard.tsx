/* Hallmark · genre: editorial · theme: Garden · SongCard component
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Song } from '@nasktv/shared';
import { useAddToQueue } from '../hooks/useAddToQueue';
import { useInsertNext } from '../hooks/useInsertNext';
import { useQueueSong } from '../hooks/useQueueSong';
import { useQueueStore } from '../stores/queue';
import { useToastStore } from '../stores/toast';
import { Plus, Check, Loader2, Music, ListStart, ChevronsUp, Play } from 'lucide-react';

interface SongCardProps {
  song: Song;
  onAdd?: () => void;
}

export default function SongCard({ song, onAdd }: SongCardProps) {
  const { addToQueue, addedSongIds, loadingSongIds } = useAddToQueue();
  const { insertNext, insertedSongIds, loadingSongIds: insertLoadingIds } = useInsertNext();
  const { inQueue, isFirstInQueue, topSong } = useQueueSong(song.id);
  const { currentItem } = useQueueStore();
  const showToast = useToastStore((s) => s.show);
  const isPlayingNow = currentItem?.songId === song.id;
  const isLoading = loadingSongIds.has(song.id);
  const isAdded = addedSongIds.has(song.id) || inQueue;
  const isInserting = insertLoadingIds.has(song.id);
  const isInserted = insertedSongIds.has(song.id);
  const disabled = isLoading || isAdded || isInserting || isInserted || isPlayingNow;
  // 顶歌按钮保持可点（仅加载中/播放中禁用），点击时区分反馈：
  // 已在待播最前 → toast 提示；否则置顶成功提示。避免「已在队列却无法置顶」的常灰困惑。
  const [topPending, setTopPending] = useState(false);
  // 顶歌成功后的按钮级反馈：短暂显示绿色 ✓（用户不一定注意到底部 toast）
  const [topDone, setTopDone] = useState(false);
  const topDoneTimer = useRef<number>(0);
  const topLoading = isLoading || isInserting || topPending;
  const topDisabled = topLoading || isPlayingNow || topDone;
  const handleTop = useCallback(async () => {
    if (isFirstInQueue) {
      showToast('已在待播最前，无需置顶', 'info');
      return;
    }
    setTopPending(true);
    try {
      await topSong();
      setTopDone(true);
      showToast('已置顶到待播最前', 'success');
      window.clearTimeout(topDoneTimer.current);
      topDoneTimer.current = window.setTimeout(() => setTopDone(false), 2000);
    } catch {
      showToast('置顶失败，请重试', 'error');
    } finally {
      setTopPending(false);
    }
  }, [isFirstInQueue, topSong, showToast]);

  useEffect(() => () => window.clearTimeout(topDoneTimer.current), []);

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const handleAdd = () => {
    if (onAdd) {
      onAdd();
    } else {
      addToQueue(song);
    }
  };

  return (
    <div
      className="group relative flex flex-col gap-sm p-md bg-paper-2 rounded-lg border border-border transition-all"
      style={{ transitionDuration: 'var(--dur-base)', transitionTimingFunction: 'var(--ease-out)' }}
    >
      {/* 封面占位 */}
      <div className="relative flex items-center justify-center w-full aspect-square max-h-24 bg-paper-3 rounded-md overflow-hidden">
        <Music
          size={32}
          className="text-ink-3 transition-colors group-hover:text-accent"
          strokeWidth={1.5}
        />
        {isPlayingNow && (
          <span
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in oklch, var(--color-accent) 22%, transparent)' }}
          >
            <Play
              size={20}
              fill="var(--color-accent)"
              stroke="none"
            />
          </span>
        )}
      </div>

      {/* 歌曲信息 */}
      <div className="flex-1 min-w-0">
        <p className="text-ink text-base font-medium flex items-center gap-xs">
          <span className="truncate flex-1 min-w-0">{song.title}</span>
          {song.fileType === 'video' && (
            <span
              className="flex-shrink-0 font-display text-xs font-semibold tracking-wider leading-none px-xs py-2xs border rounded-xs"
              style={{
                borderColor: 'var(--color-accent)',
                color: 'var(--color-accent)',
                backgroundColor: 'var(--color-accent-soft)',
              }}
              title="MV 视频"
            >
              MV
            </span>
          )}
          {isPlayingNow && (
            <span
              className="inline-flex items-center gap-2xs flex-shrink-0 text-xs font-medium leading-none px-xs py-2xs rounded-xs"
              style={{
                color: 'var(--color-accent)',
                backgroundColor: 'var(--color-accent-soft)',
              }}
              title="播放中"
            >
              <Play size={11} fill="currentColor" stroke="none" />
              播放中
            </span>
          )}
        </p>
        <p className="text-ink-3 text-sm truncate mt-xs">
          {song.artistNames?.length
            ? song.artistNames.join('、')
            : (song.artist?.name || song.artistName || '未知歌手')}
          {song.duration > 0 && (
            <span className="text-ink-3"> · {formatDuration(song.duration)}</span>
          )}
        </p>
      </div>

      {/* 操作区 */}
      <div className="flex gap-sm">
        <button
          onClick={handleAdd}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-sm py-sm rounded-md font-medium text-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.97] disabled:cursor-not-allowed"
          style={{
            backgroundColor: isAdded
              ? 'var(--color-success)'
              : isLoading
                ? 'var(--color-paper-3)'
                : 'var(--color-accent)',
            color: 'var(--color-on-accent)',
            transitionDuration: 'var(--dur-fast)',
            transitionTimingFunction: 'var(--ease-out)',
            outlineColor: 'var(--color-focus)',
          }}
          aria-label={isAdded ? '已添加' : '点歌'}
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : isAdded ? (
            <Check size={16} />
          ) : (
            <Plus size={16} />
          )}
          <span>{isLoading ? '添加中…' : isPlayingNow ? '播放中' : isAdded ? '已添加' : '点歌'}</span>
        </button>

        {inQueue ? (
          <button
            onClick={handleTop}
            disabled={topDisabled}
            className="flex-shrink-0 flex items-center justify-center gap-sm px-sm py-sm rounded-md border text-sm font-medium transition-all active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              borderColor: topDone ? 'var(--color-success)' : 'var(--color-accent)',
              color: topDone ? 'var(--color-success)' : 'var(--color-accent)',
              backgroundColor: topDone ? 'var(--color-success-soft)' : 'var(--color-accent-soft)',
            }}
            aria-label="顶歌"
            title={isFirstInQueue ? '已在待播最前' : '顶歌'}
          >
            {topLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : topDone ? (
              <Check size={16} className="text-success" />
            ) : (
              <ChevronsUp size={16} />
            )}
          </button>
        ) : (
          <button
            onClick={() => insertNext(song)}
            disabled={disabled}
            className="flex-shrink-0 flex items-center justify-center gap-sm px-sm py-sm rounded-md border border-border text-ink-2 text-sm font-medium transition-all hover:text-accent hover:border-accent active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="插队下一首"
            title="插队下一首"
          >
            {isInserting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isInserted ? (
              <Check size={16} className="text-success" />
            ) : (
              <ListStart size={16} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
