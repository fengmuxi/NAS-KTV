import { useEffect, useRef, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { useRoomStore } from './stores/room';
import {
  getDeviceId,
  clearDeviceId,
  getStoredRoomCode,
  setStoredRoomCode,
} from './lib/device';
import { roomsApi } from './api/rooms';
import client, { setApiBaseUrl } from './api/client';
import { loadBackendConfig } from './lib/backend-config';
import { useConfigStore } from './stores/config';
import { useRoomSync } from './hooks/useRoomSync';
import ExpiringBanner from './components/ExpiringBanner';
import ConnectionBanner from './components/ConnectionBanner';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function App() {
  const { setRoom, room } = useRoomStore();
  const { setConfig, setUnconfigured } = useConfigStore();

  // 启动错误状态：bootstrap 失败时展示错误信息和重试按钮
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  // 重试触发器：点击重试时 +1，触发 useEffect 重新执行
  const [retryKey, setRetryKey] = useState(0);

  // 授权码轮换标记（sessionStorage）：页面刷新（F5/reload）时保留，WebView
  // 进程重启时清空——借此区分「刷新」与「启动」：只有 App 启动才轮换授权码，
  // 刷新页面不换码，避免正在使用的手机全部掉线。
  const ROTATE_FLAG_KEY = 'nasktv-code-rotated';

  // 监听房间 WebSocket 消息，同步队列/当前项到 store
  useRoomSync();

  // 启动时无条件拉起 UDP 发现 + 手机配置 HTTP 服务（Tauri 环境，幂等）。
  // 之前只在 Setup 页 / BackendConfigOverlay 里启动，导致已配置的 app 启动时
  // 这两个服务从未运行——手机扫码后配置页拉取 /servers 拿到空列表，无法发现局域网设备。
  // 现在在 App 根组件启动时就拉起，确保 TV 一直在监听广播、随时可被手机连接配置。
  useEffect(() => {
    if (!IS_TAURI) return;
    invoke('start_discovery').catch(() => {});
    invoke('start_config_server').catch(() => {});
  }, []);

  // 防重入锁：避免同一次 effect 内并发 bootstrap（如快速重渲染）。
  // 注意：在 cleanup 中重置，确保 StrictMode 第二次 effect 能正常执行。
  const bootstrappingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // 防重入：如果已有 bootstrap 在进行中，直接返回
      if (bootstrappingRef.current) {
        return;
      }
      bootstrappingRef.current = true;
      setBootstrapError(null);

      try {
        // 0. 加载后端配置
        console.log('[bootstrap] loading config...');
        const config = await loadBackendConfig();
        if (cancelled) return;
        console.log('[bootstrap] config:', config);
        if (!config) {
          setUnconfigured();
          return;
        }
        setApiBaseUrl(config.apiUrl);
        setConfig(config);

        // 0.5 健康检查：确认后端可达
        console.log('[bootstrap] health check...');
        try {
          const resp = await client.get('/health');
          console.log('[bootstrap] health ok:', resp.data);
        } catch (e: any) {
          const msg = e?.response?.status
            ? `后端返回 ${e.response.status}`
            : e?.message || '无法连接';
          throw new Error(`后端不可达：${msg}（${config.apiUrl}）`);
        }

        if (cancelled) return;

        // 1. 验证本地缓存的 roomCode 是否仍存在（处理设备被管理员删除的情况）
        const storedCode = getStoredRoomCode();
        console.log('[bootstrap] storedCode:', storedCode);
        if (storedCode) {
          try {
            await roomsApi.getRoom(storedCode);
          } catch (e: any) {
            if (e?.response?.status === 404) {
              await clearDeviceId();
            }
          }
        }

        if (cancelled) return;

        // 2. 注册设备
        console.log('[bootstrap] getting deviceId...');
        const deviceId = await getDeviceId();
        console.log('[bootstrap] deviceId:', deviceId);
        console.log('[bootstrap] registering device...');
        let roomData = await roomsApi.registerDevice({
          deviceId,
          name: 'Android TV',
          deviceInfo: navigator.userAgent,
        });
        console.log('[bootstrap] roomData:', roomData);

        // 3. 授权码启动一次重新生成一次
        if (!sessionStorage.getItem(ROTATE_FLAG_KEY)) {
          try {
            roomData = await roomsApi.rotateCode(roomData.id, deviceId);
            sessionStorage.setItem(ROTATE_FLAG_KEY, '1');
          } catch (e) {
            console.warn('[bootstrap] Rotate room code failed:', e);
          }
        }

        // 4. 写入 store
        console.log('[bootstrap] setting room, code:', roomData.code);
        if (!cancelled) {
          setRoom(roomData);
          setStoredRoomCode(roomData.code);
        }
        console.log('[bootstrap] done');
      } catch (e: any) {
        console.error('[bootstrap] FAILED:', e);
        if (!cancelled) {
          setBootstrapError(e?.message || String(e));
        }
      } finally {
        bootstrappingRef.current = false;
      }
    }

    if (!room) {
      bootstrap();
    }

    return () => {
      cancelled = true;
      bootstrappingRef.current = false;
    };
  }, [room, setRoom, setConfig, setUnconfigured, retryKey]);

  // bootstrap 失败时展示错误页面
  if (!room && bootstrapError) {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center gap-lg px-2xl">
        <AlertCircle className="w-12 h-12 text-danger" />
        <p className="text-ink text-lg text-center">{bootstrapError}</p>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="flex items-center gap-sm px-2xl py-lg bg-accent text-paper rounded-xl text-lg hover:opacity-90"
        >
          <RefreshCw className="w-5 h-5" />
          重试
        </button>
      </div>
    );
  }

  return (
    <>
      <ConnectionBanner />
      <ExpiringBanner />
      <RouterProvider router={router} />
    </>
  );
}

export default App;
