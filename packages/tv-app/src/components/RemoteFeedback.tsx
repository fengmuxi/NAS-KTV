// Hallmark · component: remote-feedback (OSD) · genre: atmospheric · theme: Midnight
// states: default · hidden · reduced-motion
// 手机遥控命令的屏幕反馈：半透明近黑圆底 + 居中图标，图标正下方直排命令文案；
// 音量/强度类命令外围渲染环形进度条（进度=数值）；进场/退场收缩淡入淡出
// （tick 驱动，避免父组件重渲染导致不消失）
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface RemoteFeedbackProps {
  icon?: ReactNode;
  /** 0~1 环形进度（音量/混响强度类命令），缺省不渲染进度环 */
  progress?: number;
  /** 图标下方说明文案（命令名/降级提示），缺省不渲染 */
  text?: string;
  /** 每次显示自增 key（Date.now()），驱动显示与计时重置 */
  tick?: number;
  duration?: number; // 显示时长 ms，默认 1500
}

const RING_RADIUS = 74;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
// 退场动画时长（与 --dur-base 一致），结束后卸载
const HIDE_ANIM_MS = 250;

const css = `
.rf-osd {
  position: fixed;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%);
  z-index: 60;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  width: 200px;
  height: 200px;
  border-radius: var(--radius-full);
  background-color: var(--color-osd);
  backdrop-filter: blur(20px) saturate(150%);
  box-shadow: var(--shadow-osd);
}

.rf-osd.is-showing {
  animation: rf-pop var(--dur-base) var(--ease-out) both;
}

.rf-osd.is-hiding {
  animation: rf-shrink var(--dur-base) var(--ease-in) both;
}

.rf-osd-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
}

/* 图标正下方的命令文案：圆内直排（无独立底），与图标同轴居中；
 * 宽度 ≤140px 保证不与外围环形进度条（r=74）重叠 */
.rf-osd-text {
  max-width: 140px;
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-ink-2);
  text-align: center;
  overflow-wrap: anywhere;
}

.rf-ring {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  width: 100%;
  height: 100%;
}

.rf-ring-track {
  fill: none;
  stroke: var(--color-osd-track);
  stroke-width: 8px;
}

.rf-ring-fill {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 8px;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-fast) var(--ease-out);
}

@keyframes rf-pop {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 12px)) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes rf-shrink {
  from {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.8);
  }
}

/* reduced-motion：撤销进/退场动画（图标信息本身保留，纯瞬态展示） */
@media (prefers-reduced-motion: reduce) {
  .rf-osd.is-showing,
  .rf-osd.is-hiding {
    animation: none;
    opacity: 1;
  }
}
`;

type Phase = 'hidden' | 'showing' | 'hiding';

export default function RemoteFeedback({
  icon,
  progress,
  text,
  tick = 0,
  duration = 1500,
}: RemoteFeedbackProps) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // tick 驱动：新 tick → 进场 + 重置退场计时；tick 结束 → 退场动画
  useEffect(() => {
    if (!tick) {
      setPhase('hidden');
      return;
    }
    setPhase('showing');
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    showTimerRef.current = setTimeout(() => setPhase('hiding'), duration);
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, [tick, duration]);

  // 退场动画播放完毕后卸载（用 tick 区分：动画期间新 tick 会切回 showing）
  useEffect(() => {
    if (phase !== 'hiding') return;
    hideTimerRef.current = setTimeout(() => setPhase('hidden'), HIDE_ANIM_MS);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [phase, tick]);

  if (!icon || phase === 'hidden') {
    return null;
  }

  const clamped = Math.max(0, Math.min(1, progress ?? 0));
  const dashOffset = RING_CIRCUMFERENCE * (1 - clamped);

  return (
    <>
      <style>{css}</style>
      <div
        className={`rf-osd ${phase === 'showing' ? 'is-showing' : 'is-hiding'}`}
        role="status"
        aria-label="操作反馈"
      >
        {typeof progress === 'number' && (
          <svg
            className="rf-ring"
            viewBox="0 0 200 200"
            aria-hidden="true"
          >
            <circle
              className="rf-ring-track"
              cx={100}
              cy={100}
              r={RING_RADIUS}
            />
            <circle
              className="rf-ring-fill"
              cx={100}
              cy={100}
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 100 100)"
            />
          </svg>
        )}
        <span className="rf-osd-icon" aria-hidden="true">
          {icon}
        </span>
        {text && <p className="rf-osd-text">{text}</p>}
      </div>
    </>
  );
}
