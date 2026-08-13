/* Hallmark • genre: atmospheric • macrostructure: video-stage overlay • design-system: design.md • designed-as-app
 * tone: immersive • anchor hue: cool 220° • visualizer-stage • dual-mode render
 * MV songs → fullscreen video + overlay info; audio songs → lyric-focused stage with visualizer
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomStore } from '../stores/room';
import { usePlayer, type VocalMode } from '../hooks/usePlayer';
import { useLyrics } from '../hooks/useLyrics';
import { useDpadNavigation } from '../hooks/useDpadNavigation';
import { useJoinTicket } from '../hooks/useJoinTicket';
import Visualizer from '../components/Visualizer';
import LyricsDisplay from '../components/LyricsDisplay';
import RemoteFeedback from '../components/RemoteFeedback';
import ProgressBar from '../components/ProgressBar';
import { ListMusic, Pause, UserRound, Loader2, type LucideIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import QRCodeLib from 'qrcode';
import client from '../api/client';

const css = `
/* 全屏基础 */
.np-root {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: linear-gradient(180deg,
    rgb(0,2,5) 0%,
    rgb(2,5,17) 50%,
    rgb(0,1,2) 100%
  );
}

/* MV 视频层 */
.np-video-full {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background-color: var(--color-black);
  z-index: 0;
}

/* 左上角信息列：歌曲信息卡片 + 待播列表（MV/音频通用） */
.np-side-info {
  position: absolute;
  top: var(--space-3xl);
  left: var(--space-3xl);
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-lg);
  max-width: 520px;
  pointer-events: none;
}

/* 歌曲信息 - 左上角紧凑卡片（透明底，仅保留文字投影） */
.np-song-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-lg) var(--space-xl);
  background: transparent;
  text-align: left;
}

.np-song-title {
  font-family: var(--font-display);
  font-size: clamp(40px, 2.5vw, 48px);
  font-weight: 700;
  line-height: 1.15;
  color: var(--color-ink);
  text-shadow: var(--shadow-lyrics);
  overflow-wrap: anywhere;
  min-width: 0;
}

.np-song-artist {
  font-family: var(--font-body);
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--color-accent);
  text-shadow: var(--shadow-lyrics);
}

/* 左上角待播列表 */
.np-queue-panel {
  max-width: 320px;
  pointer-events: none;
}

.np-queue-title {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  letter-spacing: var(--tracking-widest);
  text-transform: uppercase;
  color: rgb(91,132,174);
  margin-bottom: var(--space-md);
}

.np-queue-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.np-queue-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
  color: rgb(81,119,145);
  font-size: var(--text-base);
}

.np-queue-item-num {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: rgb(69,105,122);
  min-width: 2ch;
}

.np-queue-item-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-queue-item-user {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: rgb(63,99,117);
}

.np-queue-empty {
  color: rgb(62,90,103);
  font-size: var(--text-sm);
}

/* 当前播放歌曲的点歌人 */
.np-song-requester {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: 500;
  color: rgb(56,157,185);
  text-shadow: var(--shadow-lyrics);
  margin-top: var(--space-sm);
}

.np-song-requester-icon {
  width: 14px;
  height: 14px;
  color: rgb(35,142,169);
}

/* 中间视觉化区域 */
.np-visualizer {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 160px;
}

/* 暂停状态 */
.np-pause-standby {
  position: fixed;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%);
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  width: 200px;
  height: 200px;
  border-radius: var(--radius-full);
  background-color: rgba(15,23,31,0.7);
  backdrop-filter: blur(20px) saturate(150%);
  box-shadow:
    0 0 40px rgba(18,74,123,0.3),
    inset 0 0 20px rgba(0,49,81,0.2);
  color: rgb(0,185,195);
  pointer-events: none;
  animation: np-pause-in var(--dur-base) var(--ease-out) both;
}

.np-pause-text {
  max-width: 140px;
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.4;
  color: rgb(56,157,185);
  text-align: center;
  overflow-wrap: anywhere;
}

@keyframes np-pause-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

/* 歌词样式覆盖 - 霓虹风格 */
.np-lyrics-area .lyric-line {
  font-size: clamp(28px, 3vw, 44px);
  line-height: 1.4;
  text-align: center;
}

.np-lyrics-area .lyric-line.current {
  color: rgb(108,246,253);
  text-shadow:
    0 0 15px rgb(0,205,218),
    0 0 30px rgb(0,159,193);
}

.np-lyrics-area .lyric-line:not(.current) {
  color: rgb(66,104,130);
}

/* 底部播放进度条（仅音频模式） */
.np-progress {
  position: absolute;
  left: var(--space-3xl);
  right: var(--space-3xl);
  bottom: var(--space-3xl);
  z-index: 30;
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--radius-lg);
  background: linear-gradient(
    180deg,
    rgba(2,6,13,0.5) 0%,
    rgba(0,2,4,0.72) 100%
  );
  backdrop-filter: blur(14px) saturate(120%);
  border: 1px solid rgba(91,132,174,0.16);
  box-shadow: 0 8px 32px rgba(0,0,0,0.35);
}

/* 大号时间显示：当前播放时间（主）+ 总时长（辅） */
.np-progress-time {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-sm);
}

.np-progress-time-current {
  font-family: var(--font-mono);
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  color: rgb(135,242,248);
  text-shadow: 0 0 14px rgba(0,189,202,0.55);
}

.np-progress-time-total {
  font-family: var(--font-mono);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: rgb(95,133,161);
}
`;

function formatPlayerTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function NowPlaying() {
  const { queue, currentItem, room, authorized } = useRoomStore();
  const [h5BaseUrl, setH5BaseUrl] = useState('');
  const [configQrUrl, setConfigQrUrl] = useState('');
  const [configQrError, setConfigQrError] = useState('');
  // 二维码本地生成（data URL），避免跨域图片被 CORP 拦截（ERR_BLOCKED_BY_RESPONSE.NotSameOrigin）
  const [songQrSrc, setSongQrSrc] = useState('');
  const [configQrSrc, setConfigQrSrc] = useState('');
  const [feedback, setFeedback] = useState<{ icon?: LucideIcon; text?: string; progress?: number; tick: number } | null>(null);
  const navigate = useNavigate();
  const joinTicket = useJoinTicket(room, authorized);

  const showFeedback = useCallback((icon?: LucideIcon, text?: string, progress?: number) => {
    setFeedback({ icon, text, progress, tick: Date.now() });
  }, []);

  useDpadNavigation();

  useEffect(() => {
    client
      .get<{ data: { h5BaseUrl: string } }>('/rooms/h5-url')
      .then((res) => setH5BaseUrl(res.data?.data?.h5BaseUrl || ''))
      .catch(() => {});
  }, []);

  // 生成 TV 配置二维码（手机扫码配置后端地址）
  useEffect(() => {
    const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!IS_TAURI) {
      setConfigQrError('浏览器环境不支持');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await invoke('start_config_server');
        const ips = (await invoke('get_local_ips')) as unknown;
        if (!Array.isArray(ips) || ips.length === 0) {
          if (!cancelled) setConfigQrError('无法获取本机 IP');
          return;
        }
        if (!cancelled) setConfigQrUrl(`http://${ips[0]}:45678/p`);
      } catch (e) {
        console.error('config qr init failed:', e);
        if (!cancelled) setConfigQrError('配置服务未启动');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 运行时后端地址（setApiBaseUrl 已把 /api 后缀并入 baseURL），
  // 打包版 WebView 中相对路径会指向 tauri://localhost 导致 404，必须用绝对地址
  const apiBase = (client.defaults.baseURL || '/api').replace(/\/+$/, '');

  // 兜底：未配置 h5_base_url 时，从后端地址推断 H5 基址
  // （后端反代通常把 H5 挂在 /h5，如 http://nas:8080/api -> http://nas:8080/h5）
  const derivedH5Base = `${apiBase.replace(/\/api\/?$/, '')}/h5`;
  const h5Base = h5BaseUrl || derivedH5Base;

  const qrText =
    h5Base && joinTicket
      ? `${h5Base.replace(/\/+$/, '')}/join?authorizationCode=${joinTicket.authorizationCode}`
      : '';

  // 本地生成「点歌二维码」图片（data URL），规避后端跨域图片被 CORP 拦截（ERR_BLOCKED_BY_RESPONSE.NotSameOrigin）
  useEffect(() => {
    let cancelled = false;
    if (!qrText) {
      setSongQrSrc('');
      return;
    }
    QRCodeLib.toDataURL(qrText, { width: 240, margin: 1 })
      .then((url) => {
        if (!cancelled) setSongQrSrc(url);
      })
      .catch((e) => {
        console.error('song qr gen failed:', e);
        if (!cancelled) setSongQrSrc('');
      });
    return () => {
      cancelled = true;
    };
  }, [qrText]);

  // 本地生成「配置 TV 二维码」图片（data URL）
  useEffect(() => {
    let cancelled = false;
    if (!configQrUrl) {
      setConfigQrSrc('');
      return;
    }
    QRCodeLib.toDataURL(configQrUrl, { width: 240, margin: 1 })
      .then((url) => {
        if (!cancelled) setConfigQrSrc(url);
      })
      .catch((e) => {
        console.error('config qr gen failed:', e);
        if (!cancelled) setConfigQrSrc('');
      });
    return () => {
      cancelled = true;
    };
  }, [configQrUrl]);

  const qrBadge = qrText ? (
    <div className="qr-badge fixed top-2xl right-2xl z-40 flex flex-row items-center gap-lg rounded-xl p-md shadow-lg"
      style={{
        background: 'linear-gradient(135deg, rgba(5,12,19,0.85) 0%, rgba(2,4,5,0.65) 100%)',
        border: '2px solid rgba(0,178,222,0.55)',
        boxShadow: '0 0 30px rgba(0,178,222,0.35), inset 0 0 12px rgba(0,178,222,0.12)'
      }}>
      {/* 点歌二维码 */}
      <div className="flex flex-col items-center gap-sm">
        <p className="text-sm font-medium text-accent">手机扫码点歌</p>
        {songQrSrc ? (
          <img
            src={songQrSrc}
            alt="手机扫码点歌"
            width={112}
            height={112}
            className="rounded-sm bg-paper p-xs"
          />
        ) : (
          <div
            className="flex items-center justify-center bg-paper rounded-sm p-xs"
            style={{ width: 112, height: 112 }}
          >
            <Loader2 className="w-6 h-6 text-ink-2 animate-spin" />
          </div>
        )}
        <p className="text-xs font-mono tracking-widest text-ink-3">
          授权码: {joinTicket?.authorizationCode ?? '更新中'}
        </p>
      </div>

      {/* 垂直分隔线 */}
      <div className="self-stretch w-px min-h-[88px]" style={{ background: 'rgba(0,178,222,0.25)' }} />

      {/* 配置二维码 */}
      <div className="flex flex-col items-center gap-sm">
        <p className="text-sm font-medium text-accent">扫码配置 TV</p>
        {configQrSrc ? (
          <img
            src={configQrSrc}
            alt="扫码配置 TV"
            width={96}
            height={96}
            className="rounded-sm bg-paper p-xs"
          />
        ) : configQrError ? (
          <div
            className="flex items-center justify-center bg-paper rounded-sm p-xs text-center"
            style={{ width: 96, height: 96 }}
          >
            <span className="text-ink-3 text-xs">{configQrError}</span>
          </div>
        ) : (
          <div
            className="flex items-center justify-center bg-paper rounded-sm"
            style={{ width: 96, height: 96 }}
          >
            <Loader2 className="w-6 h-6 text-ink-2 animate-spin" />
          </div>
        )}
        <p className="text-xs text-ink-3">配置后端地址</p>
      </div>
    </div>
  ) : null;

  const handleSkip = useCallback(async () => {
    if (!room?.id || !room.deviceId || !currentItem?.id) return;
    try {
      await client.post(`/rooms/${room.id}/queue/${currentItem.id}/skip`, {
        deviceId: room.deviceId,
      });
    } catch (e) {
      console.error('Skip failed:', e);
    }
  }, [room?.id, room?.deviceId, currentItem?.id]);

  const handleComplete = useCallback(async () => {
    if (!room?.id || !room.deviceId || !currentItem?.id) return;
    try {
      await client.post(`/rooms/${room.id}/queue/${currentItem.id}/complete`, {
        deviceId: room.deviceId,
      });
    } catch (e) {
      console.error('Complete failed:', e);
    }
  }, [room?.id, room?.deviceId, currentItem?.id]);

  const { lyrics, loading: lyricsLoading } = useLyrics(currentItem?.songId);

  const isVideo = currentItem?.fileType === 'video';

  // MV 模式：歌曲信息/待播列表在歌曲开始播放时显示 10 秒后自动隐藏
  const [mvOverlayVisible, setMvOverlayVisible] = useState(false);
  useEffect(() => {
    if (!currentItem || !isVideo) return;
    setMvOverlayVisible(true);
    const timer = setTimeout(() => setMvOverlayVisible(false), 10000);
    return () => clearTimeout(timer);
  }, [currentItem?.id, isVideo]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrc = currentItem && isVideo
    ? `${apiBase}/songs/${currentItem.songId}/audio`
    : undefined;

  const audioOriginal = currentItem
    ? `${apiBase}/songs/${currentItem.songId}/audio`
    : undefined;
  const audioVocals = currentItem && isVideo
    ? `${apiBase}/songs/${currentItem.songId}/vocals`
    : undefined;
  const audioInstrumental = currentItem
    ? `${apiBase}/songs/${currentItem.songId}/instrumental`
    : undefined;

  const {
    isPlaying,
    currentTime,
    duration,
    vocalMode,
    currentLyricIndex,
    lyricOffsetMs,
    togglePlay,
    seek,
    switchVocalMode,
    analyser,
  } = usePlayer({
    songId: currentItem?.songId,
    audioOriginal,
    audioInstrumental,
    audioVocals,
    videoSrc,
    videoRef,
    lyrics,
    vocalsFileAvailable: isVideo && currentItem ? !!currentItem.vocalsPath : undefined,
    instrumentalFileAvailable: currentItem ? !!currentItem.instrumentalPath : undefined,
    onSongEnd: () => {
      handleComplete();
    },
    onCommandFeedback: showFeedback,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'MediaAudio': {
          e.preventDefault();
          const modes: VocalMode[] = ['original', 'instrumental', 'vocal_assist'];
          const idx = modes.indexOf(vocalMode);
          const next = modes[(idx + 1) % modes.length];
          switchVocalMode(next);
          break;
        }
        case 'MediaTrackPrevious': {
          e.preventDefault();
          seek(0);
          break;
        }
        case 'MediaTrackNext': {
          e.preventDefault();
          handleSkip();
          break;
        }
        case 'Home':
        case 'BrowserHome': {
          e.preventDefault();
          navigate('/browse');
          break;
        }
        default: {
          if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            const n = Number(e.key);
            if (duration > 0) {
              seek(duration * n * 0.1);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [vocalMode, duration, switchVocalMode, seek, handleSkip, navigate]);

  if (!currentItem) {
    return (
      <div className="np-root" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <style>{css}</style>
        <ListMusic size={96} className="text-ink-2" strokeWidth={1} />
        <p className="text-ink-3 text-lg" style={{ marginTop: '24px' }}>等待点歌...</p>
        <p className="text-ink-2 text-xs" style={{ marginTop: '12px' }}>请使用手机扫码加入房间并点歌</p>
        {qrBadge}
      </div>
    );
  }

  const pendingQueue = queue.filter((q) => q.status === 'pending');

  return (
    <div className="np-root">
      <style>{css}</style>

      {/* MV 视频层 */}
      <video
        ref={videoRef}
        className={isVideo ? 'np-video-full' : 'hidden'}
        controls={false}
        playsInline
        muted
        tabIndex={-1}
      />

      {/* 歌曲信息 + 待播列表：音频模式常显；MV 模式切歌播放时显示 10 秒后隐藏 */}
      {(isVideo ? mvOverlayVisible : true) && (
        <div className="np-side-info">
          {/* 歌曲信息卡片 */}
          <div className="np-song-info">
            <h1 className="np-song-title">{currentItem.songTitle}</h1>
            <p className="np-song-artist">{currentItem.songArtist}</p>
            {currentItem.nickname && (
              <p className="np-song-requester">
                <UserRound className="np-song-requester-icon" aria-hidden="true" />
                点歌 · {currentItem.nickname}
              </p>
            )}
          </div>

          {/* 待播列表：仅显示后续 3 首 */}
          <div className="np-queue-panel">
            <p className="np-queue-title">待播</p>
            <div className="np-queue-list">
              {pendingQueue.slice(0, 3).map((item, i) => (
                <div key={item.id} className="np-queue-item">
                  <span className="np-queue-item-num">{i + 1}.</span>
                  <span className="np-queue-item-title">{item.songTitle}</span>
                  <span className="np-queue-item-user">{item.nickname}</span>
                </div>
              ))}
              {pendingQueue.length === 0 && (
                <p className="np-queue-empty">暂无待播歌曲</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 音频模式专属层（MV 不显示）：中心动画 + 歌词 */}
      {!isVideo && (
        <>
          {/* 中间视觉化区域 */}
          <div className="np-visualizer">
            <Visualizer isActive={isPlaying} analyser={analyser} />
          </div>

          {/* 歌词显示组件 - 两行 slot 循环复用 */}
          {!lyricsLoading && lyrics.length > 0 && (
            <LyricsDisplay
              lines={lyrics}
              currentIndex={currentLyricIndex}
              currentTime={currentTime}
              duration={duration}
              lyricOffsetMs={lyricOffsetMs}
            />
          )}
        </>
      )}

      {/* 二维码 */}
      {qrBadge}

      {/* 底部播放进度条：仅音频模式显示，支持遥控器左右键 ±5s 与指针拖动定位 */}
      {!isVideo && (
        <div className="np-progress">
          <div className="np-progress-time">
            <span className="np-progress-time-current">
              {formatPlayerTime(currentTime)}
            </span>
            <span className="np-progress-time-total">
              / {duration > 0 ? formatPlayerTime(duration) : '--:--'}
            </span>
          </div>
          <ProgressBar
            currentTime={currentTime}
            duration={duration}
            onSeek={seek}
            showTimes={false}
          />
        </div>
      )}

      {/* 暂停状态 */}
      {!isPlaying && (
        <div className="np-pause-standby" role="status" aria-label="已暂停">
          <Pause size={48} strokeWidth={1.6} />
          <p className="np-pause-text">已暂停</p>
        </div>
      )}

      {/* 遥控反馈 */}
      <RemoteFeedback
        icon={feedback?.icon ? <feedback.icon size={48} strokeWidth={1.6} /> : undefined}
        progress={feedback?.progress}
        text={feedback?.text}
        tick={feedback?.tick}
      />
    </div>
  );
}
