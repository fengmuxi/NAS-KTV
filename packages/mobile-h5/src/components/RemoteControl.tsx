/* Hallmark · genre: editorial · theme: Garden · RemoteControl — 全局悬浮遥控器
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * designed-as-app
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueueStore } from '../stores/queue';
import { useRoomStore } from '../stores/room';
import { queueApi } from '../api/queue';
import Lyrics from './Lyrics';
import ProgressBar from './ProgressBar';
import { sendPlayerCommand, sendLyricOffset } from '../hooks/usePlayerCommand';
import { wsClient } from '../ws/client';
import { WsMessageType, type LyricOffsetPayload, type PlayerCommandPayload } from '@nasktv/shared';
import client from '../api/client';
import {
  Disc3,
  Music2,
  Waves,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Minus,
  Plus,
  Volume2,
  Timer,
  Undo2,
  X,
} from 'lucide-react';

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsResponse {
  lines: LyricLine[];
  wordTiming?: boolean;
}

type VocalMode = 'original' | 'instrumental' | 'vocal_assist';
type ReverbPreset = 'hall' | 'room' | 'stage' | 'off' | 'custom';

const VOCAL_MODES: { value: VocalMode; label: string }[] = [
  { value: 'original', label: '原唱' },
  { value: 'instrumental', label: '伴奏' },
  { value: 'vocal_assist', label: '伴唱' },
];

const REVERB_PRESETS: { value: ReverbPreset; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'hall', label: '厅堂' },
  { value: 'room', label: '房间' },
  { value: 'stage', label: '舞台' },
  { value: 'custom', label: '自定义' },
];

// 歌词偏移配置（范围 ±10s，步进 0.5s）
const LYRIC_OFFSET_STEP_MS = 500;
const LYRIC_OFFSET_LIMIT_MS = 10000;

// seek 后本地锁定进度条的最长时间（ms），超时无论 TV 是否追上都交还控制权
const SEEK_LOCK_TIMEOUT_MS = 1500;
// TV 广播时间与 seek 目标值的差值在此范围内视为已追上
const SEEK_SETTLE_TOLERANCE_S = 1.2;

const css = `
/* ===== 悬浮按钮 ===== */
.rc-fab {
  position: fixed;
  right: var(--space-lg);
  bottom: calc(88px + env(safe-area-inset-bottom));
  z-index: var(--z-dropdown);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  min-width: 56px;
  min-height: 56px;
  border: none;
  border-radius: var(--radius-full);
  background-color: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  box-shadow: var(--shadow-lg);
  /* 可拖动：禁用触摸滚动/文本选中，避免拖拽时页面跟着滑动 */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transition: background-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out);
}
.rc-fab:hover {
  background-color: var(--color-accent-hover);
  transform: translateY(-2px);
}
.rc-fab:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.rc-fab:active {
  transform: scale(0.94);
}
.rc-fab[data-state="playing"] {
  animation: rc-fab-pulse 2.4s var(--ease-in-out) infinite;
}
@keyframes rc-fab-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-accent) 35%, transparent); }
  50% { box-shadow: 0 0 0 10px transparent; }
}

/* ===== 遮罩 ===== */
.rc-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background-color: color-mix(in oklch, var(--color-ink) 45%, transparent);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-out);
}
.rc-overlay--open {
  opacity: 1;
  pointer-events: auto;
}

/* ===== 底部弹层 ===== */
.rc-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
  height: 92vh;
  max-height: 92vh;
  background-color: var(--color-paper);
  border-top-left-radius: var(--radius-2xl, 24px);
  border-top-right-radius: var(--radius-2xl, 24px);
  box-shadow: var(--shadow-lg);
  transform: translateY(100%);
  visibility: hidden;
  transition: transform var(--dur-base) var(--ease-out),
              visibility 0s var(--dur-base);
}
.rc-sheet--open {
  transform: translateY(0);
  visibility: visible;
  transition: transform var(--dur-base) var(--ease-out);
}

.rc-sheet-handle {
  width: 36px;
  height: 4px;
  margin: var(--space-sm) auto 0;
  border-radius: var(--radius-full);
  background-color: var(--color-border);
  flex-shrink: 0;
}

.rc-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-lg) 0;
  flex-shrink: 0;
}

.rc-sheet-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  color: var(--color-ink);
}

.rc-sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-full);
  background-color: transparent;
  color: var(--color-ink-2);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.rc-sheet-close:hover {
  background-color: var(--color-paper-2);
  color: var(--color-ink);
}
.rc-sheet-close:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.rc-sheet-close:active {
  transform: scale(0.92);
}

.rc-sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: calc(env(safe-area-inset-bottom) + var(--space-xl));
}

/* ===== 歌曲信息（弹层内紧凑版） ===== */
.rc-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
  margin: 0 auto;
  border-radius: var(--radius-lg);
  background-color: var(--color-accent-soft);
  border: 1px solid var(--color-border);
  color: var(--color-accent);
  overflow: hidden;
  flex-shrink: 0;
}

.rc-song-title {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  line-height: 1.3;
  color: var(--color-ink);
  overflow-wrap: anywhere;
  min-width: 0;
  text-align: center;
}

.rc-song-artist {
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--color-ink-2);
  margin-top: var(--space-2xs);
  text-align: center;
}

.rc-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  min-height: 32px;
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  color: var(--color-ink-2);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  border-radius: var(--radius-full);
}

/* ===== 遥控控制区（迁移自原 NowPlaying） ===== */
.np-controls {
  padding: var(--space-lg) var(--space-xl) 0;
}

/* 混响预设横向滚动 chips */
.np-reverb-row {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-lg);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;
}
.np-reverb-row::-webkit-scrollbar {
  display: none;
}

.np-reverb-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background-color: transparent;
  color: var(--color-ink-2);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  cursor: pointer;
  scroll-snap-align: start;
  white-space: nowrap;
  transition: background-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.np-reverb-chip:hover {
  color: var(--color-ink);
  border-color: var(--color-ink-3);
}
.np-reverb-chip:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.np-reverb-chip:active {
  transform: scale(0.96);
}
.np-reverb-chip.is-active {
  background-color: var(--color-paper);
  color: var(--color-accent);
  font-weight: 600;
  border-color: var(--color-accent);
  box-shadow: var(--shadow-sm);
}
.np-reverb-chip:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.np-ctl-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xl);
  margin-top: var(--space-lg);
}

.np-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background-color: transparent;
  color: var(--color-ink-2);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out),
              opacity var(--dur-fast) var(--ease-out);
}
.np-btn:hover {
  background-color: var(--color-paper-2);
  color: var(--color-ink);
}
.np-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.np-btn:active {
  transform: scale(0.92);
}
.np-btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.np-btn--small {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
}

.np-btn--play {
  width: 64px;
  height: 64px;
  min-width: 64px;
  min-height: 64px;
  background-color: var(--color-accent);
  color: var(--color-on-accent);
  box-shadow: var(--shadow-md);
}
.np-btn--play:hover {
  background-color: var(--color-accent-hover);
  color: var(--color-on-accent);
}
.np-btn--play:active {
  transform: scale(0.94);
}

.np-seg {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-lg);
  padding: var(--space-xs);
  background-color: var(--color-paper-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}
.np-seg-btn {
  flex: 1;
  min-height: 40px;
  padding: var(--space-xs) var(--space-md);
  border: none;
  border-radius: var(--radius-full);
  background-color: transparent;
  color: var(--color-ink-2);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              transform var(--dur-micro) var(--ease-out);
}
.np-seg-btn:hover {
  color: var(--color-ink);
}
.np-seg-btn:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.np-seg-btn:active {
  transform: scale(0.96);
}
.np-seg-btn.is-active {
  background-color: var(--color-paper);
  color: var(--color-accent);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.np-tune-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-lg);
}

.np-tune-group {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.np-tune-label {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--color-ink-3);
  margin-right: var(--space-xs);
}

.np-tune-value {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: center;
}

.np-reverb-custom {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-md);
  padding: var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-paper-2);
}

.np-reverb-custom-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.np-reverb-custom-slider {
  flex: 1;
  appearance: none;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--color-border);
  outline: none;
  cursor: pointer;
}
.np-reverb-custom-slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background-color: var(--color-accent);
  border: none;
  cursor: pointer;
}
.np-reverb-custom-slider:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-accent) 30%, transparent);
}

/* ===== 顶部滑动切换（歌词 / 遥控 两屏） ===== */
.np-swiper {
  position: relative;
  margin-top: var(--space-lg);
}

.np-swiper-track {
  display: flex;
  align-items: flex-start;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.np-swiper-track::-webkit-scrollbar {
  display: none;
}

.np-screen {
  flex: 0 0 100%;
  min-width: 100%;
  scroll-snap-align: start;
  padding: 0 var(--space-xl);
}

.np-screen--lyrics {
  height: 300px;
  /* 仅允许纵向滚动（歌词列表）；横向手势交给外层 swiper 切换，
     否则内层歌词滚动容器会抢占左滑导致无法切换到遥控屏 */
  touch-action: pan-y;
}

.np-swiper-dots {
  display: flex;
  justify-content: center;
  gap: var(--space-sm);
  padding-top: var(--space-md);
}

.np-swiper-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background-color: var(--color-border);
  transition: background-color var(--dur-fast) var(--ease-out),
              width var(--dur-fast) var(--ease-out);
}
.np-swiper-dot--active {
  width: 20px;
  background-color: var(--color-accent);
}

/* 导航点击切换：遥控 / 歌词 tab（扁平化：无背景无边框，激活态底部指示条） */
.np-switch-tabs {
  display: flex;
  justify-content: center;
  gap: var(--space-md);
  padding-bottom: var(--space-sm);
}

.np-switch-tab {
  position: relative;
  padding: 8px 4px;
  font-size: 15px;
  font-weight: 500;
  color: var(--color-ink-3);
  background: none;
  border: none;
  transition: color var(--dur-fast) var(--ease-out);
}

.np-switch-tab:hover {
  color: var(--color-ink);
}

.np-switch-tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-accent);
}

.np-switch-tab--active {
  color: var(--color-accent);
  font-weight: 600;
}

.np-switch-tab--active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: 28px;
  height: 3px;
  border-radius: var(--radius-full);
  background-color: var(--color-accent);
}

@media (prefers-reduced-motion: reduce) {
  .rc-fab,
  .rc-overlay,
  .rc-sheet,
  .np-btn,
  .np-seg-btn,
  .np-reverb-chip,
  .np-reverb-custom-slider {
    transition-duration: 0.01ms !important;
  }
}
`;

export default function RemoteControl() {
  const location = useLocation();
  const { joined } = useRoomStore();
  const {
    currentItem,
    playerState,
    currentLyricIndex,
    remoteOpen,
    openRemote,
    closeRemote,
  } = useQueueStore();
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);

  // 悬浮遥控按钮：可拖动。pointer 事件拖动，位移超过阈值视为拖动（不触发点击）
  const fabRef = useRef<HTMLButtonElement>(null);
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    moved: false,
  });

  const handleFabPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const btn = fabRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    btn.setPointerCapture(e.pointerId);
  };

  const handleFabPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return; // 拖动阈值，区分点击
    d.moved = true;
    const w = fabRef.current?.offsetWidth ?? 56;
    const h = fabRef.current?.offsetHeight ?? 56;
    const x = Math.max(0, Math.min(window.innerWidth - w, d.startLeft + dx));
    const y = Math.max(0, Math.min(window.innerHeight - h, d.startTop + dy));
    setFabPos({ x, y });
  };

  const handleFabPointerEnd = () => {
    dragRef.current.dragging = false;
  };

  const handleFabClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (dragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current.moved = false;
      return;
    }
    openRemote();
  };

  // 歌词偏移（ms）：房间级权威值，仅由 TV 端广播驱动，不做本地持久化
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);

  // seek 本地锁定：非 null 时进度条渲染该目标值而非 TV 广播值
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const pendingSeekTimerRef = useRef<number | null>(null);

  // 监听其他 H5 用户或服务端推送的歌词偏移，同步本地状态（避免多手机间设置不同步）
  useEffect(() => {
    const unsub = wsClient.on(WsMessageType.LYRIC_OFFSET, (msg) => {
      const payload = (msg.payload ?? {}) as LyricOffsetPayload;
      const offset = Number(payload.offsetMs);
      if (Number.isFinite(offset)) {
        const clamped = Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, Math.round(offset)));
        setLyricOffsetMs(clamped);
      }
    });
    return unsub;
  }, []);

  // 自定义混响滑块本地值（拖拽即时反馈，TV 广播回来时同步）
  const [customDur, setCustomDur] = useState(2);
  const [customDecay, setCustomDecay] = useState(2);
  useEffect(() => {
    if (playerState?.reverbDuration != null) setCustomDur(playerState.reverbDuration);
    if (playerState?.reverbDecay != null) setCustomDecay(playerState.reverbDecay);
  }, [playerState?.reverbDuration, playerState?.reverbDecay]);

  useEffect(() => {
    if (!currentItem?.songId) {
      setLyrics([]);
      return;
    }
    const controller = new AbortController();
    client
      .get<{ success: boolean; data: LyricsResponse | LyricLine[] }>(
        `/songs/${currentItem.songId}/lyrics`,
        { signal: controller.signal },
      )
      .then(res => {
        if (controller.signal.aborted) return;
        const data = res.data.data;
        // 当前后端返回 { lines, wordTiming }，兼容旧版直接返回数组。
        const nextLyrics = Array.isArray(data) ? data : data?.lines;
        setLyrics(Array.isArray(nextLyrics) ? nextLyrics : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLyrics([]);
      });
    return () => controller.abort();
  }, [currentItem?.songId]);

  const isPlaying = playerState?.status === 'playing';
  const vocalMode = (playerState?.vocalMode ?? 'original') as VocalMode;
  const vocalVolume = playerState?.vocalAssistVolume ?? 0.5;
  const instrumentalVolume = playerState?.instrumentalVolume ?? 1;
  const pitch = playerState?.pitch ?? 0;
  const pitchLabel =
    pitch === 0 ? '原调' : pitch > 0 ? `音调 +${pitch}` : `音调 ${pitch}`;

  const reverbPreset = (playerState?.reverbPreset ?? 'off') as ReverbPreset;
  const reverbLabel =
    reverbPreset === 'off'
      ? '混响 关闭'
      : reverbPreset === 'custom'
        ? '混响 自定义'
        : `混响 ${REVERB_PRESETS.find(p => p.value === reverbPreset)?.label ?? reverbPreset}`;

  // 导航点击切换：遥控 / 歌词 两屏；默认优先显示遥控（控制器）内容
  const [swiperScreen, setSwiperScreen] = useState<'lyrics' | 'remote'>('remote');

  // 弹层打开时锁定页面滚动
  useEffect(() => {
    if (!remoteOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [remoteOpen]);

  // 播放 / 暂停：发送显式命令（多 H5 并发时不会像 toggle 那样互相抵消；
  // 基于 TV 广播的最新状态决策，两个用户看到相同状态时命令同向，TV 端幂等忽略重复）
  const handleTogglePlay = useCallback(() => {
    sendPlayerCommand({ command: isPlaying ? 'pause' : 'play' });
  }, [isPlaying]);

  // 拖拽进度条 seek。
  // TV 每秒广播一次 currentTime，seek 命令往返期间仍有旧时间在途，直接渲染会让进度条回跳。
  // 发出命令后先以目标值渲染（本地锁定），等 TV 状态追上目标或超时再交还控制权。
  const handleSeek = useCallback((time: number) => {
    setPendingSeek(time);
    if (pendingSeekTimerRef.current != null) window.clearTimeout(pendingSeekTimerRef.current);
    pendingSeekTimerRef.current = window.setTimeout(() => {
      pendingSeekTimerRef.current = null;
      setPendingSeek(null);
    }, SEEK_LOCK_TIMEOUT_MS);
    sendPlayerCommand({ command: 'seek', value: time });
  }, []);

  // 回到开头（同样走锁定窗口）
  const handleRestart = useCallback(() => {
    handleSeek(0);
  }, [handleSeek]);

  // TV 广播的时间追上 seek 目标后立即释放锁定，不必等满超时
  useEffect(() => {
    if (pendingSeek == null) return;
    const t = playerState?.currentTime;
    if (t == null) return;
    if (Math.abs(t - pendingSeek) <= SEEK_SETTLE_TOLERANCE_S) {
      if (pendingSeekTimerRef.current != null) {
        window.clearTimeout(pendingSeekTimerRef.current);
        pendingSeekTimerRef.current = null;
      }
      setPendingSeek(null);
    }
  }, [playerState?.currentTime, pendingSeek]);

  // 切歌时丢弃未完成的锁定，避免上一首的目标值污染新歌进度条
  useEffect(() => {
    if (pendingSeekTimerRef.current != null) {
      window.clearTimeout(pendingSeekTimerRef.current);
      pendingSeekTimerRef.current = null;
    }
    setPendingSeek(null);
  }, [currentItem?.id]);

  // 锁定期间用 seek 目标值渲染，其余时间跟随 TV 广播
  const displayTime = pendingSeek ?? playerState?.currentTime ?? 0;

  // 下一首（切歌走 HTTP，与队列页一致）
  const handleSkip = useCallback(async () => {
    const { roomId, sessionToken } = useRoomStore.getState();
    if (!roomId || !sessionToken || !currentItem) return;
    try {
      await queueApi.skip(roomId, {
        queueItemId: currentItem.id,
        sessionToken,
      });
    } catch {
      // 切歌失败静默，等待服务端队列广播校正
    }
  }, [currentItem]);

  // 伴唱模式切换
  const handleVocalMode = useCallback((mode: VocalMode) => {
    sendPlayerCommand({ command: 'set_vocal_mode', value: mode });
  }, []);

  // 调调 ±1
  // 发送增量而非绝对值：绝对值基于上一份 TV 广播计算，两台手机同时点 +1 时
  // 会读到同一个旧值并发出相同的目标值，其中一次点击被吞掉。由 TV 端累加。
  const handlePitch = useCallback((delta: number) => {
    sendPlayerCommand({ command: 'adjust_pitch', value: delta });
  }, []);

  // 混响预设选择（下拉）
  const handleReverbPreset = useCallback((preset: ReverbPreset) => {
    sendPlayerCommand({ command: 'set_reverb_preset', value: preset });
  }, []);

  // 自定义混响参数调节（时长/衰减）
  const handleReverbCustom = useCallback((duration: number, decay: number) => {
    setCustomDur(duration);
    setCustomDecay(decay);
    sendPlayerCommand({ command: 'set_reverb_custom', value: { duration, decay } });
  }, []);

  // 人声辅助音量 ±10%
  const handleVocalVolume = useCallback(
    (delta: number) => {
      sendPlayerCommand({ command: 'adjust_vocal_assist_volume', value: delta });
    },
    [],
  );

  // 伴奏音量 ±10%
  const handleInstrumentalVolume = useCallback(
    (delta: number) => {
      sendPlayerCommand({ command: 'adjust_instrumental_volume', value: delta });
    },
    [],
  );

  // 歌词偏移 ±0.5s：只发增量，由 TV 端基于房间权威值累加后回广播。
  // 本地不再自行累加，避免两台手机同时调节时其中一次点击被覆盖。
  const handleLyricOffset = useCallback((deltaMs: number) => {
    sendPlayerCommand({ command: 'adjust_lyric_offset', value: deltaMs });
  }, []);

  // 重置歌词偏移（绝对值 0，语义明确无需相对命令）
  const handleLyricOffsetReset = useCallback(() => {
    sendLyricOffset(0);
  }, []);

  const lyricOffsetLabel =
    lyricOffsetMs === 0
      ? '同步'
      : `${lyricOffsetMs > 0 ? '+' : ''}${(lyricOffsetMs / 1000).toFixed(1)}s`;

  if (!joined || !currentItem) return null;

  // Home 已有 NowPlayingBar 信息条入口，避免与悬浮按钮重叠
  const showFab = location.pathname !== '/';

  return (
    <>
      <style>{css}</style>

      {showFab && (
        <button
          ref={fabRef}
          onClick={handleFabClick}
          onPointerDown={handleFabPointerDown}
          onPointerMove={handleFabPointerMove}
          onPointerUp={handleFabPointerEnd}
          onPointerCancel={handleFabPointerEnd}
          className="rc-fab"
          style={fabPos ? { left: fabPos.x, top: fabPos.y, right: 'auto' } : undefined}
          data-state={isPlaying ? 'playing' : undefined}
          aria-label="打开遥控器"
          aria-expanded={remoteOpen}
          tabIndex={0}
          role="button"
          type="button"
        >
          <Disc3 size={26} strokeWidth={1.6} />
        </button>
      )}

      <div
        className={`rc-overlay${remoteOpen ? ' rc-overlay--open' : ''}`}
        onClick={closeRemote}
        aria-hidden="true"
      />

      <div
        className={`rc-sheet${remoteOpen ? ' rc-sheet--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="遥控器"
      >
        <div className="rc-sheet-handle" aria-hidden="true" />
        <div className="rc-sheet-header">
          <span className="rc-sheet-title">遥控器</span>
          <button
            onClick={closeRemote}
            className="rc-sheet-close"
            aria-label="关闭遥控器"
            tabIndex={0}
            role="button"
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        <div className="rc-sheet-body">
          {/* 歌曲信息 */}
          <section className="flex flex-col items-center px-xl" style={{ paddingTop: 'var(--space-md)' }}>
            <div className="rc-cover" aria-hidden="true">
              <Disc3 size={32} strokeWidth={1.2} />
            </div>
            <h2 className="rc-song-title" style={{ marginTop: 'var(--space-md)' }}>
              {currentItem.songTitle}
            </h2>
            <p className="rc-song-artist">{currentItem.songArtist}</p>
            <div className="flex items-center gap-sm" style={{ marginTop: 'var(--space-md)' }}>
              <span className="rc-pill">
                <Music2 size={13} strokeWidth={1.8} className="text-ink-3" />
                {pitchLabel}
              </span>
              <span className="rc-pill">
                <Waves size={13} strokeWidth={1.8} className="text-ink-3" />
                {reverbLabel}
              </span>
            </div>
          </section>

          {/* 遥控 / 歌词 导航切换，默认优先显示遥控（控制器）内容 */}
          <div className="np-swiper">
            <div className="np-switch-tabs" role="tablist" aria-label="界面切换">
              <button
                type="button"
                role="tab"
                aria-selected={swiperScreen === 'remote'}
                aria-label="遥控"
                tabIndex={0}
                onClick={() => setSwiperScreen('remote')}
                className={`np-switch-tab${swiperScreen === 'remote' ? ' np-switch-tab--active' : ''}`}
              >
                遥控
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={swiperScreen === 'lyrics'}
                aria-label="歌词"
                tabIndex={0}
                onClick={() => setSwiperScreen('lyrics')}
                className={`np-switch-tab${swiperScreen === 'lyrics' ? ' np-switch-tab--active' : ''}`}
              >
                歌词
              </button>
            </div>

            {swiperScreen === 'lyrics' ? (
              <section className="np-screen np-screen--lyrics" aria-label="歌词">
                <Lyrics
                  lines={lyrics}
                  currentIndex={currentLyricIndex}
                  currentTime={displayTime + lyricOffsetMs / 1000}
                  playing={isPlaying && remoteOpen}
                />
              </section>
            ) : (
              <section className="np-screen" aria-label="遥控">
                <div className="np-controls">
                  <ProgressBar
                    currentTime={displayTime}
                    duration={playerState?.duration ?? 0}
                    onSeek={handleSeek}
                  />

                  <div className="np-ctl-row">
                    <button
                      onClick={handleRestart}
                      className="np-btn np-btn--small"
                      aria-label="回到开头"
                      tabIndex={0}
                      role="button"
                      type="button"
                    >
                      <RotateCcw size={22} strokeWidth={1.8} />
                    </button>
                    <button
                      onClick={handleTogglePlay}
                      className="np-btn np-btn--play"
                      aria-label={isPlaying ? '暂停' : '播放'}
                      aria-pressed={isPlaying}
                      tabIndex={0}
                      role="button"
                      type="button"
                    >
                      {isPlaying ? (
                        <Pause size={28} strokeWidth={1.8} fill="currentColor" />
                      ) : (
                        <Play size={28} strokeWidth={1.8} fill="currentColor" style={{ marginLeft: 3 }} />
                      )}
                    </button>
                    <button
                      onClick={handleSkip}
                      className="np-btn np-btn--small"
                      aria-label="下一首"
                      tabIndex={0}
                      role="button"
                      type="button"
                    >
                      <SkipForward size={22} strokeWidth={1.8} />
                    </button>
                  </div>

                  <div className="np-seg" role="group" aria-label="伴唱模式">
                    {VOCAL_MODES.map(mode => (
                      <button
                        key={mode.value}
                        onClick={() => handleVocalMode(mode.value)}
                        className={`np-seg-btn${vocalMode === mode.value ? ' is-active' : ''}`}
                        aria-pressed={vocalMode === mode.value}
                        tabIndex={0}
                        role="button"
                        type="button"
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  {/* 混响预设（横向滚动 chips，点选） */}
                  <div className="np-reverb-row" role="radiogroup" aria-label="混响预设">
                    {REVERB_PRESETS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => handleReverbPreset(p.value)}
                        className={`np-reverb-chip${reverbPreset === p.value ? ' is-active' : ''}`}
                        aria-pressed={reverbPreset === p.value}
                        role="radio"
                        aria-checked={reverbPreset === p.value}
                        tabIndex={0}
                        type="button"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* 调调（独立行） */}
                  <div className="np-tune-row">
                    <div className="np-tune-group">
                      <span className="np-tune-label">调调</span>
                      <button
                        onClick={() => handlePitch(-1)}
                        className="np-btn np-btn--small"
                        aria-label="降低音调"
                        disabled={pitch <= -12}
                        tabIndex={0}
                        role="button"
                        type="button"
                      >
                        <Minus size={18} strokeWidth={1.8} />
                      </button>
                      <span className="np-tune-value">{pitch > 0 ? `+${pitch}` : pitch}</span>
                      <button
                        onClick={() => handlePitch(1)}
                        className="np-btn np-btn--small"
                        aria-label="升高音调"
                        disabled={pitch >= 12}
                        tabIndex={0}
                        role="button"
                        type="button"
                      >
                        <Plus size={18} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>

                  {/* 歌词偏移：TV 端歌词匹配滞后/提前时 ±0.5s 微调，本地持久化 */}
                  <div className="np-tune-row">
                    <div className="np-tune-group">
                      <Timer size={16} strokeWidth={1.8} className="text-ink-3" />
                      <span className="np-tune-label">歌词</span>
                      <button
                        onClick={() => handleLyricOffset(-LYRIC_OFFSET_STEP_MS)}
                        className="np-btn np-btn--small"
                        aria-label="歌词提前 0.5 秒"
                        disabled={lyricOffsetMs <= -LYRIC_OFFSET_LIMIT_MS}
                        tabIndex={0}
                        role="button"
                        type="button"
                      >
                        <Minus size={18} strokeWidth={1.8} />
                      </button>
                      <span className="np-tune-value">{lyricOffsetLabel}</span>
                      <button
                        onClick={() => handleLyricOffset(LYRIC_OFFSET_STEP_MS)}
                        className="np-btn np-btn--small"
                        aria-label="歌词延后 0.5 秒"
                        disabled={lyricOffsetMs >= LYRIC_OFFSET_LIMIT_MS}
                        tabIndex={0}
                        role="button"
                        type="button"
                      >
                        <Plus size={18} strokeWidth={1.8} />
                      </button>
                    </div>
                    <button
                      onClick={handleLyricOffsetReset}
                      className="np-btn np-btn--small"
                      aria-label="重置歌词偏移"
                      disabled={lyricOffsetMs === 0}
                      tabIndex={0}
                      role="button"
                      type="button"
                    >
                      <Undo2 size={18} strokeWidth={1.8} />
                    </button>
                  </div>

                  {reverbPreset === 'custom' && (
                    <div className="np-reverb-custom">
                      <div className="np-reverb-custom-row">
                        <span className="np-tune-label">时长</span>
                        <input
                          type="range"
                          min={0.5}
                          max={5}
                          step={0.5}
                          value={customDur}
                          onChange={e => handleReverbCustom(Number(e.target.value), customDecay)}
                          className="np-reverb-custom-slider"
                          aria-label="混响时长"
                        />
                        <span className="np-tune-value">{customDur.toFixed(1)}s</span>
                      </div>
                      <div className="np-reverb-custom-row">
                        <span className="np-tune-label">衰减</span>
                        <input
                          type="range"
                          min={1}
                          max={4}
                          step={0.5}
                          value={customDecay}
                          onChange={e => handleReverbCustom(customDur, Number(e.target.value))}
                          className="np-reverb-custom-slider"
                          aria-label="混响衰减"
                        />
                        <span className="np-tune-value">{customDecay.toFixed(1)}</span>
                      </div>
                    </div>
                  )}

                  {vocalMode !== 'original' && (
                    <div className="np-tune-row" style={{ marginTop: 'var(--space-md)' }}>
                      <div className="np-tune-group">
                        <Disc3 size={16} strokeWidth={1.8} className="text-ink-3" />
                        <span className="np-tune-label">伴奏</span>
                        <button
                          onClick={() => handleInstrumentalVolume(-0.1)}
                          className="np-btn np-btn--small"
                          aria-label="降低伴奏音量"
                          disabled={instrumentalVolume <= 0}
                          tabIndex={0}
                          role="button"
                          type="button"
                        >
                          <Minus size={18} strokeWidth={1.8} />
                        </button>
                        <span className="np-tune-value">{Math.round(instrumentalVolume * 100)}%</span>
                        <button
                          onClick={() => handleInstrumentalVolume(0.1)}
                          className="np-btn np-btn--small"
                          aria-label="提高伴奏音量"
                          disabled={instrumentalVolume >= 1}
                          tabIndex={0}
                          role="button"
                          type="button"
                        >
                          <Plus size={18} strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>
                  )}

                  {vocalMode === 'vocal_assist' && (
                    <div className="np-tune-row" style={{ marginTop: 'var(--space-md)' }}>
                      <div className="np-tune-group">
                        <Volume2 size={16} strokeWidth={1.8} className="text-ink-3" />
                        <span className="np-tune-label">人声</span>
                        <button
                          onClick={() => handleVocalVolume(-0.1)}
                          className="np-btn np-btn--small"
                          aria-label="降低人声音量"
                          disabled={vocalVolume <= 0}
                          tabIndex={0}
                          role="button"
                          type="button"
                        >
                          <Minus size={18} strokeWidth={1.8} />
                        </button>
                        <span className="np-tune-value">{Math.round(vocalVolume * 100)}%</span>
                        <button
                          onClick={() => handleVocalVolume(0.1)}
                          className="np-btn np-btn--small"
                          aria-label="提高人声音量"
                          disabled={vocalVolume >= 1}
                          tabIndex={0}
                          role="button"
                          type="button"
                        >
                          <Plus size={18} strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
