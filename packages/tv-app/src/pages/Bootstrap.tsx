/* Hallmark · genre: atmospheric · macrostructure: waiting-room · design-system: design.md · designed-as-app
 * states: static (no interactive elements) · contrast: pass (≥7:1 for 10-foot UI)
 */
import { useState } from 'react';
import { useRoomStore } from '../stores/room';
import client from '../api/client';

// Logo 地址：用运行时后端地址（setApiBaseUrl 已并入 /api 后缀），
// 打包版 WebView 中相对路径会指向 tauri://localhost 导致 404
const apiBase = () => (client.defaults.baseURL || '/api').replace(/\/+$/, '');

const css = `
/* 房间码呼吸光晕（opacity/shadow 动画，reduced-motion 关闭） */
.bootstrap-glow {
  border-radius: var(--radius-2xl);
  animation: bootstrap-pulse 2.4s var(--ease-in-out) infinite;
}
@keyframes bootstrap-pulse {
  0%, 100% { box-shadow: 0 0 24px var(--color-glow); }
  50% { box-shadow: 0 0 48px var(--color-glow); }
}
@media (prefers-reduced-motion: reduce) {
  .bootstrap-glow { animation: none; }
}
`;

export default function Bootstrap() {
  const { room } = useRoomStore();
  const [logoError, setLogoError] = useState(false);

  if (!room) {
    return (
      <div className="h-screen bg-paper flex flex-col items-center justify-center gap-md overflow-hidden">
        <div className="w-12 h-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
          <span className="font-display text-xl font-bold">N</span>
        </div>
        <p className="text-ink-2 text-base shrink-0">正在注册设备...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-paper flex flex-col items-center justify-center gap-lg px-2xl overflow-hidden">
      <style>{css}</style>

      {/* 顶部 Logo + 标题 — 紧凑布局 */}
      <div className="text-center shrink-0">
        {!logoError ? (
          <img
            src={`${apiBase()}/logo`}
            alt=""
            className="w-14 h-14 rounded-xl object-cover mx-auto mb-lg"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-accent/15 text-accent flex items-center justify-center mx-auto mb-lg">
            <span className="font-display text-2xl font-bold">N</span>
          </div>
        )}
        <h1 className="font-display text-3xl text-ink mb-sm tracking-tight leading-tight">NASKTV</h1>
        <p className="text-ink-2 text-base">等待管理员授权</p>
      </div>

      {/* 房间码卡片 — 缩小内边距和字号，适配 720p */}
      <div
        className="bootstrap-glow flex flex-col items-center justify-center bg-paper-2 px-2xl py-2xl text-center shrink-0"
        style={{ boxShadow: 'var(--shadow-glow-soft)' }}
      >
        <p className="font-mono text-xs text-ink-3 tracking-[0.35em] mb-lg">
          房间码
        </p>
        <p className="font-mono text-4xl text-accent tracking-[0.25em] mb-lg">
          {room.code}
        </p>
        <p className="font-mono text-xs text-ink-3 max-w-[24ch] break-all leading-relaxed">
          {room.deviceId}
        </p>
      </div>

      <p className="text-ink-3 text-sm shrink-0">
        请管理员在后台审核并授权此设备
      </p>
    </div>
  );
}
