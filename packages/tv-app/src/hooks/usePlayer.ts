import { useRef, useState, useEffect, useCallback, type RefObject } from 'react';
import { wsClient } from '../ws/client';
import {
  WsMessageType,
  type PlayerStatePayload,
  type LyricSyncPayload,
  type LyricOffsetPayload,
  type PlayerCommandPayload,
} from '@nasktv/shared';
import { useWebAudio, type ReverbPreset } from './useWebAudio';
import type { LyricLine } from '../api/songs';
import { Play, Pause, Timer, Music, Music2, Mic, Waves, Volume2, Disc3, type LucideIcon } from 'lucide-react';

// 重新导出 LyricLine，保持下游组件（Lyrics.tsx / NowPlaying.tsx）的既有导入路径
export type { LyricLine };

export type VocalMode = 'original' | 'instrumental' | 'vocal_assist';

/** 秒 → mm:ss（OSD 跳转反馈用） */
function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface UsePlayerParams {
  audioOriginal?: string;        // 原声 URL：音频模式主轨 / MV 模式完整混音轨（video 静音，声音走此轨 DSP）
  audioInstrumental?: string;    // 伴奏 URL
  audioVocals?: string;          // MV 伴唱模式的人声分离轨 URL（vocals）
  videoSrc?: string;             // MV 视频 URL（fileType=video 时播放视频，忽略 Web Audio 链）
  videoRef?: RefObject<HTMLVideoElement | null>;  // MV 视频元素引用
  lyrics?: LyricLine[];          // 歌词数组（从 useLyrics 传入）
  songId?: number | null;        // 当前歌曲 ID（用于 PLAYER_STATE / LYRIC_SYNC）
  vocalsFileAvailable?: boolean; // 歌曲是否有人声分离文件（队列 vocals_path 非空）；undefined=未知，加载失败兜底降级
  instrumentalFileAvailable?: boolean; // 是否有伴奏分离文件；undefined=未知
  onSongEnd?: () => void;        // 保留以兼容 NowPlaying.tsx（不可修改）
  onCommandFeedback?: (icon: LucideIcon, text?: string, progress?: number) => void;  // 手机遥控命令执行后的 OSD 反馈（图标 + 文案 + 环形进度）
}

export interface UsePlayerReturn {
  // 既有
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  vocalMode: VocalMode;
  currentLyricIndex: number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  switchVocalMode: (mode: VocalMode) => void;
  // 新增
  pitch: number;
  reverb: number;                // wet ratio 0~1
  reverbPreset: ReverbPreset;
  reverbDuration: number;        // 自定义混响时长秒
  reverbDecay: number;           // 自定义混响衰减
  vocalAssistVolume: number;     // 0~1，人声辅助模式下原声音量
  instrumentalVolume: number;    // 0~1，伴奏轨道音量
  lyricOffsetMs: number;         // 歌词时间偏移 ms（正值 = 歌词提前），来自 H5 遥控配置
  setPitch: (semitones: number) => void;
  setReverb: (wet: number) => void;
  setReverbPreset: (preset: ReverbPreset) => void;
  setReverbCustom: (duration: number, decay: number) => void;
  setVocalAssistVolume: (v: number) => void;
  setInstrumentalVolume: (v: number) => void;
  analyser: AnalyserNode | null;
}

// 用于在事件回调中读取最新状态（避免闭包陈旧），每次渲染同步
interface PlayerStateSnapshot {
  songId: number | null | undefined;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  vocalMode: VocalMode;
  pitch: number;
  reverb: number;
  reverbPreset: ReverbPreset;
  reverbDuration: number;
  reverbDecay: number;
  vocalAssistVolume: number;
  instrumentalVolume: number;
  instrumentalAvailable: boolean;
  originalAvailable: boolean;
}

export function usePlayer({
  songId,
  audioOriginal,
  audioInstrumental,
  audioVocals,
  videoSrc,
  videoRef,
  lyrics,
  vocalsFileAvailable,
  instrumentalFileAvailable,
  onSongEnd,
  onCommandFeedback,
}: UsePlayerParams): UsePlayerReturn {
  // 两个 audio 元素：原声 / 伴奏，同时播放，通过 GainNode 控制音量
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);
  const instrumentalAudioRef = useRef<HTMLAudioElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [vocalMode, setVocalMode] = useState<VocalMode>('original');
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [pitch, setPitchState] = useState(0);
  const [reverb, setReverbState] = useState(0);
  const [reverbPreset, setReverbPresetState] = useState<ReverbPreset>('off');
  const [reverbDuration, setReverbDurationState] = useState(2);
  const [reverbDecay, setReverbDecayState] = useState(2);
  const [vocalAssistVolume, setVocalAssistVolumeState] = useState(0.5);
  const [instrumentalVolume, setInstrumentalVolumeState] = useState(1);
  // 歌词时间偏移（ms）：H5 遥控配置，歌词匹配使用 effectiveTime = currentTime + offsetMs/1000
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);
  // 歌词偏移权威值：adjust_lyric_offset 相对命令基于此累加（避免多台手机各自基于陈旧值计算）
  const lyricOffsetRef = useRef(0);
  // 伴奏轨是否可用（未分离/404 时自动降级为原声轨）
  const [instrumentalAvailable, setInstrumentalAvailable] = useState(true);
  const instrumentalOkRef = useRef(true);
  // 原声轨（MV 模式下为分离 vocals 文件）是否可用：404 时伴奏/伴唱模式不可用
  const [originalAvailable, setOriginalAvailable] = useState(true);
  const originalOkRef = useRef(true);

  // 播放失败自动重试：TV 重启后自动播放可能被 WebView 自动播放策略/音频焦点等瞬态因素拒绝，
  // 定期重试直到恢复（最长 20 秒），避免播放永久卡死、H5 端无法同步状态与控制。
  const MAX_PLAY_RETRIES = 10;
  const PLAY_RETRY_INTERVAL_MS = 2000;
  const retryTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  const clearPlayRetry = useCallback(() => {
    if (retryTimerRef.current != null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
  }, []);

  // Web Audio 节点链
  const {
    audioContext,
    analyser,
    init: initWebAudio,
    setOriginalGain,
    setInstrumentalGain,
    setPitch: setWebAudioPitch,
    setReverbPreset: setWebAudioReverbPreset,
    setReverbCustom: setWebAudioReverbCustom,
    setReverbWet,
    destroy: destroyWebAudio,
    isReady,
  } = useWebAudio();

  // onSongEnd 用 ref 持有最新值，避免 mount effect 依赖 onSongEnd 反复重建
  const onSongEndRef = useRef(onSongEnd);
  onSongEndRef.current = onSongEnd;

  // stateRef：在事件回调中读取最新状态（避免闭包陈旧），每次渲染同步
  const stateRef = useRef<PlayerStateSnapshot>({
    songId, isPlaying, currentTime, duration, vocalMode, pitch, reverb, reverbPreset, reverbDuration, reverbDecay, vocalAssistVolume, instrumentalVolume, instrumentalAvailable, originalAvailable,
  });
  stateRef.current = {
    songId, isPlaying, currentTime, duration, vocalMode, pitch, reverb, reverbPreset, reverbDuration, reverbDecay, vocalAssistVolume, instrumentalVolume, instrumentalAvailable, originalAvailable,
  };

  // 应用声道模式：音频模式走 gain 节点；MV 模式（video 有 src）用 video.muted + 分离轨补声
  // 伴奏轨不可用（未分离/404）时自动降级为原声轨
  const applyVocalMode = useCallback((mode: VocalMode, vol: number, insVol: number, insOk: boolean, origOk: boolean) => {
    const video = videoRef?.current;
    const isMV = !!video?.src;

    if (isMV) {
      // MV：video 默认静音，只出画面；声音全部走 audio 轨（DSP 链，混响/变调统一生效）。
      // 原声 = 完整混音轨（audioOriginal）；伴奏/伴唱 = 分离轨补声；
      // 分离轨缺失（未分离/404）时自动降级：原声轨发声，保证始终正常播放
      video.muted = true;
      if (mode === 'original') {
        setOriginalGain(1.0);
        setInstrumentalGain(0.0);
      } else if (mode === 'instrumental') {
        setOriginalGain(insOk ? 0.0 : 1.0);
        setInstrumentalGain(insOk ? insVol : 0.0);
      } else {
        // vocal_assist：需要 vocals + instrumental 都可用，否则降级原声
        const canAssist = insOk && origOk;
        setOriginalGain(canAssist ? vol : 1.0);
        setInstrumentalGain(canAssist ? insVol : 0.0);
      }
      return;
    }

    switch (mode) {
      case 'original':
        setOriginalGain(1.0);
        setInstrumentalGain(0.0);
        break;
      case 'instrumental':
        setOriginalGain(insOk ? 0.0 : 1.0);
        setInstrumentalGain(insOk ? insVol : 0.0);
        break;
      case 'vocal_assist':
        setOriginalGain(insOk ? vol : 1.0);
        setInstrumentalGain(insOk ? insVol : 0.0);
        break;
    }
  }, [videoRef, setOriginalGain, setInstrumentalGain]);

  // 立即广播 PLAYER_STATE（音调/混响/模式变化时调用，不等 1 秒节流）
  // currentTime / status 从真实媒体元素读取，保证暂停/seek 后广播准确（H5 遥控实时同步）
  const broadcastPlayerState = useCallback((overrides?: Partial<PlayerStatePayload>) => {
    const s = stateRef.current;
    if (s.songId == null) return;
    const primary = videoRef?.current?.src
      ? videoRef.current
      : originalAudioRef.current?.src
        ? originalAudioRef.current
        : null;
    const currentTime = primary ? primary.currentTime : s.currentTime;
    const isPlaying = primary ? !primary.paused : s.isPlaying;
    // duration 优先读媒体元素真实值：切歌瞬间 state 仍是旧歌时长，直接读 primary 避免广播旧时长
    const duration = primary && primary.duration ? primary.duration : s.duration;
    const payload: PlayerStatePayload = {
      songId: s.songId,
      status: isPlaying ? 'playing' : 'paused',
      currentTime,
      duration: duration || 0,
      vocalMode: s.vocalMode,
      pitch: s.pitch,
      reverb: s.reverb,
      reverbPreset: s.reverbPreset,
      reverbDuration: s.reverbDuration,
      reverbDecay: s.reverbDecay,
      vocalAssistVolume: s.vocalAssistVolume,
      instrumentalVolume: s.instrumentalVolume,
      ...overrides,
    };
    wsClient.send({
      type: WsMessageType.PLAYER_STATE,
      payload,
      timestamp: Date.now(),
    });
  }, [videoRef]);

  // 尝试播放全部媒体元素（含 AudioContext 恢复）。主媒体播放成功即视为成功；
  // 全部失败时广播 paused 并定时重试（自动播放策略/音频焦点等瞬态问题），
  // 保证 TV 重启后能自愈恢复播放，H5 端状态同步与控制不再永久失效。
  const tryPlayMedia = useCallback(() => {
    // 恢复 AudioContext（自动播放策略下可能 suspended；无手势时 resume 可能被拒，重试期间持续尝试）
    audioContext?.resume();
    const o = originalAudioRef.current;
    const ins = instrumentalAudioRef.current;
    const video = videoRef?.current;
    const plays: Promise<boolean>[] = [];
    if (o?.src) plays.push(o.play().then(() => true).catch(() => false));
    if (ins?.src) plays.push(ins.play().then(() => true).catch(() => false));
    if (video?.src) plays.push(video.play().then(() => true).catch(() => false));
    if (plays.length === 0) return;

    Promise.all(plays).then((results) => {
      const primary = video?.src ? video : o?.src ? o : ins?.src ? ins : null;
      const primaryPlaying = primary ? !primary.paused && !primary.ended : false;
      if (primaryPlaying) {
        clearPlayRetry();
        setIsPlaying(true);
        return;
      }
      setIsPlaying(false);
      // 全部媒体播放失败：广播 paused（避免 H5 显示旧播放状态），并调度重试
      broadcastPlayerState({ status: 'paused' });
      if (retryTimerRef.current != null) return;
      if (retryCountRef.current >= MAX_PLAY_RETRIES) return;
      retryCountRef.current += 1;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        tryPlayMedia();
      }, PLAY_RETRY_INTERVAL_MS);
    });
  }, [audioContext, videoRef, broadcastPlayerState, clearPlayRetry]);

  // 初始化：创建双 audio 元素 + 初始化 Web Audio 节点链 + 事件监听
  useEffect(() => {
    const originalAudio = new Audio();
    const instrumentalAudio = new Audio();
    // 跨源音频需以 CORS 模式加载，Web Audio（createMediaElementSource）才能读取采样混音；
    // 必须在赋值 src 前设置，否则会触发重新加载。后端音频响应已带
    // Access-Control-Allow-Origin / Cross-Origin-Resource-Policy 放行。
    originalAudio.crossOrigin = 'anonymous';
    instrumentalAudio.crossOrigin = 'anonymous';
    originalAudioRef.current = originalAudio;
    instrumentalAudioRef.current = instrumentalAudio;

    initWebAudio(originalAudio, instrumentalAudio);

    // 主媒体（用于 time/duration 跟踪）：优先 video，其次原声，无原声时用伴奏
    const getPrimary = (): HTMLMediaElement | null => {
      if (videoRef?.current?.src) return videoRef.current;
      if (originalAudio.src) return originalAudio;
      if (instrumentalAudio.src) return instrumentalAudio;
      return null;
    };

    // 节流当前播放时间 state：timeupdate 可能高频触发（MV 模式三个媒体元素），
    // 差值 ≥ 0.2s 才提交，保证歌词渐变平滑且不拖垮整页渲染
    let lastCommittedTime = -1;
    const handleTimeUpdate = () => {
      const p = getPrimary();
      if (p) {
        const t = p.currentTime;
        if (Math.abs(t - lastCommittedTime) >= 0.2) {
          lastCommittedTime = t;
          setCurrentTime(t);
        }
      }
      // MV 模式：以 video 为进度基准，校正双 audio 分离轨漂移（缓冲差异超过 0.5s 才校正，避免抖动）
      const v = videoRef?.current;
      if (v?.src) {
        if (originalAudio.src && Math.abs(originalAudio.currentTime - v.currentTime) > 0.5) {
          originalAudio.currentTime = v.currentTime;
        }
        if (instrumentalAudio.src && Math.abs(instrumentalAudio.currentTime - v.currentTime) > 0.5) {
          instrumentalAudio.currentTime = v.currentTime;
        }
      }
    };
    const handleDurationChange = () => {
      const p = getPrimary();
      if (p) setDuration(p.duration || 0);
    };
    // 多媒体状态以主媒体为准：MV 取 video，音频歌曲取原声轨。
    // 辅助轨可能因无分离文件、切轨或缓冲触发 pause，不能据此把整机状态标成暂停。
    const syncPlaybackState = () => {
      const primary = getPrimary();
      setIsPlaying(primary ? !primary.paused && !primary.ended : false);
    };
    const handlePlay = () => syncPlaybackState();
    const handlePause = () => syncPlaybackState();
    let lastEnded = 0;
    const handleEnded = (event: Event) => {
      const primary = getPrimary();
      // 原声/伴奏辅助轨时长可能略短，只有主媒体结束才推进队列。
      if (primary && event.currentTarget !== primary) return;
      // 双 audio 同步播放会在相近时刻都触发 ended，1 秒内去重
      const now = Date.now();
      if (now - lastEnded < 1000) return;
      lastEnded = now;
      originalAudio.pause();
      instrumentalAudio.pause();
      videoRef?.current?.pause();
      setIsPlaying(false);
      clearPlayRetry();
      onSongEndRef.current?.();
    };

    // video 可能在房间快照到达后才渲染，不能在本初始化 effect 中一次性捕获。
    // 这里只绑定 hook 自己创建的 audio；video 由下方独立 effect 随 videoSrc 绑定。
    const medias: HTMLMediaElement[] = [originalAudio, instrumentalAudio];
    medias.forEach((m) => {
      m.addEventListener('timeupdate', handleTimeUpdate);
      m.addEventListener('durationchange', handleDurationChange);
      m.addEventListener('play', handlePlay);
      m.addEventListener('pause', handlePause);
      m.addEventListener('ended', handleEnded);
    });

    // 伴奏轨加载失败（未分离/404）：降级为单轨，避免静音
    const handleInstrumentalError = () => {
      if (!instrumentalOkRef.current) return;
      instrumentalOkRef.current = false;
      setInstrumentalAvailable(false);
    };
    instrumentalAudio.addEventListener('error', handleInstrumentalError);
    instrumentalAudio.addEventListener('stalled', handleInstrumentalError);

    // 原声轨（MV 模式 vocals）加载失败（未分离/404）：MV 下伴奏/伴唱无法补声 → 降级视频原声
    const handleOriginalError = () => {
      if (!originalOkRef.current) return;
      originalOkRef.current = false;
      setOriginalAvailable(false);
    };
    originalAudio.addEventListener('error', handleOriginalError);
    originalAudio.addEventListener('stalled', handleOriginalError);

    return () => {
      medias.forEach((m) => {
        m.removeEventListener('timeupdate', handleTimeUpdate);
        m.removeEventListener('durationchange', handleDurationChange);
        m.removeEventListener('play', handlePlay);
        m.removeEventListener('pause', handlePause);
        m.removeEventListener('ended', handleEnded);
        if (m instanceof HTMLAudioElement) {
          m.pause();
          m.removeAttribute('src');
          m.load();
        }
      });
      instrumentalAudio.removeEventListener('error', handleInstrumentalError);
      instrumentalAudio.removeEventListener('stalled', handleInstrumentalError);
      originalAudio.removeEventListener('error', handleOriginalError);
      originalAudio.removeEventListener('stalled', handleOriginalError);
      destroyWebAudio();
      clearPlayRetry();
    };
  }, [initWebAudio, destroyWebAudio, videoRef, clearPlayRetry]);

  // TV 启动时队列快照可能晚于页面挂载：首次 effect 执行时 <video> 尚不存在。
  // 随 videoSrc 独立绑定主视频事件，确保自动播放、遥控暂停/恢复和进度状态都能驱动 UI。
  useEffect(() => {
    const video = videoRef?.current;
    if (!video || !videoSrc) return;

    let lastCommittedTime = -1;
    const syncPlaybackState = () => {
      setIsPlaying(!video.paused && !video.ended);
    };
    const handleTimeUpdate = () => {
      const t = video.currentTime;
      if (Math.abs(t - lastCommittedTime) >= 0.2) {
        lastCommittedTime = t;
        setCurrentTime(t);
      }
      const originalAudio = originalAudioRef.current;
      const instrumentalAudio = instrumentalAudioRef.current;
      if (
        originalAudio?.src &&
        Math.abs(originalAudio.currentTime - video.currentTime) > 0.5
      ) {
        originalAudio.currentTime = video.currentTime;
      }
      if (
        instrumentalAudio?.src &&
        Math.abs(instrumentalAudio.currentTime - video.currentTime) > 0.5
      ) {
        instrumentalAudio.currentTime = video.currentTime;
      }
    };
    const handleDurationChange = () => setDuration(video.duration || 0);
    const handleEnded = () => {
      originalAudioRef.current?.pause();
      instrumentalAudioRef.current?.pause();
      setIsPlaying(false);
      clearPlayRetry();
      onSongEndRef.current?.();
    };

    video.addEventListener('play', syncPlaybackState);
    video.addEventListener('playing', syncPlaybackState);
    video.addEventListener('pause', syncPlaybackState);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('ended', handleEnded);
    syncPlaybackState();

    return () => {
      video.removeEventListener('play', syncPlaybackState);
      video.removeEventListener('playing', syncPlaybackState);
      video.removeEventListener('pause', syncPlaybackState);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('ended', handleEnded);
      clearPlayRetry();
    };
  }, [videoRef, videoSrc, clearPlayRetry]);

  // 事件驱动自愈：TV 刷新/重启后 WebView 可能处于未激活状态（无焦点、定时器被
  // 节流、自动播放被瞬态拒绝），打开 DevTools / 窗口激活 / 遥控器按键会触发
  // focus / resize / visibilitychange / keydown 等事件而恢复——这里把同样的
  // 恢复信号内建：页面重新激活时若当前歌曲未播放，重置重试计数并重新尝试，
  // 无需人工打开 DevTools 干预
  useEffect(() => {
    const resumePlayback = () => {
      const s = stateRef.current;
      if (s.songId == null || s.isPlaying) return;
      const primary = videoRef?.current?.src
        ? videoRef.current
        : originalAudioRef.current?.src
          ? originalAudioRef.current
          : null;
      if (!primary?.src) return;
      clearPlayRetry();
      tryPlayMedia();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumePlayback();
    };
    window.addEventListener('focus', resumePlayback);
    window.addEventListener('resize', resumePlayback);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', resumePlayback);
    window.addEventListener('pointerdown', resumePlayback);
    return () => {
      window.removeEventListener('focus', resumePlayback);
      window.removeEventListener('resize', resumePlayback);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', resumePlayback);
      window.removeEventListener('pointerdown', resumePlayback);
    };
  }, [tryPlayMedia, clearPlayRetry, videoRef]);

  // 切歌：同时设置两个 audio 的 src，保持播放状态；MV 时设置 video src
  useEffect(() => {
    const o = originalAudioRef.current;
    const ins = instrumentalAudioRef.current;
    if (!o || !ins) return;

    const video = videoRef?.current;

    // 预防性降级（数据驱动）：队列带分离路径字段，明确无分离文件时直接标记不可用，
    // 避免 404 请求与 error 事件前的静音窗口；undefined=未知，走加载失败兜底
    // audioOriginal（音频模式主轨 / MV 混音轨）是原声兜底，始终加载
    if (audioOriginal) {
      o.src = audioOriginal;
    } else {
      o.removeAttribute('src');
      o.load();
    }
    // 伴奏轨：明确无分离文件时跳过加载（404 → error 事件兜底降级）
    const shouldLoadInstrumental = instrumentalFileAvailable ?? true;
    if (shouldLoadInstrumental && audioInstrumental) {
      ins.src = audioInstrumental;
    } else {
      ins.removeAttribute('src');
      ins.load();
    }
    // MV 伴唱轨（vocals）：不预加载（伴唱模式按需切换 src），仅做可用性标记
    // 明确无分离文件 → 直接标记不可用（applyVocalMode 降级原声）
    const vocalsOkByData = vocalsFileAvailable ?? true;
    originalOkRef.current = vocalsOkByData;
    setOriginalAvailable(vocalsOkByData);

    if (videoSrc && video) {
      video.src = videoSrc;
      // 画面轨永不出声（声音走 audio DSP 链）
      video.muted = true;
    } else if (video) {
      video.removeAttribute('src');
      video.load();
    }

    // 切歌后重新应用变调（worklet 模式重设 AudioParam / 降级模式重设 playbackRate，幂等）
    setWebAudioPitch(stateRef.current.pitch);

    // 切歌时重置分离轨可用状态：数据明确无分离 → 直接标记不可用（立即降级原声）；
    // 数据未知 → 先视为可用，加载失败（404/网络）时由 error 事件兜底降级
    instrumentalOkRef.current = shouldLoadInstrumental;
    setInstrumentalAvailable(shouldLoadInstrumental);

    // 切歌后自动播放：手机点歌 / 遥控跳过 / 队列推进均需自动续播（KTV 场景）。
    // 播放失败不静默：全部媒体均失败时同步 isPlaying=false 并广播 paused，
    // 同时内部定时重试，避免 TV 重启后自动播放被策略拒绝导致永久卡死
    clearPlayRetry();
    tryPlayMedia();
    // 切歌立即广播一次（不等 1s 定时器）：所有在线用户马上看到新歌与真实进度，避免"部分用户不更新"
    broadcastPlayerState();
  }, [audioOriginal, audioInstrumental, videoSrc, videoRef, audioContext, setWebAudioPitch, vocalsFileAvailable, instrumentalFileAvailable, broadcastPlayerState, tryPlayMedia, clearPlayRetry]);

  // isReady 后 / 模式变化 / 人声辅助音量 / 伴奏音量 / 分离轨可用性 变化时应用 gain
  useEffect(() => {
    if (!isReady) return;
    applyVocalMode(vocalMode, vocalAssistVolume, instrumentalVolume, instrumentalAvailable, originalAvailable);
  }, [isReady, vocalMode, vocalAssistVolume, instrumentalVolume, instrumentalAvailable, originalAvailable, applyVocalMode]);

  // MV 伴唱轨切换：伴唱模式把 original 轨切到 vocals 分离文件；
  // vocals 不可用（无分离/404）时切回混音轨 → 配合 applyVocalMode 降级为原声，保证正常播放
  useEffect(() => {
    const video = videoRef?.current;
    const o = originalAudioRef.current;
    if (!o || !video?.src || !audioOriginal) return; // 仅 MV 模式
    const useVocals = vocalMode === 'vocal_assist' && originalAvailable;
    const target = useVocals ? audioVocals : audioOriginal;
    if (!target || o.src === target) return;
    if (useVocals) {
      // 乐观重试：切换 vocals 轨并重新判定可用性（404 → error 事件 → origOk=false → 本 effect 切回混音）
      originalOkRef.current = true;
      setOriginalAvailable(true);
    }
    const wasPlaying = !o.paused;
    const keepTime = video.currentTime;
    o.src = target;
    // 切轨后重设变调（worklet 模式 AudioParam / 降级模式 playbackRate，幂等）
    setWebAudioPitch(stateRef.current.pitch);
    if (wasPlaying) {
      o.currentTime = keepTime;
      o.play().catch(() => {});
    }
  }, [vocalMode, audioOriginal, audioVocals, videoRef, originalAvailable, setWebAudioPitch]);

  // 推送 PLAYER_STATE（每秒一次，仅播放中）
  useEffect(() => {
    if (!isPlaying || songId == null) return;
    broadcastPlayerState();
    const timer = window.setInterval(broadcastPlayerState, 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, songId, broadcastPlayerState]);

  // 播放/暂停状态变化时立即广播（暂停不触发 1 秒定时器，需即时推送让 H5 遥控同步）
  useEffect(() => {
    if (songId == null) return;
    broadcastPlayerState();
  }, [isPlaying, songId, broadcastPlayerState]);

  // 计算并推送 LYRIC_SYNC（currentTime 变化时触发）
  // 歌词时间偏移：歌词匹配滞后时 H5 遥控设置正值提前显示，TV/H5 两端同步生效
  useEffect(() => {
    if (!isPlaying || !lyrics || lyrics.length === 0 || songId == null) return;

    const adjustedTime = currentTime + lyricOffsetMs / 1000;
    const idx = lyrics.findIndex((line, i) => {
      const next = lyrics[i + 1];
      return adjustedTime >= line.time && (!next || adjustedTime < next.time);
    });

    if (idx !== currentLyricIndex) {
      setCurrentLyricIndex(idx);
      if (idx >= 0) {
        const payload: LyricSyncPayload = {
          songId,
          currentTime,
          lineIndex: idx,
        };
        wsClient.send({
          type: WsMessageType.LYRIC_SYNC,
          payload,
          timestamp: Date.now(),
        });
      }
    }
  }, [currentTime, lyrics, currentLyricIndex, isPlaying, songId, lyricOffsetMs]);

  // 应用歌词偏移（TV 端为房间内唯一权威值）。
  // broadcast=true 时把结果回广播给房间，使所有手机 UI 显示同一个值。
  // （后端 broadcastToRoom 会排除发送者，广播不会回到 TV 自身，不会形成回环）
  const applyLyricOffset = useCallback(
    (offsetMs: number, broadcast: boolean) => {
      const clamped = Math.max(-10000, Math.min(10000, Math.round(offsetMs)));
      lyricOffsetRef.current = clamped;
      setLyricOffsetMs(clamped);
      if (broadcast) {
        const payload: LyricOffsetPayload = { offsetMs: clamped };
        wsClient.send({
          type: WsMessageType.LYRIC_OFFSET,
          payload,
          timestamp: Date.now(),
        });
      }
      // OSD 反馈：歌词偏移变化时在 TV 屏幕居中显示（与播放/暂停/调调等反馈一致）
      if (clamped === 0) {
        onCommandFeedback?.(Timer, '歌词 同步');
      } else {
        const sign = clamped > 0 ? '+' : '';
        onCommandFeedback?.(Timer, `歌词 ${sign}${(clamped / 1000).toFixed(1)}s`);
      }
    },
    [onCommandFeedback],
  );

  // 监听歌词偏移配置（LYRIC_OFFSET，来自 H5 遥控 / 服务端重连补发）
  useEffect(() => {
    const unsub = wsClient.on(WsMessageType.LYRIC_OFFSET, (msg) => {
      const payload = (msg.payload ?? {}) as LyricOffsetPayload;
      const offset = Number(payload.offsetMs);
      if (Number.isFinite(offset)) {
        applyLyricOffset(offset, true);
      }
    });
    return unsub;
  }, [applyLyricOffset]);

  const play = useCallback(() => {
    // 恢复 AudioContext（用户手势触发，避免 suspended 无声）；
    // 失败由 tryPlayMedia 内部广播 paused 并定时重试，H5 遥控不会静默失效
    tryPlayMedia();
  }, [tryPlayMedia]);

  const pause = useCallback(() => {
    originalAudioRef.current?.pause();
    instrumentalAudioRef.current?.pause();
    videoRef?.current?.pause();
  }, [videoRef]);

  const togglePlay = useCallback(() => {
    if (stateRef.current.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [play, pause]);

  const seek = useCallback((time: number) => {
    if (originalAudioRef.current) {
      originalAudioRef.current.currentTime = time;
    }
    if (instrumentalAudioRef.current) {
      instrumentalAudioRef.current.currentTime = time;
    }
    if (videoRef?.current) {
      videoRef.current.currentTime = time;
    }
    // 立即广播新进度（broadcastPlayerState 从媒体元素读取真实 currentTime）
    broadcastPlayerState();
  }, [videoRef, broadcastPlayerState]);

  const switchVocalMode = useCallback((mode: VocalMode) => {
    setVocalMode(mode);
    // 立即应用 gain（不等 effect）
    applyVocalMode(mode, stateRef.current.vocalAssistVolume, stateRef.current.instrumentalVolume, stateRef.current.instrumentalAvailable, stateRef.current.originalAvailable);
    // 立即广播模式变化
    broadcastPlayerState({ vocalMode: mode });
  }, [applyVocalMode, broadcastPlayerState]);

  // 变调（-12~+12 半音）：走 Web Audio WSOLA 不变速变调（SoundTouch worklet）
  // 原调零延迟旁路；worklet 注册失败时 useWebAudio 内部降级为 playbackRate
  const setPitch = useCallback((semitones: number) => {
    const clamped = Math.max(-12, Math.min(12, semitones));
    setPitchState(clamped);
    setWebAudioPitch(clamped);
    broadcastPlayerState({ pitch: clamped });
  }, [setWebAudioPitch, broadcastPlayerState]);

  const setReverb = useCallback((wet: number) => {
    const clamped = Math.max(0, Math.min(1, wet));
    setReverbState(clamped);
    setReverbWet(clamped);
    broadcastPlayerState({ reverb: clamped });
  }, [setReverbWet, broadcastPlayerState]);

  const setReverbPreset = useCallback((preset: ReverbPreset) => {
    setReverbPresetState(preset);
    if (preset === 'custom') {
      // custom 的 IR 用当前自定义参数生成
      const s = stateRef.current;
      setWebAudioReverbCustom(s.reverbDuration, s.reverbDecay);
    } else {
      setWebAudioReverbPreset(preset);
    }
    if (preset === 'off') {
      // off 时同时把 wet 归零
      setReverbState(0);
      setReverbWet(0);
      broadcastPlayerState({ reverbPreset: 'off', reverb: 0 });
    } else {
      // 切换预设：wet 为 0 时给默认强度 0.3，否则用户听不到混响且 H5 显示不变
      const next = stateRef.current.reverb > 0 ? stateRef.current.reverb : 0.3;
      setReverbState(next);
      setReverbWet(next);
      broadcastPlayerState({ reverbPreset: preset, reverb: next });
    }
  }, [setWebAudioReverbPreset, setWebAudioReverbCustom, setReverbWet, broadcastPlayerState]);

  const setReverbCustom = useCallback((duration: number, decay: number) => {
    const d = Math.min(5, Math.max(0.5, duration));
    const k = Math.min(4, Math.max(1, decay));
    setReverbPresetState('custom');
    setReverbDurationState(d);
    setReverbDecayState(k);
    setWebAudioReverbCustom(d, k);
    // wet 为 0 时给默认强度 0.3
    const next = stateRef.current.reverb > 0 ? stateRef.current.reverb : 0.3;
    setReverbState(next);
    setReverbWet(next);
    broadcastPlayerState({
      reverbPreset: 'custom',
      reverb: next,
      reverbDuration: d,
      reverbDecay: k,
    });
  }, [setWebAudioReverbCustom, setReverbWet, broadcastPlayerState]);

  const setVocalAssistVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVocalAssistVolumeState(clamped);
    // 人声辅助模式下统一走 applyVocalMode 即时应用（含 MV 静音/降级判定）
    const s = stateRef.current;
    if (s.vocalMode === 'vocal_assist') {
      applyVocalMode('vocal_assist', clamped, s.instrumentalVolume, s.instrumentalAvailable, s.originalAvailable);
    }
    // 广播最新人声辅助音量（stateRef 渲染期才同步，用 override 传即时值）
    broadcastPlayerState({ vocalAssistVolume: clamped });
  }, [applyVocalMode, broadcastPlayerState]);

  const setInstrumentalVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setInstrumentalVolumeState(clamped);
    // 立即应用 gain（不等 effect），人声辅助/伴奏模式下均生效
    applyVocalMode(
      stateRef.current.vocalMode,
      stateRef.current.vocalAssistVolume,
      clamped,
      stateRef.current.instrumentalAvailable,
      stateRef.current.originalAvailable,
    );
    // 广播最新伴奏音量
    broadcastPlayerState({ instrumentalVolume: clamped });
  }, [applyVocalMode, broadcastPlayerState]);

  // 监听手机遥控命令（PLAYER_COMMAND）：播放/暂停/seek/调调/混响/伴唱模式/人声辅助音量
  // 执行后通过 onCommandFeedback 回调产生 OSD 反馈（图标 + 文案 + 可选环形进度，TV 屏幕居中短暂显示）
  useEffect(() => {
    const unsub = wsClient.on(WsMessageType.PLAYER_COMMAND, (msg) => {
      const payload = (msg.payload ?? {}) as PlayerCommandPayload;
      const feedback = (icon: LucideIcon, text?: string, progress?: number) =>
        onCommandFeedback?.(icon, text, progress);
      switch (payload.command) {
        case 'play': {
          // 显式播放（多 H5 并发安全）：已在播放则忽略
          if (!stateRef.current.isPlaying) {
            play();
            feedback(Play, '已播放');
          }
          break;
        }
        case 'pause': {
          // 显式暂停（多 H5 并发安全）：已暂停则忽略
          if (stateRef.current.isPlaying) {
            pause();
          }
          break;
        }
        case 'toggle_play': {
          // 兼容旧版 H5 客户端：翻转播放状态
          const wasPlaying = stateRef.current.isPlaying;
          togglePlay();
          // 暂停时 OSD 不重复反馈：屏幕中央已有暂停常显（np-pause-standby），避免双图标
          if (wasPlaying) return;
          feedback(Play, '已播放');
          break;
        }
        case 'seek': {
          if (typeof payload.value === 'number') {
            seek(payload.value);
            feedback(Timer, `已跳转 ${formatClock(payload.value)}`);
          }
          break;
        }
        case 'set_pitch': {
          if (typeof payload.value === 'number') {
            setPitch(payload.value);
            const v = Math.max(-12, Math.min(12, payload.value));
            feedback(
              Music2,
              v > 0 ? `音调 +${v}` : v < 0 ? `音调 ${v}` : '音调 原调',
              (v + 12) / 24,
            );
          }
          break;
        }
        // 相对调节：以 TV 端自身当前值为基准累加，避免多台手机各自基于
        // 陈旧广播值算绝对值导致的丢更新（两人同时 +1 只升一个半音）
        case 'adjust_pitch': {
          if (typeof payload.value === 'number') {
            const v = Math.max(-12, Math.min(12, stateRef.current.pitch + payload.value));
            setPitch(v);
            feedback(
              Music2,
              v > 0 ? `音调 +${v}` : v < 0 ? `音调 ${v}` : '音调 原调',
              (v + 12) / 24,
            );
          }
          break;
        }
        case 'set_reverb': {
          if (typeof payload.value === 'number') {
            setReverb(payload.value);
            const v = Math.max(0, Math.min(1, payload.value));
            feedback(Waves, `混响 ${Math.round(v * 100)}%`, v);
          }
          break;
        }
        case 'set_reverb_preset': {
          if (
            payload.value === 'hall' ||
            payload.value === 'room' ||
            payload.value === 'stage' ||
            payload.value === 'off' ||
            payload.value === 'custom'
          ) {
            setReverbPreset(payload.value);
            const label =
              payload.value === 'off'
                ? '混响 关闭'
                : payload.value === 'custom'
                  ? '混响 自定义'
                  : `混响 ${payload.value === 'hall' ? '厅堂' : payload.value === 'room' ? '房间' : '舞台'}`;
            feedback(Waves, label);
          }
          break;
        }
        case 'set_reverb_custom': {
          const v = payload.value as { duration?: number; decay?: number } | undefined;
          if (v && typeof v.duration === 'number' && typeof v.decay === 'number') {
            setReverbCustom(v.duration, v.decay);
            // 环形进度 = 时长/衰减归一化加权平均：调节任意滑块进度环均有响应
            const progress = (Math.min(1, v.duration / 5) + Math.min(1, v.decay / 4)) / 2;
            feedback(Waves, `${v.duration.toFixed(1)}s·${v.decay.toFixed(1)}`, progress);
          }
          break;
        }
        case 'set_vocal_mode': {
          if (
            payload.value === 'original' ||
            payload.value === 'instrumental' ||
            payload.value === 'vocal_assist'
          ) {
            // 分离轨不可用时切换会静默降级为原声，反馈明确告知
            const insOk = stateRef.current.instrumentalAvailable;
            const origOk = stateRef.current.originalAvailable;
            const isMV = !!videoRef?.current?.src;
            const cannotSeparate = isMV ? !(insOk && origOk) : !insOk;
            switchVocalMode(payload.value);
            const icon =
              payload.value === 'original' ? Music : payload.value === 'instrumental' ? Music2 : Mic;
            const label =
              payload.value === 'original'
                ? '原声'
                : payload.value === 'instrumental'
                ? '伴奏'
                : '伴唱';
            feedback(icon, payload.value !== 'original' && cannotSeparate ? '分离轨不可用，仍为原声' : `已切换：${label}`);
          }
          break;
        }
        case 'set_vocal_assist_volume': {
          if (typeof payload.value === 'number') {
            setVocalAssistVolume(payload.value);
            const v = Math.max(0, Math.min(1, payload.value));
            feedback(Volume2, `人声辅助 ${Math.round(v * 100)}%`, v);
          }
          break;
        }
        case 'set_instrumental_volume': {
          if (typeof payload.value === 'number') {
            setInstrumentalVolume(payload.value);
            const v = Math.max(0, Math.min(1, payload.value));
            feedback(Disc3, `伴奏 ${Math.round(v * 100)}%`, v);
          }
          break;
        }
        // 相对调节：基于 TV 自身权威值累加，避免多台手机各自读到同一份
        // 陈旧广播值后发送相同绝对值，导致其中一次点击被吞掉
        case 'adjust_vocal_assist_volume': {
          if (typeof payload.value === 'number') {
            const v = Math.max(
              0,
              Math.min(1, Math.round((stateRef.current.vocalAssistVolume + payload.value) * 100) / 100),
            );
            setVocalAssistVolume(v);
            feedback(Volume2, `人声辅助 ${Math.round(v * 100)}%`, v);
          }
          break;
        }
        case 'adjust_instrumental_volume': {
          if (typeof payload.value === 'number') {
            const v = Math.max(
              0,
              Math.min(1, Math.round((stateRef.current.instrumentalVolume + payload.value) * 100) / 100),
            );
            setInstrumentalVolume(v);
            feedback(Disc3, `伴奏 ${Math.round(v * 100)}%`, v);
          }
          break;
        }
        case 'adjust_lyric_offset': {
          if (typeof payload.value === 'number') {
            applyLyricOffset(lyricOffsetRef.current + payload.value, true);
          }
          break;
        }
      }
    });
    return unsub;
  }, [togglePlay, play, pause, seek, setPitch, setReverb, setReverbPreset, setReverbCustom, switchVocalMode, setVocalAssistVolume, setInstrumentalVolume, applyLyricOffset, onCommandFeedback, videoRef]);

  return {
    isPlaying,
    currentTime,
    duration,
    vocalMode,
    currentLyricIndex,
    play,
    pause,
    togglePlay,
    seek,
    switchVocalMode,
    pitch,
    reverb,
    reverbPreset,
    reverbDuration,
    reverbDecay,
    vocalAssistVolume,
    instrumentalVolume,
    lyricOffsetMs,
    setPitch,
    setReverb,
    setReverbPreset,
    setReverbCustom,
    setVocalAssistVolume,
    setInstrumentalVolume,
    analyser,
  };
}
