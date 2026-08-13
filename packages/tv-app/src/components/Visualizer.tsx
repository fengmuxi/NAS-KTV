/* Hallmark · component: visualizer · genre: atmospheric · theme: Midnight · states: default */
import { useRef, useEffect, useCallback } from 'react';

interface VisualizerProps {
  isActive?: boolean;
  analyser?: AnalyserNode | null;
}

const css = `
.visualizer-container {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  overflow: hidden;
}

.visualizer-canvas {
  width: 100%;
  height: 100%;
}
`;

// 颜色插值
function lerpColor(color1: number[], color2: number[], t: number): number[] {
  return [
    color1[0] + (color2[0] - color1[0]) * t,
    color1[1] + (color2[1] - color1[1]) * t,
    color1[2] + (color2[2] - color1[2]) * t,
  ];
}

// 品牌色解析：canvas 不支持 CSS 变量，需从 Hallmark 令牌解析为具体 RGB（源码零硬编码）
let _accentRgb: [number, number, number] | null = null;
let _accent2Rgb: [number, number, number] | null = null;

function resolveTokenRgb(varName: string, fallback: [number, number, number]): [number, number, number] {
  try {
    const el = document.createElement('div');
    el.style.color = `var(${varName})`;
    el.style.display = 'none';
    document.body.appendChild(el);
    const m = getComputedStyle(el).color.match(/\d+/g);
    document.body.removeChild(el);
    if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
  } catch {
    /* 解析失败回退 */
  }
  return fallback;
}

function getAccentRgb(): [number, number, number] {
  if (!_accentRgb) _accentRgb = resolveTokenRgb('--color-accent', [59, 130, 246]);
  return _accentRgb;
}

function getAccent2Rgb(): [number, number, number] {
  if (!_accent2Rgb) _accent2Rgb = resolveTokenRgb('--color-accent-2', [139, 92, 246]);
  return _accent2Rgb;
}

export default function Visualizer({ isActive = true, analyser }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rafRef = useRef<number>(0);
  const frameRef = useRef(0);
  const prevDataRef = useRef<number[]>([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const accentRgb = getAccentRgb();
    const accent2Rgb = getAccent2Rgb();
    const accentCss = `rgb(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]})`;

    // 获取实际显示尺寸
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // 设置 canvas 内部分辨率与显示尺寸一致
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const centerX = width / 2;
    const centerY = height / 2;

    // 圆环参数 - 根据屏幕尺寸自适应
    const minDim = Math.min(width, height);
    const ringRadius = minDim * 0.12;     // 基准圆环半径（柱子起点）
    const maxBarHeight = minDim * 0.15;   // 最大柱子高度
    const numBars = 180;
    const barWidth = (2 * Math.PI * ringRadius) / numBars * 0.8; // 柱子宽度
    const dotSize = Math.max(2, minDim * 0.003);

    // 清除画布
    ctx.clearRect(0, 0, width, height);

    let dataArray: number[] = [];

    if (analyser && dataArrayRef.current) {
      analyser.getByteFrequencyData(dataArrayRef.current);
      dataArray = Array.from(dataArrayRef.current);
    } else {
      // 无 analyser 时使用模拟数据
      frameRef.current++;
      const frame = frameRef.current;
      dataArray = Array.from({ length: 128 }, (_, i) => {
        const wave1 = Math.sin((frame + i * 8) / 12) * 80;
        const wave2 = Math.sin((frame + i * 12) / 10) * 60;
        const wave3 = Math.sin((frame + i * 5) / 18) * 40;
        return Math.floor(Math.max(0, Math.min(255, 100 + wave1 + wave2 + wave3)));
      });
    }

    // 平滑数据
    if (prevDataRef.current.length === 0) {
      prevDataRef.current = new Array(numBars).fill(0);
    }

    // 先绘制基准圆环（在所有柱子下面）
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.35)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 圆环上的小点（柱子的起点标记）
    for (let i = 0; i < numBars; i++) {
      const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
      const baseX = centerX + Math.cos(angle) * ringRadius;
      const baseY = centerY + Math.sin(angle) * ringRadius;

      ctx.beginPath();
      ctx.arc(baseX, baseY, dotSize * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.5)`;
      ctx.fill();
    }

    // 绘制从圆环向外延伸的柱子
    for (let i = 0; i < numBars; i++) {
      const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // 柱子起点（在圆环上）
      const baseX = centerX + cos * ringRadius;
      const baseY = centerY + sin * ringRadius;

      // 从频率数据中采样
      const dataIndex = Math.floor((i / numBars) * dataArray.length);
      const value = dataArray[dataIndex] / 255;

      // 平滑过渡
      const smoothValue = prevDataRef.current[i] * 0.55 + value * 0.45;
      prevDataRef.current[i] = smoothValue;

      // 柱子高度（从圆环表面向外）
      const barHeight = Math.max(0, smoothValue * maxBarHeight);

      // 柱子终点
      const tipX = baseX + cos * barHeight;
      const tipY = baseY + sin * barHeight;

      // 颜色渐变：accent（蓝）→ accent-2（紫蓝），统一品牌色
      const colorT = i / numBars;
      const color = lerpColor(accentRgb, accent2Rgb, colorT);
      const r = color[0];
      const g = color[1];
      const b = color[2];

      // 绘制柱子（间断线段：一段段带间隔的短线，从圆环向外延伸）
      const segmentLen = Math.max(2, minDim * 0.004);      // 每段长度
      const segmentGap = segmentLen * 1.6;                 // 段间空隙
      const numSegments = Math.floor(barHeight / (segmentLen + segmentGap));

      for (let s = 0; s < numSegments; s++) {
        const segStart = ringRadius + s * (segmentLen + segmentGap);
        const segEnd = segStart + segmentLen;

        const startX = centerX + cos * segStart;
        const startY = centerY + sin * segStart;
        const endX = centerX + cos * segEnd;
        const endY = centerY + sin * segEnd;

        // 越靠外透明度越高
        const alpha = 0.35 + (s / numSegments) * 0.65;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, ${alpha})`;
        ctx.lineWidth = barWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // 柱子顶端亮点
      if (barHeight > 2) {
        ctx.beginPath();
        ctx.arc(centerX + cos * (ringRadius + barHeight), centerY + sin * (ringRadius + barHeight), dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, 0.9)`;
        ctx.fill();
      }
    }

    // 绘制中心发光
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, ringRadius * 0.6);
    gradient.addColorStop(0, `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.18)`);
    gradient.addColorStop(0.6, `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.06)`);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 绘制中心流动交叉曲线动画（圆环内部）
    const flowR = ringRadius * 0.95;
    const now = performance.now() / 1000;
    const numCurves = 6;

    for (let c = 0; c < numCurves; c++) {
      const phase = (c / numCurves) * Math.PI * 2;
      const dir = c % 2 === 0 ? 1 : -1; // 一半顺转一半逆转，形成交叉
      const rotate = now * 0.25 * dir + phase * 0.5;

      ctx.beginPath();
      const pts = 120;
      for (let p = 0; p <= pts; p++) {
        const theta = (p / pts) * Math.PI * 2;
        const wave = 0.55 + 0.45 * Math.sin(3 * theta + now * 1.8 + phase);
        const r = flowR * wave;
        const x = centerX + Math.cos(theta + rotate) * r;
        const y = centerY + Math.sin(theta + rotate) * r;
        if (p === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.strokeStyle = accentCss;
      ctx.globalAlpha = Math.max(0.12, 0.5 - c * 0.05);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 中心小点
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fillStyle = accentCss;
    ctx.fill();

    rafRef.current = requestAnimationFrame(draw);
  }, [analyser]);

  useEffect(() => {
    if (analyser) {
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    }

    draw();

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [analyser, draw]);

  return (
    <>
      <style>{css}</style>
      <div className="visualizer-container">
        <canvas ref={canvasRef} className="visualizer-canvas" />
      </div>
    </>
  );
}
