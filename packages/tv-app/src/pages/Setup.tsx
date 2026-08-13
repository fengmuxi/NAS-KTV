/* Hallmark · genre: atmospheric · macrostructure: settings · design-system: design.md · designed-as-app */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Smartphone, AlertCircle, RefreshCw, CheckCircle2, Keyboard, Wifi } from 'lucide-react';
import QRCode from 'qrcode';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { resetBackendConfig, saveBackendConfig } from '../lib/backend-config';
import { useConfigStore } from '../stores/config';

// 浏览器环境检测（Tauri 2 的 invoke 存在于 window.__TAURI_INTERNALS__）
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// 验证后端地址：GET /api/health 返回 success 即可
async function verifyBackend(apiUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${apiUrl}/api/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.success !== false;
  } catch {
    return false;
  }
}

const css = `
/* 二维码卡片光晕（focus 时高亮） */
.setup-qr-wrap {
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-glow-soft);
  transition: box-shadow 200ms var(--ease-out);
}
.setup-qr-wrap:focus-visible {
  box-shadow: 0 0 0 2px var(--color-accent), var(--shadow-glow-soft);
}
/* 发现的服务器项 hover 高亮 */
.server-item {
  transition: background-color 150ms var(--ease-out);
}
.server-item:hover {
  background-color: rgba(15,23,31,0.8);
}
`;

interface DiscoveredServer {
  name: string;
  apiUrl: string;
  wsUrl: string;
}

export default function Setup() {
  const { configured, apiUrl, setConfig, setUnconfigured } = useConfigStore();
  const [qrUrl, setQrUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [qrState, setQrState] = useState<'ready' | 'received' | 'error'>('ready');
  const [error, setError] = useState('');

  // 自动扫描发现的后端列表
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [scanning, setScanning] = useState(true);
  const [selectingUrl, setSelectingUrl] = useState<string | null>(null);

  // 手动配置（浏览器调试 / 无扫码环境可用）
  const [manualUrl, setManualUrl] = useState('');
  const [manualStatus, setManualStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const [manualError, setManualError] = useState('');

  // 已完成配置标记（reload 前避免重复保存）
  const doneRef = useRef(false);
  // 轮询 timer 引用
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 将任意 CSS 颜色值转为 hex（兼容 OKLCH/RGB/HSL 等现代格式）
  // 注意：旧 Android WebView 的 Canvas 不支持 OKLCH 等现代颜色语法，
  // fillStyle 赋值会静默失败（不抛错但 getImageData 返回初始透明黑 0,0,0,0）。
  // 因此失败时返回空字符串，让调用方的 || fallback 生效。
  function cssColorToHex(cssColor: string): string {
    if (!cssColor || cssColor.startsWith('#')) return cssColor || '';
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      // alpha=0 或 r=g=b=0 说明颜色未被正确解析（Canvas 不支持该格式）
      if (a === 0 || (r === 0 && g === 0 && b === 0)) return '';
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch {
      return '';
    }
  }

  // 生成手机扫码二维码
  const genQr = useCallback(async () => {
    setQrUrl('');
    setQrError('');
    if (!IS_TAURI) {
      setQrError('浏览器环境不支持此功能，请使用 tauri dev 或 Android APK 运行');
      return;
    }
    try {
      const ips = (await invoke('get_local_ips')) as unknown;
      if (!Array.isArray(ips) || ips.length === 0) {
        setQrError('无法获取本机 IP，请检查网络连接');
        return;
      }
      const url = `http://${ips[0]}:45678/p`;
      const cs = getComputedStyle(document.documentElement);
      const qrDark = cssColorToHex(cs.getPropertyValue('--color-paper').trim()) || '#0a0d16';
      const qrLight = cssColorToHex(cs.getPropertyValue('--color-ink').trim()) || '#ffffff';
      const dataUrl = await QRCode.toDataURL(url, {
        width: 420,
        margin: 1,
        color: { dark: qrDark, light: qrLight },
      });
      setQrUrl(dataUrl);
    } catch (e) {
      console.error('genQr failed:', e);
      setQrError('二维码生成失败，请重试');
    }
  }, []);

  // 重试：重新启动配置服务 + 重新生成二维码
  const retryQr = useCallback(async () => {
    if (!IS_TAURI) return;
    invoke('start_config_server').catch(() => {});
    await genQr();
  }, [genQr]);

  // 保存配置并重启 App 流程 → 进入 Bootstrap 授权等待页
  const finishConfigure = useCallback(
    async (url: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      try {
        const cfg = await saveBackendConfig(url);
        setConfig(cfg);
        window.location.reload();
      } catch (e) {
        console.error('Failed to save backend config:', e);
        doneRef.current = false;
        const details = e instanceof Error ? e.message : String(e);
        setError(`配置保存失败：${details || '未知错误'}，请检查磁盘权限后重试`);
      }
    },
    [setConfig],
  );

  // 选择发现的后端 → 保存配置 → 进入授权等待页（Bootstrap）
  const selectServer = useCallback(
    async (server: DiscoveredServer) => {
      if (doneRef.current || selectingUrl === server.apiUrl) return;
      setSelectingUrl(server.apiUrl);
      setError('');
      const ok = await verifyBackend(server.apiUrl);
      if (doneRef.current) return;
      if (ok) {
        await finishConfigure(server.apiUrl);
      } else {
        setSelectingUrl(null);
        setError('该后端地址无法访问，请确认后端服务已启动');
      }
    },
    [finishConfigure, selectingUrl],
  );

  // 启动 UDP 发现 + 轮询已发现服务器
  useEffect(() => {
    if (!IS_TAURI) {
      setScanning(false);
      return;
    }

    invoke('start_discovery').catch(() => {});

    // 立即查询一次
    invoke('get_discovered_servers')
      .then((list) => {
        setServers((list as DiscoveredServer[]) || []);
        setScanning(false);
      })
      .catch(() => setScanning(false));

    // 每 3 秒轮询刷新
    pollRef.current = setInterval(async () => {
      try {
        const list = (await invoke('get_discovered_servers')) as DiscoveredServer[];
        setServers(list || []);
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // 启动扫码配置服务 + 生成二维码
  useEffect(() => {
    if (IS_TAURI) {
      invoke('start_config_server').catch(() => {});
    }
    genQr();
  }, [genQr]);

  // 监听手机扫码回填的后端地址（Tauri 事件）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await listen<string>('nasktv:config-received', async (event) => {
          if (cancelled || doneRef.current) return;
          const url = event.payload;
          setQrState('received');
          setError('');
          const ok = await verifyBackend(url);
          if (cancelled) return;
          if (ok) {
            await finishConfigure(url);
          } else {
            setQrState('error');
            setError('该地址无法访问，请确认后端服务已启动后重试');
          }
        });
      } catch {
        // 非 Tauri 环境无事件通道，忽略
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [finishConfigure]);

  // 重新配置：清除保存的配置并重启
  const reconfig = useCallback(async () => {
    await resetBackendConfig();
    setUnconfigured();
    window.location.reload();
  }, [setUnconfigured]);

  // 手动配置提交
  const submitManual = useCallback(async () => {
    if (doneRef.current) return;
    const url = manualUrl.trim().replace(/\/+$/, '');
    if (!url) return;
    setManualStatus('verifying');
    setManualError('');
    const ok = await verifyBackend(url);
    if (doneRef.current) return;
    if (ok) {
      setManualStatus('success');
      await finishConfigure(url);
    } else {
      setManualStatus('error');
      setManualError('无法连接该地址，请确认后端服务已启动且地址正确');
    }
  }, [manualUrl, finishConfigure]);

  return (
    <div className="h-screen overflow-hidden bg-paper flex flex-col">
      <style>{css}</style>
      <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full px-2xl py-xl min-h-0">
        <header className="mb-xl shrink-0">
          <h1 className="font-display text-2xl text-ink mb-md tracking-tight leading-tight">
            {configured ? '后端设置' : '连接 NASKTV'}
          </h1>
          <p className="text-ink-3 text-base leading-relaxed">
            {configured
              ? '当前后端服务不可用时，可重新配置。'
              : '自动扫描局域网中的 NASKTV 后端，或用手机扫码 / 手动输入地址。'}
          </p>
        </header>

        {configured && apiUrl && (
          <div className="flex items-center justify-between gap-lg mb-lg px-lg py-sm bg-paper-2 border border-border rounded-2xl shrink-0">
            <span className="flex items-center gap-md text-ink text-sm min-w-0">
              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              <span className="font-mono truncate">{apiUrl}</span>
            </span>
            <button
              className="flex items-center gap-sm text-danger text-sm underline underline-offset-4 shrink-0"
              tabIndex={0}
              role="button"
              onClick={reconfig}
            >
              <RefreshCw className="w-4 h-4" />
              重新配置
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-center gap-md mb-lg px-lg py-sm bg-paper-2 border border-danger/30 rounded-2xl text-danger shrink-0"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 三栏布局：自动扫描 | 手动配置 | 手机扫码 */}
        <div className="grid grid-cols-3 gap-lg flex-1 min-h-0 items-start">
          {/* 自动扫描 */}
          <section
            className="bg-paper-2 border border-border rounded-2xl p-xl flex flex-col gap-md overflow-hidden min-w-0"
            aria-label="自动扫描"
          >
            <h2 className="text-lg font-semibold text-ink flex items-center gap-md shrink-0 flex-wrap leading-snug">
              <span className="w-8 h-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                <Wifi className="w-5 h-5" />
              </span>
              <span className="min-w-0">自动扫描</span>
            </h2>

            {scanning ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-md min-h-0">
                <Loader2 className="w-8 h-8 text-accent animate-spin" />
                <p className="text-ink-3 text-sm text-center">正在扫描局域网...</p>
              </div>
            ) : servers.length > 0 ? (
              <div className="flex flex-col gap-sm flex-1 min-h-0 overflow-auto">
                <p className="text-ink-3 text-xs shrink-0">
                  发现 {servers.length} 个后端服务：
                </p>
                {servers.map((s) => (
                  <button
                    key={s.apiUrl}
                    onClick={() => selectServer(s)}
                    disabled={!!selectingUrl || doneRef.current}
                    tabIndex={0}
                    role="button"
                    className={`server-item w-full text-left px-lg py-md rounded-xl border transition-colors shrink-0 disabled:opacity-50 ${
                      selectingUrl === s.apiUrl
                        ? 'border-accent bg-accent/5 text-accent'
                        : 'border-border bg-paper text-ink hover:border-accent/40 focus-visible:ring-2 focus-visible:ring-accent'
                    }`}
                  >
                    <p className="font-medium text-sm truncate">{s.name || 'NASKTV 后端'}</p>
                    <p className="font-mono text-xs text-ink-3 mt-xs truncate">{s.apiUrl}</p>
                    {selectingUrl === s.apiUrl && (
                      <span className="flex items-center gap-sm text-xs text-accent mt-xs">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        正在连接...
                      </span>
                    )}
                  </button>
                ))}
                <p className="text-ink-3 text-xs shrink-0 pt-sm">
                  选择后将进入授权等待页，需管理员确认
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-md min-h-0">
                <Wifi className="w-8 h-8 text-ink-2" />
                <p className="text-ink-3 text-sm text-center">未发现后端服务</p>
                <p className="text-ink-3 text-xs text-center">请确保后端已在同一局域网启动</p>
              </div>
            )}
          </section>

          {/* 手动配置 */}
          <section
            className="bg-paper-2 border border-border rounded-2xl p-xl flex flex-col gap-md overflow-hidden min-w-0"
            aria-label="手动配置"
          >
            <h2 className="text-lg font-semibold text-ink flex items-center gap-md shrink-0 flex-wrap leading-snug">
              <span className="w-8 h-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                <Keyboard className="w-5 h-5" />
              </span>
              <span className="min-w-0">手动配置</span>
            </h2>

            <p className="text-ink-3 text-[11px] leading-snug shrink-0 break-words">
              浏览器调试或无法扫码时，直接输入后端地址（如
              <span className="font-mono text-ink-2 break-all"> http://192.168.1.100:8080</span>）。
            </p>

            <div className="flex flex-col gap-sm shrink-0">
              <input
                type="text"
                value={manualUrl}
                onChange={(e) => {
                  setManualUrl(e.target.value);
                  if (manualStatus !== 'idle') setManualStatus('idle');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitManual();
                }}
                placeholder="http://host:port"
                aria-label="后端服务地址"
                tabIndex={0}
                disabled={manualStatus === 'verifying'}
                className="w-full px-lg py-sm bg-paper border border-border rounded-2xl text-ink font-mono text-sm placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              />
              <button
                onClick={submitManual}
                disabled={!manualUrl.trim() || manualStatus === 'verifying' || doneRef.current}
                tabIndex={0}
                role="button"
                className="self-start flex items-center gap-md px-lg py-sm bg-accent text-on-accent rounded-2xl text-sm font-medium disabled:opacity-50"
              >
                {manualStatus === 'verifying' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {manualStatus === 'verifying' ? '连接中...' : '连接'}
              </button>
            </div>

            <div className="text-xs shrink-0 min-h-[1.25rem]">
              {manualStatus === 'error' && (
                <span className="flex items-center gap-md text-danger">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {manualError}
                </span>
              )}
              {manualStatus === 'success' && (
                <span className="flex items-center gap-md text-success">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  验证通过，正在进入...
                </span>
              )}
            </div>
          </section>

          {/* 手机扫码 */}
          <section
            className="bg-paper-2 border border-border rounded-2xl p-xl flex flex-col items-center gap-md overflow-hidden min-w-0"
            aria-label="手机扫码配置"
          >
            <h2 className="text-lg font-semibold text-ink flex items-center gap-md self-start shrink-0 flex-wrap w-full leading-snug">
              <span className="w-8 h-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                <Smartphone className="w-5 h-5" />
              </span>
              <span className="min-w-0">手机扫码</span>
            </h2>

            <div
              className="setup-qr-wrap bg-paper rounded-2xl p-md flex-1 flex items-center justify-center min-h-0 max-h-[45vh] w-full"
              tabIndex={0}
              role="img"
              aria-label="手机扫码配置二维码"
            >
              {qrUrl ? (
                <img src={qrUrl} alt="配置二维码" className="max-w-full max-h-full object-contain" />
              ) : qrError ? (
                <div className="flex flex-col items-center justify-center gap-md text-center px-lg">
                  <AlertCircle className="w-7 h-7 text-danger" />
                  <p className="text-danger text-xs">{qrError}</p>
                  <button
                    className="flex items-center gap-sm text-accent text-xs underline underline-offset-4"
                    tabIndex={0}
                    role="button"
                    onClick={retryQr}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重试
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center">
                  <Loader2 className="w-7 h-7 text-ink-2 animate-spin" />
                </div>
              )}
            </div>

            <div className="text-center text-ink-3 text-xs leading-relaxed shrink-0 min-h-[1.75rem] break-words">
              {qrState === 'ready' && (
                <>扫二维码后在手机页面输入后端地址</>
              )}
              {qrState === 'received' && (
                <span className="flex items-center justify-center gap-md text-ink">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  已收到配置，正在验证...
                </span>
              )}
              {qrState === 'error' && (
                <span className="text-danger">验证失败，请在手机上重试</span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
