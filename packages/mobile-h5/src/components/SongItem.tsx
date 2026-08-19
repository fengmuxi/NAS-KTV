/* Hallmark · genre: editorial · component: SongItem · mobile-h5
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Song } from '@nasktv/shared';
import { useAddToQueue } from '../hooks/useAddToQueue';
import { useInsertNext } from '../hooks/useInsertNext';
import { useQueueSong } from '../hooks/useQueueSong';
import { useQueueStore } from '../stores/queue';
import { useToastStore } from '../stores/toast';
import { Plus, Check, Loader2, ListStart, ChevronsUp, Play } from 'lucide-react';

interface SongItemProps {
  song: Song;
}

const css = `
.si-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) 0;
  min-height: 44px;
  border-bottom: 1px solid var(--color-border);
  transition: background-color var(--dur-fast) var(--ease-out);
}
.si-row:last-child {
  border-bottom: none;
}
.si-row:hover {
  background-color: var(--color-paper-2);
}
.si-row:focus-within {
  background-color: var(--color-paper-2);
}
.si-row:active {
  background-color: var(--color-paper-3);
}
.si-row[data-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
}
.si-row[data-state="loading"] {
  opacity: 0.7;
}

.si-title {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--color-ink);
  line-height: 1.4;
}

.si-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.si-mv-badge {
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 1;
  padding: 2px 4px;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-xs);
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
}

/* 正在播放中徽标 */
.si-playing-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
}

.si-meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-2xs);
  font-size: var(--text-sm);
  color: var(--color-ink-3);
  font-family: var(--font-body);
}

.si-duration {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-ink-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.si-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background-color: transparent;
  color: var(--color-ink-2);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.si-icon-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
}
.si-icon-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.si-icon-btn:active {
  transform: scale(0.92);
}
.si-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
/* 顶歌按钮：accent 醒目样式，与"灰色=禁用"的视觉彻底区分 */
.si-icon-btn--top {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
}
.si-icon-btn--top:hover {
  border-color: var(--color-accent-hover);
  color: var(--color-accent-hover);
  background-color: var(--color-accent-soft);
}
/* 顶歌成功反馈：绿色 ✓（覆盖通用 --top accent 态） */
.si-icon-btn--top[data-state="success"] {
  border-color: var(--color-success);
  color: var(--color-success);
  background-color: var(--color-success-soft);
}
.si-icon-btn[data-state="loading"] svg {
  animation: si-spin 0.8s linear infinite;
}
.si-icon-btn[data-state="success"] {
  border-color: var(--color-success);
  color: var(--color-success);
  background-color: var(--color-success-soft);
}
@keyframes si-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.si-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border-radius: var(--radius-full);
  border: none;
  background-color: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.si-add-btn:hover {
  background-color: var(--color-accent-hover);
}
.si-add-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.si-add-btn:active {
  transform: scale(0.92);
}
.si-add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
.si-add-btn[data-state="loading"] svg {
  animation: si-spin 0.8s linear infinite;
}
.si-add-btn[data-state="success"] {
  background-color: var(--color-success);
}

@media (prefers-reduced-motion: reduce) {
  .si-icon-btn, .si-add-btn, .si-row {
    transition-duration: 0.01ms !important;
  }
}
`;

export default function SongItem({ song }: SongItemProps) {
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
  // 行级禁用只限「加载中/插队中/播放中」；「已在待播队列」只是点歌按钮的禁用态，
  // 不能连累整行 —— 否则 data-disabled 的 pointer-events:none 会屏蔽顶歌按钮的点击
  const rowDisabled = isLoading || isInserting || isPlayingNow;
  const disabled = rowDisabled || isAdded || isInserted;
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

  const durationText =
    song.duration > 0
      ? `${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}`
      : '';

  return (
    <>
      <style>{css}</style>
      <div
        className="si-row"
        data-disabled={rowDisabled ? 'true' : undefined}
        data-state={isLoading ? 'loading' : undefined}
      >
        <div className="flex-1 min-w-0">
          <div className="si-title-row">
            <p className="si-title truncate">{song.title}</p>
            {song.fileType === 'video' && (
              <span className="si-mv-badge" title="MV 视频">MV</span>
            )}
            {isPlayingNow && (
              <span className="si-playing-badge" title="播放中">
                <Play size={11} fill="currentColor" strokeWidth={0} />
                播放中
              </span>
            )}
          </div>
          <div className="si-meta">
            <span className="truncate">
              {song.artistNames?.length
                ? song.artistNames.join('、')
                : (song.artist?.name || song.artistName || '未知歌手')}
            </span>
            {durationText && <span className="si-duration">{durationText}</span>}
          </div>
        </div>

        {inQueue ? (
          <button
            onClick={handleTop}
            disabled={topDisabled}
            className="si-icon-btn si-icon-btn--top"
            data-state={topLoading ? 'loading' : topDone ? 'success' : undefined}
            aria-label="顶歌"
            title={isFirstInQueue ? '已在待播最前' : '顶歌'}
            type="button"
          >
            {topLoading ? (
              <Loader2 size={18} strokeWidth={2} />
            ) : topDone ? (
              <Check size={18} strokeWidth={2.2} />
            ) : (
              <ChevronsUp size={18} strokeWidth={2} />
            )}
          </button>
        ) : (
          <button
            onClick={() => insertNext(song)}
            disabled={disabled}
            className="si-icon-btn"
            data-state={isInserting ? 'loading' : isInserted ? 'success' : undefined}
            aria-label="插队下一首"
            title="插队下一首"
            type="button"
          >
            {isInserting ? (
              <Loader2 size={18} strokeWidth={2} />
            ) : isInserted ? (
              <Check size={18} strokeWidth={2.2} />
            ) : (
              <ListStart size={18} strokeWidth={1.8} />
            )}
          </button>
        )}

        <button
          onClick={() => addToQueue(song)}
          disabled={disabled}
          className="si-add-btn"
          data-state={isLoading ? 'loading' : isAdded ? 'success' : undefined}
          aria-label={isAdded ? '已添加' : '点歌'}
          type="button"
        >
          {isLoading ? (
            <Loader2 size={18} strokeWidth={2} />
          ) : isAdded ? (
            <Check size={18} strokeWidth={2.2} />
          ) : (
            <Plus size={18} strokeWidth={2} />
          )}
        </button>
      </div>
    </>
  );
}
