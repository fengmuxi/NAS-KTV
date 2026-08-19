/* Hallmark · genre: editorial · theme: Garden · Stat-Led · Queue page
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * designed-as-app
 */

import { useEffect, useRef, useState } from 'react';
import { useQueueStore } from '../stores/queue';
import { useRoomStore } from '../stores/room';
import { queueApi } from '../api/queue';
import BottomNav from '../components/BottomNav';
import ProgressBar from '../components/ProgressBar';
import EmptyState from '../components/EmptyState';
import {
  Play,
  User,
  Check,
  X,
  ListMusic,
  SkipForward,
  RotateCcw,
  Trash2,
  History,
  ChevronsUp,
  MoreVertical,
  Loader2,
} from 'lucide-react';
import type { QueueListItem } from '@nasktv/shared';

const css = `
/* Hallmark · genre: editorial · theme: Garden · Stat-Led · Queue page */

.q-header {
  padding: calc(env(safe-area-inset-top) + var(--space-2xl)) var(--space-xl) var(--space-xl);
  background-color: var(--color-paper-2);
  border-bottom: 1px solid var(--color-border);
}

.q-title {
  font-family: var(--font-display);
  font-size: var(--text-display);
  line-height: 1.15;
  color: var(--color-ink);
}

.q-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-sm);
}

.q-stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-md) var(--space-sm);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  min-height: 88px;
  transition: background-color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              transform var(--dur-fast) var(--ease-out);
}
.q-stat-card:hover {
  background-color: var(--color-paper-3);
  border-color: var(--color-ink-3);
}
.q-stat-card:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-stat-card:active {
  transform: scale(0.97);
}
.q-stat-card[data-state="loading"] {
  animation: q-pulse 1.5s var(--ease-in-out) infinite;
}
@keyframes q-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.q-stat-card[data-state="error"] {
  border-color: var(--color-danger);
}
.q-stat-card[data-state="success"] {
  border-color: var(--color-success);
}

.q-stat-num {
  font-family: var(--font-mono);
  font-size: var(--text-3xl);
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.q-stat-label {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--color-ink-2);
  margin-top: var(--space-xs);
}

.q-now-playing {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-lg);
  background-color: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg);
  transition: border-color var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out);
}
.q-now-playing:hover {
  border-color: var(--color-accent-hover);
  box-shadow: var(--shadow-sm);
}
.q-now-playing:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-now-playing:active {
  transform: scale(0.995);
}
.q-now-playing[data-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
}
.q-now-playing[data-state="loading"] {
  animation: q-pulse 1.5s var(--ease-in-out) infinite;
}
.q-now-playing[data-state="error"] {
  border-color: var(--color-danger);
}

.q-section-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: var(--space-md);
}

.q-queue-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  min-height: 44px;
  transition: background-color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              transform var(--dur-fast) var(--ease-out);
}
.q-queue-item:hover {
  background-color: var(--color-paper-3);
  border-color: var(--color-ink-3);
}
.q-queue-item:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-queue-item:active {
  transform: scale(0.99);
}
.q-queue-item[data-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
  cursor: not-allowed;
}
.q-queue-item[data-state="loading"] {
  animation: q-pulse 1.5s var(--ease-in-out) infinite;
}
.q-queue-item[data-state="error"] {
  border-color: var(--color-danger);
}

.q-num {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-ink-3);
  min-width: 24px;
  text-align: center;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.q-history-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  min-height: 44px;
  border-bottom: 1px solid var(--color-border);
  opacity: 0.6;
  transition: opacity var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out);
}
.q-history-item:last-child {
  border-bottom: none;
}
.q-history-item:hover {
  opacity: 0.85;
  background-color: var(--color-paper-2);
}
.q-history-item[data-disabled="true"] {
  opacity: 0.3;
  pointer-events: none;
}

.q-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--space-sm) 0;
  background: none;
  border: none;
  min-height: 44px;
  min-width: 44px;
  color: var(--color-ink-2);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out);
}
.q-collapse-btn:hover {
  color: var(--color-ink);
}
.q-collapse-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
.q-collapse-btn:active {
  color: var(--color-accent);
}

.q-collapse-icon {
  transition: transform var(--dur-base) var(--ease-out);
}
.q-collapse-icon--open {
  transform: rotate(180deg);
}

/* 待播 / 已播 标签切换 */
.q-tabs {
  display: flex;
  gap: var(--space-xs);
  padding: var(--space-xs);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.q-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  min-height: 40px;
  border: none;
  border-radius: var(--radius-full);
  background: none;
  color: var(--color-ink-3);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.q-tab:hover {
  color: var(--color-ink);
}
.q-tab:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-tab:active {
  transform: scale(0.97);
}
.q-tab[aria-selected="true"] {
  background-color: var(--color-ink);
  color: var(--color-paper);
}
.q-tab-count {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

/* 已播项操作按钮（重新加入） */
.q-requeue-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-ink-2);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
  flex-shrink: 0;
}
.q-requeue-btn:hover {
  color: var(--color-success);
  background-color: var(--color-success-soft);
}
.q-requeue-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-requeue-btn:active {
  transform: scale(0.9);
}
.q-requeue-btn:disabled,
.q-requeue-btn[data-disabled="true"] {
  opacity: 0.4;
  pointer-events: none;
}
.q-requeue-btn[data-state="loading"] {
  color: var(--color-ink-3);
  animation: q-spin 0.8s linear infinite;
}

/* MV 徽标（待播/正在播放） */
.q-mv-badge {
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

/* 顶歌按钮（与 q-action-btn 同构，hover 用 accent） */
.q-top-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-ink-2);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
  flex-shrink: 0;
}
.q-top-btn:hover {
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
}
.q-top-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-top-btn:active {
  transform: scale(0.9);
  color: var(--color-accent);
}
.q-top-btn:disabled,
.q-top-btn[data-disabled="true"] {
  opacity: 0.4;
  pointer-events: none;
  cursor: not-allowed;
}
.q-top-btn[data-state="loading"] {
  color: var(--color-ink-3);
  animation: q-spin 0.8s linear infinite;
}

/* 更多操作（⋯）按钮 */
.q-more-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-ink-3);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
  flex-shrink: 0;
}
.q-more-btn:hover {
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
}
.q-more-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-more-btn:active {
  transform: scale(0.9);
}
.q-more-btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

/* 更多操作底部弹层 */
.q-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background-color: color-mix(in oklch, var(--color-ink) 45%, transparent);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);
}
.q-sheet-overlay--open {
  opacity: 1;
  pointer-events: auto;
}

.q-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-modal);
  padding: var(--space-sm) var(--space-lg) calc(env(safe-area-inset-bottom) + var(--space-lg));
  background-color: var(--color-paper);
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  transform: translateY(100%);
  visibility: hidden;
  transition: transform var(--dur-base) var(--ease-out),
              visibility 0s var(--dur-base);
}
.q-sheet--open {
  transform: translateY(0);
  visibility: visible;
  transition: transform var(--dur-base) var(--ease-out);
}

.q-sheet-handle {
  width: 36px;
  height: 4px;
  margin: 0 auto var(--space-md);
  border-radius: var(--radius-full);
  background-color: var(--color-border);
}

.q-sheet-info {
  padding: var(--space-xs) var(--space-xs) var(--space-md);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-sm);
}
.q-sheet-title {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.q-sheet-artist {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-ink-3);
  margin-top: var(--space-2xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.q-sheet-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  min-height: 52px;
  padding: var(--space-sm) var(--space-xs);
  background: none;
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: var(--text-base);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.q-sheet-item:hover {
  background-color: var(--color-paper-2);
}
.q-sheet-item:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-sheet-item:active {
  transform: scale(0.985);
}
.q-sheet-item:disabled {
  opacity: 0.4;
  pointer-events: none;
}
.q-sheet-item[data-state="loading"] svg {
  animation: q-spin 0.8s linear infinite;
}
.q-sheet-item--danger {
  color: var(--color-danger);
}
.q-sheet-item--danger:hover {
  background-color: var(--color-danger-soft);
}
.q-sheet-item--danger[data-state="loading"] {
  color: var(--color-danger);
}

.q-sheet-cancel {
  width: 100%;
  min-height: 52px;
  margin-top: var(--space-md);
  padding: var(--space-sm);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-ink-2);
  font-family: var(--font-body);
  font-size: var(--text-base);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.q-sheet-cancel:hover {
  background-color: var(--color-paper-2);
  color: var(--color-ink);
}
.q-sheet-cancel:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-sheet-cancel:active {
  transform: scale(0.985);
}

/* 错误提示条 */
.q-error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background-color: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  color: var(--color-danger);
  font-family: var(--font-body);
  font-size: var(--text-sm);
}
.q-error-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-danger);
  cursor: pointer;
}
.q-error-close:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.q-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-full);
  color: var(--color-ink-2);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
  flex-shrink: 0;
}
.q-action-btn:hover {
  color: var(--color-danger);
  background-color: var(--color-danger-soft);
}
.q-action-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.q-action-btn:active {
  transform: scale(0.9);
  color: var(--color-danger);
}
.q-action-btn:disabled,
.q-action-btn[data-disabled="true"] {
  opacity: 0.4;
  pointer-events: none;
  cursor: not-allowed;
}
.q-action-btn[data-state="loading"] {
  color: var(--color-ink-3);
  animation: q-spin 0.8s linear infinite;
}
@keyframes q-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .q-stat-card, .q-queue-item, .q-history-item, .q-action-btn, .q-collapse-icon,
  .q-more-btn, .q-sheet-overlay, .q-sheet, .q-sheet-item, .q-sheet-cancel {
    transition-duration: 0.01ms !important;
  }
}
`;

function getErrMsg(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } } | null;
  return err?.response?.data?.error || fallback;
}

export default function Queue() {
  const { queue, currentItem, playerState } = useQueueStore();
  const { nickname, roomId, sessionId, sessionToken } = useRoomStore();
  const [activeTab, setActiveTab] = useState<'pending' | 'played'>('pending');
  const [operatingId, setOperatingId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<QueueListItem | null>(null);
  const errorTimer = useRef<number | null>(null);

  const showError = (msg: string) => {
    setErrorMsg(msg);
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setErrorMsg(null), 3000);
  };

  useEffect(() => {
    return () => {
      if (errorTimer.current) window.clearTimeout(errorTimer.current);
    };
  }, []);

  const handleSkip = async (queueItemId: number) => {
    if (!roomId || !sessionId || !sessionToken) return;
    setOperatingId(queueItemId);
    try {
      await queueApi.skip(roomId, { queueItemId, sessionToken });
    } catch (e) {
      showError(getErrMsg(e, '跳过失败'));
    } finally {
      setOperatingId(null);
    }
  };

  const handleRemove = async (queueItemId: number) => {
    if (!roomId || !sessionId || !sessionToken) return;
    setOperatingId(queueItemId);
    try {
      await queueApi.removeQueueItem(roomId, queueItemId, {
        sessionToken,
      });
    } catch (e) {
      showError(getErrMsg(e, '取消点歌失败'));
    } finally {
      setOperatingId(null);
    }
  };

  // 顶歌：把待播项置顶到队列最前（仅自己的歌）
  const handleTop = async (queueItemId: number) => {
    if (!roomId || !sessionId || !sessionToken) return;
    setOperatingId(queueItemId);
    try {
      await queueApi.topQueueItem(roomId, queueItemId, {
        sessionToken,
      });
    } catch (e) {
      showError(getErrMsg(e, '置顶失败'));
    } finally {
      setOperatingId(null);
    }
  };

  // 已播歌曲重新加入播放（后端校验歌曲仍存在）
  const handleRequeue = async (item: QueueListItem) => {
    if (!roomId || !sessionId || !sessionToken || item.songId == null) return;
    setOperatingId(item.id);
    try {
      await queueApi.addToQueue(roomId, {
        songId: item.songId,
        sessionToken,
        nickname,
      });
    } catch (e) {
      showError(getErrMsg(e, '重新加入失败'));
    } finally {
      setOperatingId(null);
    }
  };

  // 一键清除已播记录
  const handleClearPlayed = async () => {
    if (!roomId || !sessionId || !sessionToken) return;
    setClearing(true);
    try {
      await queueApi.clearPlayed(roomId, { sessionToken });
    } catch (e) {
      showError(getErrMsg(e, '清除失败'));
    } finally {
      setClearing(false);
    }
  };

  const pending = queue
    .filter(q => q.status === 'pending')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const played = queue
    .filter(q => q.status === 'played' || q.status === 'skipped')
    .slice(-10)
    .reverse();

  // 底部操作弹层的「顶歌」是否可用（已是最前一首时禁用）
  const isActionItemFirst =
    actionItem != null && pending.length > 0 && actionItem.id === pending[0].id;

  const runAction = async (fn: () => Promise<void>, failMsg: string) => {
    if (!actionItem) return;
    setActionItem(null);
    try {
      await fn();
    } catch (e) {
      showError(getErrMsg(e, failMsg));
    }
  };

  return (
    <>
      <style>{css}</style>
      <div
        className="min-h-screen"
        style={{ backgroundColor: 'var(--color-paper)', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))' }}
      >
        {/* 标题 */}
        <header className="q-header">
          <h1 className="q-title">播放队列</h1>
        </header>

        {/* 统计概览 */}
        <div className="px-xl" style={{ paddingTop: 'var(--space-xl)' }}>
          <div className="q-stats" role="group" aria-label="队列统计">
            <div
              className="q-stat-card"
              role="status"
              aria-label="正在播放"
            >
              <span
                className="q-stat-num"
                style={{ color: currentItem ? 'var(--color-accent)' : 'var(--color-ink-3)' }}
              >
                {currentItem ? '1' : '0'}
              </span>
              <span className="q-stat-label">正在播放</span>
            </div>

            <div className="q-stat-card" role="status" aria-label={`待播 ${pending.length} 首`}>
              <span
                className="q-stat-num"
                style={{ color: pending.length > 0 ? 'var(--color-accent)' : 'var(--color-ink-3)' }}
              >
                {pending.length}
              </span>
              <span className="q-stat-label">待播</span>
            </div>

            <div className="q-stat-card" role="status" aria-label={`已播 ${played.length} 首`}>
              <span
                className="q-stat-num"
                style={{ color: played.length > 0 ? 'var(--color-accent)' : 'var(--color-ink-3)' }}
              >
                {played.length}
              </span>
              <span className="q-stat-label">已播</span>
            </div>
          </div>
        </div>

        {/* 正在播放 */}
        {currentItem && (
          <div className="px-xl" style={{ marginTop: 'var(--space-xl)' }}>
            <div className="q-now-playing">
              <div
                className="flex items-center"
                style={{ gap: 'var(--space-sm)' }}
              >
                <Play
                  size={16}
                  style={{ color: 'var(--color-accent)', flexShrink: 0 }}
                  fill="currentColor"
                />
                <p
                  className="flex-1 min-w-0 truncate"
                  style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 500,
                    color: 'var(--color-ink)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {currentItem.songTitle}
                </p>
                {currentItem.fileType === 'video' && (
                  <span className="q-mv-badge" title="MV 视频">MV</span>
                )}
                <button
                  className="q-action-btn"
                  onClick={() => handleSkip(currentItem.id)}
                  disabled={operatingId === currentItem.id}
                  data-state={operatingId === currentItem.id ? 'loading' : undefined}
                  tabIndex={0}
                  role="button"
                  aria-label="跳过当前歌曲"
                >
                  <SkipForward size={18} />
                </button>
              </div>
              <p
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-ink-2)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {currentItem.songArtist}
              </p>
              {playerState && (
                <div style={{ marginTop: 'var(--space-xs)' }}>
                  <ProgressBar
                    currentTime={playerState.currentTime}
                    duration={playerState.duration}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 待播 / 已播 标签切换 */}
        <div className="px-xl" style={{ marginTop: 'var(--space-xl)' }}>
          <div className="q-tabs" role="tablist" aria-label="队列标签">
            <button
              className="q-tab"
              role="tab"
              aria-selected={activeTab === 'pending'}
              onClick={() => setActiveTab('pending')}
              tabIndex={0}
            >
              <ListMusic size={16} strokeWidth={1.8} />
              待播
              <span className="q-tab-count">{pending.length}</span>
            </button>
            <button
              className="q-tab"
              role="tab"
              aria-selected={activeTab === 'played'}
              onClick={() => setActiveTab('played')}
              tabIndex={0}
            >
              <History size={16} strokeWidth={1.8} />
              已播
              <span className="q-tab-count">{played.length}</span>
            </button>
          </div>

          {errorMsg && (
            <div className="q-error-bar" role="alert">
              <span>{errorMsg}</span>
              <button
                className="q-error-close"
                onClick={() => setErrorMsg(null)}
                aria-label="关闭提示"
                tabIndex={0}
                role="button"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>

        {/* 待播队列 */}
        {activeTab === 'pending' && (
          <div className="px-xl" style={{ marginTop: 'var(--space-2xl)' }}>
            {pending.length === 0 ? (
              <EmptyState
                icon={ListMusic}
                title="队列为空"
                description="去点首歌吧"
              />
            ) : (
              <div
                className="flex flex-col"
                style={{ gap: 'var(--space-sm)' }}
              >
                {pending.map((item, i) => (
                  <div key={item.id} className="q-queue-item" role="listitem">
                    <span className="q-num">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div
                        className="flex items-center"
                        style={{ gap: 'var(--space-sm)' }}
                      >
                        <p
                          className="flex-1 min-w-0 truncate"
                          style={{
                            fontSize: 'var(--text-base)',
                            color: 'var(--color-ink)',
                            fontFamily: 'var(--font-body)',
                          }}
                        >
                          {item.songTitle}
                        </p>
                        {item.fileType === 'video' && (
                          <span className="q-mv-badge" title="MV 视频">MV</span>
                        )}
                      </div>
                      <div
                        className="flex items-center"
                        style={{
                          gap: 'var(--space-sm)',
                          marginTop: 'var(--space-xs)',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-ink-3)',
                            fontFamily: 'var(--font-body)',
                          }}
                        >
                          {item.songArtist}
                        </span>
                        {item.nickname && (
                          <>
                            <span
                              style={{
                                fontSize: 'var(--text-sm)',
                                color: 'var(--color-ink-3)',
                              }}
                            >
                              ·
                            </span>
                            <span
                              className="flex items-center"
                              style={{
                                gap: 'var(--space-2xs)',
                                fontSize: 'var(--text-sm)',
                                color: item.nickname === nickname ? 'var(--color-accent)' : 'var(--color-ink-3)',
                                fontFamily: 'var(--font-body)',
                              }}
                            >
                              <User size={12} />
                              {item.nickname === nickname ? '我' : item.nickname}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      className="q-more-btn"
                      onClick={() => setActionItem(item)}
                      disabled={operatingId === item.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`更多操作 ${item.songTitle}`}
                      aria-expanded={actionItem?.id === item.id}
                    >
                      <MoreVertical size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 已播历史 */}
        {activeTab === 'played' && (
          <div className="px-xl" style={{ marginTop: 'var(--space-2xl)' }}>
            <div
              className="flex items-center justify-between"
              style={{ marginBottom: 'var(--space-md)' }}
            >
              <h2 className="q-section-title" style={{ marginBottom: 0 }}>
                <History size={18} strokeWidth={1.5} style={{ color: 'var(--color-accent)' }} />
                已播历史
              </h2>
              {played.length > 0 && (
                <button
                  className="q-collapse-btn"
                  style={{ width: 'auto', minHeight: 40 }}
                  onClick={handleClearPlayed}
                  disabled={clearing}
                  data-state={clearing ? 'loading' : undefined}
                  tabIndex={0}
                  role="button"
                  aria-label="一键清除已播历史"
                >
                  <span className="flex items-center" style={{ gap: 'var(--space-2xs)' }}>
                    <Trash2 size={14} />
                    一键清除
                  </span>
                </button>
              )}
            </div>

            {played.length === 0 ? (
              <EmptyState
                icon={History}
                title="暂无已播记录"
                description="播放过的歌曲会出现在这里"
              />
            ) : (
              <div className="flex flex-col">
                {played.map(item => (
                  <div key={item.id} className="q-history-item" role="listitem">
                    {item.status === 'played' ? (
                      <Check
                        size={14}
                        style={{ color: 'var(--color-success)', flexShrink: 0 }}
                      />
                    ) : (
                      <X
                        size={14}
                        style={{ color: 'var(--color-ink-3)', flexShrink: 0 }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="truncate"
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: 'var(--color-ink)',
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        {item.songTitle}
                      </p>
                      <p
                        style={{
                          fontSize: 'var(--text-sm)',
                          color: 'var(--color-ink-3)',
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        {item.songArtist}
                      </p>
                    </div>
                    <button
                      className="q-requeue-btn"
                      onClick={() => handleRequeue(item)}
                      disabled={operatingId === item.id}
                      data-state={operatingId === item.id ? 'loading' : undefined}
                      tabIndex={0}
                      role="button"
                      aria-label={`重新加入 ${item.songTitle}`}
                      title="重新加入播放"
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 更多操作底部弹层 */}
        <div
          className={`q-sheet-overlay${actionItem ? ' q-sheet-overlay--open' : ''}`}
          onClick={() => setActionItem(null)}
          aria-hidden="true"
        />
        <div
          className={`q-sheet${actionItem ? ' q-sheet--open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={actionItem ? `${actionItem.songTitle} 操作` : '更多操作'}
        >
          {actionItem && (
            <>
              <div className="q-sheet-handle" aria-hidden="true" />
              <div className="q-sheet-info">
                <p className="q-sheet-title">{actionItem.songTitle}</p>
                <p className="q-sheet-artist">{actionItem.songArtist}</p>
              </div>
              {/* 顶歌不限归属：房间内任意会话都可顶歌 */}
              <button
                className="q-sheet-item"
                onClick={() => {
                  if (isActionItemFirst) {
                    showError('已在待播最前，无需置顶');
                    return;
                  }
                  runAction(() => handleTop(actionItem.id), '置顶失败');
                }}
                tabIndex={0}
                role="button"
                type="button"
              >
                <ChevronsUp size={18} />
                顶歌
                {isActionItemFirst && <span className="ml-auto q-tab-count">已是最前</span>}
              </button>
              <button
                className="q-sheet-item"
                onClick={() => runAction(() => handleSkip(actionItem.id), '跳过失败')}
                tabIndex={0}
                role="button"
                type="button"
              >
                <SkipForward size={18} />
                跳过
              </button>
              {actionItem.userSessionId === String(sessionId) && (
                <button
                  className="q-sheet-item q-sheet-item--danger"
                  onClick={() => runAction(() => handleRemove(actionItem.id), '取消点歌失败')}
                  tabIndex={0}
                  role="button"
                  type="button"
                >
                  <X size={18} />
                  取消点歌
                </button>
              )}
              <button
                className="q-sheet-cancel"
                onClick={() => setActionItem(null)}
                tabIndex={0}
                role="button"
                type="button"
              >
                取消
              </button>
            </>
          )}
        </div>

        <BottomNav />
      </div>
    </>
  );
}
