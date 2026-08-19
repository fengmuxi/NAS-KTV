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
  const rotationRef = useRef(0);        // 整体旋转（0~1 顺转），用于频谱柱随时间慢转
  const lastFrameTimeRef = useRef(0);   // 上一帧时间戳（计算 dt）

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const accentRgb = getAccentRgb();
    const accent2Rgb = getAccent2Rgb();

    // 同步 canvas 分辨率与显示尺寸
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const centerX = width / 2;
    const centerY = height / 2;
    const minDim = Math.min(width, height);

    // 自适应参数（更稀疏、更克制）
    const ringRadius = minDim * 0.18;
    const maxBarHeight = minDim * 0.22;
    const numBars = 60;            // 圆周上均匀分布的频谱柱数（满圈闭合）
    const barWidth = Math.max(2, minDim * 0.005);
    const tipDotR = Math.max(1.5, minDim * 0.003);
    const rotation = rotationRef.current;

    ctx.clearRect(0, 0, width, height);

    // 获取频率数据
    let dataArray: number[] = [];
    if (analyser && dataArrayRef.current) {
      analyser.getByteFrequencyData(dataArrayRef.current);
      dataArray = Array.from(dataArrayRef.current);
    } else {
      frameRef.current++;
      const frame = frameRef.current;
      dataArray = Array.from({ length: 64 }, (_, i) => {
        const wave = Math.sin((frame + i * 6) / 14) * 0.5 + 0.5;
        return Math.floor(40 + wave * 215);
      });
    }

    // 平滑 prevData
    if (prevDataRef.current.length !== numBars) {
      prevDataRef.current = new Array(numBars).fill(0);
    }

    // 基准圆环（细，淡）
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, 0.15)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 频谱柱：实线光带（带渐变透明度），随整体旋转，均匀分布成完整圆周
    // 采样时跳过首尾低频/高频段（这两段频响变化小、柱子几乎不动），视觉更聚焦中频
    const skipFreqFrac = 0.12;
    const freqStart = Math.floor(dataArray.length * skipFreqFrac);
    const freqSpan = Math.max(1, Math.floor(dataArray.length * (1 - 2 * skipFreqFrac)));
    const rotationOffset = rotation * Math.PI * 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < numBars; i++) {
      const angle = rotationOffset + (i / numBars) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const dataIndex = Math.floor(freqStart + (i / numBars) * freqSpan);
      const value = dataArray[dataIndex] / 255;
      const smoothValue = prevDataRef.current[i] * 0.55 + value * 0.45;
      prevDataRef.current[i] = smoothValue;

      const barLen = Math.max(2, smoothValue * maxBarHeight);

      const baseX = centerX + cos * ringRadius;
      const baseY = centerY + sin * ringRadius;
      const tipX = centerX + cos * (ringRadius + barLen);
      const tipY = centerY + sin * (ringRadius + barLen);

      // 颜色：accent → accent-2 按角度渐变
      const t = i / numBars;
      const c = lerpColor(accentRgb, accent2Rgb, t);
      const r = Math.floor(c[0]);
      const g = Math.floor(c[1]);
      const b = Math.floor(c[2]);

      // 线段渐变：从基部较亮到末端淡出
      const grad = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.75)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.05)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = barWidth;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // 末端亮点（仅在柱子足够长时）
      if (barLen > 6) {
        ctx.beginPath();
        ctx.arc(tipX, tipY, tipDotR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.fill();
      }
    }

    // 中心发光核（径向渐变填充圆）
    const coreR = ringRadius * 0.45;
    const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreR);
    coreGrad.addColorStop(0, `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},0.4)`);
    coreGrad.addColorStop(0.55, `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},0.12)`);
    coreGrad.addColorStop(1, `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},0)`);
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, coreR, 0, Math.PI * 2);
    ctx.fill();

    // 中心流动曲线：更少（3 条）+ 更淡
    const flowR = ringRadius * 0.7;
    const now = performance.now() / 1000;
    const numCurves = 3;
    for (let c = 0; c < numCurves; c++) {
      const phase = (c / numCurves) * Math.PI * 2;
      const dir = c % 2 === 0 ? 1 : -1;
      const rotate = now * 0.2 * dir + phase;
      ctx.beginPath();
      const pts = 100;
      for (let p = 0; p <= pts; p++) {
        const theta = (p / pts) * Math.PI * 2;
        const wave = 0.6 + 0.4 * Math.sin(3 * theta + now * 1.5 + phase);
        const r = flowR * wave;
        const x = centerX + Math.cos(theta + rotate) * r;
        const y = centerY + Math.sin(theta + rotate) * r;
        if (p === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},0.28)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 中心小圆点
    ctx.beginPath();
    ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},0.9)`;
    ctx.fill();

    // 整体慢速顺转（约每 20s 转一圈）
    const nowMs = performance.now();
    if (lastFrameTimeRef.current) {
      const dt = (nowMs - lastFrameTimeRef.current) / 1000;
      rotationRef.current = (rotationRef.current + dt * 0.05) % 1;
    }
    lastFrameTimeRef.current = nowMs;

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