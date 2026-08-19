/* Hallmark · genre: editorial · theme: Garden · Lyrics component
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 */

import { useRef, useEffect } from 'react';

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsProps {
  lines: LyricLine[];
  currentIndex: number;
  currentTime?: number; // 当前播放秒数，用于当前行按进度渐变着色
  playing?: boolean;    // 播放中：本地插值推进进度，消除广播跳变
}

const css = `
.lyric-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.lyric-scroll {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding-top: var(--space-2xl);
  padding-bottom: var(--space-2xl);
  scrollbar-width: none;
}
.lyric-scroll::-webkit-scrollbar {
  display: none;
}

/* 上下玻璃遮罩：渐变 + 模糊，营造层次感（不阻挡滚动） */
.lyric-fade {
  position: absolute;
  left: 0;
  right: 0;
  height: 44px;
  pointer-events: none;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 1;
}
.lyric-fade--top {
  top: 0;
  background: linear-gradient(
    to bottom,
    color-mix(in oklch, var(--color-paper) 88%, transparent) 0%,
    transparent 100%
  );
}
.lyric-fade--bottom {
  bottom: 0;
  background: linear-gradient(
    to top,
    color-mix(in oklch, var(--color-paper) 88%, transparent) 0%,
    transparent 100%
  );
}

.lyric-line {
  font-family: var(--font-body);
  text-align: center;
  font-size: var(--text-sm);
  color: var(--color-ink-2);
  line-height: 1.6;
  transition: color var(--dur-base) var(--ease-out),
              transform var(--dur-base) var(--ease-out),
              font-size var(--dur-base) var(--ease-out);
}
.lyric-line--current {
  font-size: var(--text-lg);
  font-weight: 600;
  /* 整行 accent 高亮：不用 background-clip:text 文字渐变（长歌词换行时渐变会覆盖多行） */
  color: var(--color-accent);
}
.lyric-line--past {
  color: var(--color-ink-3);
}
@media (prefers-reduced-motion: reduce) {
  .lyric-line {
    transition-duration: 0.01ms !important;
  }
}
`;

export default function Lyrics({ lines, currentIndex }: LyricsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const safeLines = Array.isArray(lines) ? lines : [];

  // 只滚动歌词容器本身，避免 scrollIntoView 波及外层横向 swiper（否则歌词切行会把遥控屏拖回歌词屏）
  useEffect(() => {
    const container = containerRef.current;
    if (!container || currentIndex < 0) return;
    const currentEl = container.querySelector(
      `[data-lyric-index="${currentIndex}"]`,
    );
    if (!currentEl) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = currentEl.getBoundingClientRect();
    const targetTop =
      container.scrollTop +
      (elRect.top - containerRect.top) -
      (containerRect.height - elRect.height) / 2;
    container.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, [currentIndex]);

  if (safeLines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full py-xl">
        <p className="text-ink-3 text-sm">暂无歌词</p>
      </div>
    );
  }

  return (
    <>
      <style>{css}</style>
      <div className="lyric-wrap">
        <div
          ref={containerRef}
          className="lyric-scroll"
        >
          <div className="flex flex-col items-center" style={{ gap: 'var(--space-md)' }}>
            {safeLines.map((line, i) => {
              const isCurrent = i === currentIndex;
              const isPast = i < currentIndex;

              return (
                <p
                  key={i}
                  data-lyric-index={i}
                  className={`lyric-line${isCurrent ? ' lyric-line--current' : ''}${isPast ? ' lyric-line--past' : ''}`}
                >
                  {line.text || '…'}
                </p>
              );
            })}
          </div>
        </div>
        <div className="lyric-fade lyric-fade--top" aria-hidden="true" />
        <div className="lyric-fade lyric-fade--bottom" aria-hidden="true" />
      </div>
    </>
  );
}
