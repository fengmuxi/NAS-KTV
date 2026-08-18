import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import type { Setting } from '@nasktv/shared';

const { settings } = schema;

// 配置键常量
const KEY_AUTO_SEPARATE = 'separation_auto_enable';
const KEY_AUTO_AI_PARSE = 'ai_parse_auto_enable';
const KEY_H5_BASE_URL = 'h5_base_url';
const KEY_SEPARATION_CONCURRENCY = 'separation_concurrency';
const KEY_AI_PARSE_CONCURRENCY = 'ai_parse_concurrency';
const KEY_AI_DEDUP_ENABLED = 'ai_dedup_enabled';
const KEY_SCAN_MD5_DEDUP = 'scan_md5_dedup';
const KEY_PYTORCH_PROXY = 'pytorch_proxy';
const KEY_DOWNLOADER_DEFAULT_SOURCES = 'downloader_default_sources';
const KEY_DOWNLOADER_CONCURRENCY = 'downloader_concurrency';

/**
 * 查询所有设置项
 */
export async function getAllSettings(): Promise<Setting[]> {
  return db.select().from(settings);
}

/**
 * 根据 key 查询设置项
 */
export async function getSetting(key: string): Promise<Setting | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 批量 upsert 设置项（key 存在则更新 value，否则插入）
 */
export async function updateSettings(
  items: { key: string; value: string }[]
): Promise<void> {
  for (const item of items) {
    await db
      .insert(settings)
      .values({ key: item.key, value: item.value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: item.value },
      });
  }
}

/**
 * 便捷方法：是否启用扫描后自动分离
 * 配置键 separation_auto_enable，值为 'true'/'false'，默认 false
 */
export async function getAutoSeparateEnabled(): Promise<boolean> {
  const row = await getSetting(KEY_AUTO_SEPARATE);
  return row?.value === 'true';
}

/**
 * 便捷方法：是否启用扫描后自动 AI 解析
 * 配置键 ai_parse_auto_enable，值为 'true'/'false'，默认 false
 */
export async function getAutoAiParseEnabled(): Promise<boolean> {
  const row = await getSetting(KEY_AUTO_AI_PARSE);
  return row?.value === 'true';
}

/**
 * 解析并发数环境变量（非法/未设置时返回默认值）
 */
function parseEnvConcurrency(key: string, fallback: number): number {
  const val = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

/**
 * 获取人声分离并发数
 * 优先级：settings 表 separation_concurrency > 环境变量 SEPARATION_CONCURRENCY > 默认 1
 */
export async function getSeparationConcurrency(): Promise<number> {
  const row = await getSetting(KEY_SEPARATION_CONCURRENCY);
  const val = row?.value ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(val) && val > 0
    ? val
    : parseEnvConcurrency('SEPARATION_CONCURRENCY', 1);
}

/**
 * 获取 AI 解析并发数
 * 优先级：settings 表 ai_parse_concurrency > 环境变量 AI_PARSE_CONCURRENCY > 默认 1
 */
export async function getAiParseConcurrency(): Promise<number> {
  const row = await getSetting(KEY_AI_PARSE_CONCURRENCY);
  const val = row?.value ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(val) && val > 0
    ? val
    : parseEnvConcurrency('AI_PARSE_CONCURRENCY', 1);
}

/**
 * 是否启用 AI 文件名去重（默认关闭）
 */
export async function getAiDedupEnabled(): Promise<boolean> {
  const row = await getSetting(KEY_AI_DEDUP_ENABLED);
  return row?.value === 'true';
}

/**
 * 是否启用 MD5 文件去重（默认开启）
 */
export async function getScanMd5DedupEnabled(): Promise<boolean> {
  const row = await getSetting(KEY_SCAN_MD5_DEDUP);
  return row?.value !== 'false';
}

/**
 * 获取 PyTorch 安装代理地址（settings 表 pytorch_proxy，默认空）
 */
export async function getPytorchProxy(): Promise<string> {
  const row = await getSetting(KEY_PYTORCH_PROXY);
  return row?.value ?? '';
}

/**
 * 获取下载页默认选中的音乐源（settings 表 downloader_default_sources，逗号分隔的 short key）。
 * 返回空数组表示「未配置」，由调用方回落到下载服务的可用源（默认 qq）。
 */
export async function getDownloaderDefaultSources(): Promise<string[]> {
  const row = await getSetting(KEY_DOWNLOADER_DEFAULT_SOURCES);
  if (!row?.value) return [];
  return row.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 获取下载并发数（settings 表 downloader_concurrency > 环境变量 DOWNLOAD_CONCURRENCY > 默认 2）。
 * 用于驱动下载服务的下载线程池上限。
 */
export async function getDownloaderConcurrency(): Promise<number> {
  const row = await getSetting(KEY_DOWNLOADER_CONCURRENCY);
  const val = row?.value ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(val) && val > 0
    ? val
    : parseEnvConcurrency('DOWNLOAD_CONCURRENCY', 2);
}
