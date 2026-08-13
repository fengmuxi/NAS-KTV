/* Hallmark · component: drawer · genre: atmospheric · theme: Midnight · states: 8 */
import { useId } from 'react';
import { X } from 'lucide-react';
import PitchSlider from './PitchSlider';
import ReverbPanel, { type ReverbPreset } from './ReverbPanel';

interface AdvancedControlsPanelProps {
  open: boolean;
  onClose: () => void;
  pitch: number;
  reverbWet: number;
  reverbPreset: ReverbPreset;
  vocalAssistVolume: number;
  onPitchChange: (v: number) => void;
  onReverbWetChange: (v: number) => void;
  onReverbPresetChange: (p: ReverbPreset) => void;
  onVocalAssistVolumeChange: (v: number) => void;
}

export default function AdvancedControlsPanel({
  open,
  onClose,
  pitch,
  reverbWet,
  reverbPreset,
  vocalAssistVolume,
  onPitchChange,
  onReverbWetChange,
  onReverbPresetChange,
  onVocalAssistVolumeChange,
}: AdvancedControlsPanelProps) {
  const vocalSliderId = useId();
  const vocalPercentage = vocalAssistVolume * 100;

  return (
    <>
      {/* 背景半透明遮罩：点击触发 onClose */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 bg-[rgba(0,0,0,0.5)] transition-opacity ease-out duration-base motion-reduce:transition-none ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* 右侧抽屉 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="高级控制"
        aria-hidden={!open}
        className={`fixed right-0 top-0 h-full w-96 bg-paper-2 border-l border-border shadow-lg transition-transform ease-out duration-base motion-reduce:transition-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full p-xl overflow-y-auto">
          {/* 顶部：标题 + 关闭按钮 */}
          <div className="flex items-center justify-between mb-2xl">
            <h2 className="font-display text-xl text-ink">高级控制</h2>
            <button
              type="button"
              onClick={onClose}
              data-focusable
              data-focus-id="advanced-close"
              tabIndex={0}
              aria-label="关闭高级控制"
              className="w-12 h-12 rounded-md bg-paper-3 text-ink flex items-center justify-center hover:bg-paper active:scale-[0.98] transition-colors"
            >
              <X size={24} />
            </button>
          </div>

          {/* 内容区：纵向排列 */}
          <div className="flex flex-col gap-2xl">
            {/* 音调 */}
            <PitchSlider value={pitch} onChange={onPitchChange} />

            {/* 混响 */}
            <ReverbPanel
              preset={reverbPreset}
              wet={reverbWet}
              onPresetChange={onReverbPresetChange}
              onWetChange={onReverbWetChange}
            />

            {/* 人声辅助音量滑块（0~1）*/}
            <div className="flex flex-col gap-md">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={vocalSliderId}
                  className="font-display text-base text-ink-2"
                >
                  人声辅助音量
                </label>
                <span className="font-mono text-base text-accent tabular-nums">
                  {Math.round(vocalPercentage)}%
                </span>
              </div>

              <div className="relative h-10 flex items-center">
                {/* 轨道 */}
                <div className="absolute inset-x-0 h-2 bg-paper-3 rounded-full" />

                {/* 填充 */}
                <div
                  className="absolute h-2 rounded-full bg-accent"
                  style={{ width: `${vocalPercentage}%` }}
                />

                {/* 滑块手柄 */}
                <div
                  aria-hidden="true"
                  className="absolute w-7 h-7 rounded-full bg-accent border-2 border-paper shadow-md -translate-x-1/2 pointer-events-none"
                  style={{ left: `${vocalPercentage}%` }}
                />

                {/* 原生 input 覆盖层 */}
                <input
                  id={vocalSliderId}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={vocalAssistVolume}
                  onChange={(e) => onVocalAssistVolumeChange(Number(e.target.value))}
                  data-focusable
                  data-focus-id="vocal-volume"
                  role="slider"
                  aria-valuemin={0}
                  aria-valuemax={1}
                  aria-valuenow={vocalAssistVolume}
                  aria-label="人声辅助音量"
                  tabIndex={0}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
