import { exists, readTextFile, writeTextFile, mkdir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { isTauri } from '@tauri-apps/api/core';

const CONFIG_FILE = 'backend-config.json';
const CONFIG_STORAGE_KEY = 'nasktv:backend-config';

// 检测当前是否运行在 Tauri 外壳内
function isTauriEnvironment(): boolean {
  return isTauri();
}

export interface BackendConfig {
  apiUrl: string;
  wsUrl: string;
}

function deriveWsUrl(apiUrl: string): string {
  return apiUrl.replace(/^http/, 'ws').replace(/\/+$/, '');
}

/**
 * 读取后端配置。优先级：
 * - Tauri 环境：运行时持久化配置（文件 > localStorage），无则返回 null（进 Setup 页）。
 *   不回退到构建时 VITE_API_BASE_URL —— 打包的桌面/Android 应用必须经过设置页
 *   显式配置后端地址，避免开发环境变量泄漏到生产包。
 * - 浏览器环境：localStorage > 构建时 VITE_API_BASE_URL（浏览器开发 / 反代部署模式）
 * 返回 null 表示两者都无（首次使用，进入设置页）
 */
export async function loadBackendConfig(): Promise<BackendConfig | null> {
  if (isTauriEnvironment()) {
    // 1) 优先读取应用数据目录文件
    try {
      const dataDir = await appDataDir();
      const filePath = await join(dataDir, CONFIG_FILE);
      if (await exists(filePath)) {
        const raw = await readTextFile(filePath);
        const cfg = JSON.parse(raw) as BackendConfig;
        if (cfg?.apiUrl) return cfg;
      }
    } catch (e) {
      console.error('Failed to load backend config file:', e);
    }
    // 2) 回退读取 localStorage —— save 在文件写入失败时会写入此处，
    //    必须对称读取，否则「数据目录不可写」环境下保存成功却 reload 后回到 Setup 死循环
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (raw) {
        const cfg = JSON.parse(raw) as BackendConfig;
        if (cfg?.apiUrl) return cfg;
      }
    } catch (e) {
      console.error('Failed to load backend config from localStorage:', e);
    }
    // Tauri 模式：无运行时配置就返回 null，强制进 Setup 页（不回退构建时变量）
    return null;
  }

  // 浏览器环境：localStorage > 构建时 VITE_API_BASE_URL
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      const cfg = JSON.parse(raw) as BackendConfig;
      if (cfg?.apiUrl) return cfg;
    }
  } catch (e) {
    console.error('Failed to load backend config from localStorage:', e);
  }

  // 兜底：构建时配置（浏览器开发 / 反代部署模式）
  const buildTimeApi = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (buildTimeApi) {
    return { apiUrl: buildTimeApi.replace(/\/+$/, ''), wsUrl: deriveWsUrl(buildTimeApi) };
  }
  return null;
}

/**
 * 保存后端配置（Tauri 下「文件 + localStorage」双写：文件为主，localStorage 为回退/备份；
 * 仅当两者都失败时才抛出，确保权限受限环境下仍能通过 localStorage 持久化并在 reload 后读回）
 */
export async function saveBackendConfig(apiUrl: string): Promise<BackendConfig> {
  const normalized = apiUrl.trim().replace(/\/+$/, '');
  const cfg: BackendConfig = { apiUrl: normalized, wsUrl: deriveWsUrl(normalized) };

  if (isTauriEnvironment()) {
    let fileOk = false;
    try {
      const dataDir = await appDataDir();
      const filePath = await join(dataDir, CONFIG_FILE);
      await mkdir(dataDir, { recursive: true });
      await writeTextFile(filePath, JSON.stringify(cfg));
      fileOk = true;
    } catch (e) {
      console.warn('Tauri app data dir write failed, relying on localStorage:', e);
    }

    let storageOk = false;
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
      storageOk = true;
    } catch (e) {
      console.warn('localStorage write failed:', e);
    }

    // 两处都失败才视为真正失败（文件成功即返回成功，localStorage 仅作备份）
    if (!fileOk && !storageOk) {
      throw new Error('数据目录不可写且浏览器存储不可用，请检查应用权限');
    }
  } else {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  }
  return cfg;
}

/**
 * 清除保存的后端配置（设置页「重新配置」用），恢复首次使用状态。
 * Tauri 下同时清除文件与 localStorage，避免任一来源的残留配置影响重载判定。
 */
export async function resetBackendConfig(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const dataDir = await appDataDir();
      const filePath = await join(dataDir, CONFIG_FILE);
      if (await exists(filePath)) {
        await remove(filePath);
      }
    } catch (e) {
      console.error('Failed to reset backend config file:', e);
    }
    try {
      localStorage.removeItem(CONFIG_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to reset backend config in localStorage:', e);
    }
  } else {
    localStorage.removeItem(CONFIG_STORAGE_KEY);
  }
}
