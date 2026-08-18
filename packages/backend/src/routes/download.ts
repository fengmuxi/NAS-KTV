import { Router, Request, Response } from 'express';
import path from 'path';
import logger from '../logger';
import { authenticateToken } from '../middleware/jwt';
import {
  downloaderClient,
  type TaskStatus,
} from '../services/downloader-client';
import * as settingsService from '../services/settings-service';
import { scanDirectory, getScanStatus } from '../services/scanner';
import { config } from '../config';

const router = Router();

const DOWNLOAD_DIR =
  process.env.DOWNLOAD_DIR ||
  path.join(config.projectRoot, 'data', 'songs', 'Downloads');

/**
 * 下载完成后自动触发扫描入库（复用现有 scanner 的自动分离 + AI 解析）。
 * 用 pendingScan 保证：即便当下正在扫描（scanner 全局锁），也会在下次空闲时补扫。
 */
const watchedTasks = new Set<string>();
let pendingScan = false;
let watcherStarted = false;

function startWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  setInterval(async () => {
    for (const id of [...watchedTasks]) {
      try {
        const t: TaskStatus = await downloaderClient.getTask(id);
        if (t.status === 'completed') {
          watchedTasks.delete(id);
          pendingScan = true;
        } else if (t.status === 'failed' || t.status === 'cancelled') {
          watchedTasks.delete(id);
        }
      } catch {
        // 任务查询失败（服务抖动）忽略，下个周期再试
      }
    }
    if (pendingScan && !getScanStatus().isScanning) {
      pendingScan = false;
      scanDirectory(DOWNLOAD_DIR, { scanId: `scan_dl_${Date.now()}` }).catch((e) =>
        logger.error('auto-scan after download failed:', e),
      );
    }
  }, 5000);
}

/**
 * GET /api/download/platforms - 可用平台列表
 */
router.get('/platforms', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const platforms = await downloaderClient.getPlatforms();
    res.json({ success: true, data: platforms });
  } catch (error) {
    logger.error('download platforms error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

/**
 * POST /api/download/search - 提交异步搜索，立即返回 { search_id, status:'pending' }
 */
router.post('/search', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { keyword, sources } = req.body as { keyword?: string; sources?: string[] };
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ success: false, error: 'keyword required' });
    }
    const data = await downloaderClient.submitSearch(keyword.trim(), sources);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('download search submit error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

/**
 * GET /api/download/search/:id - 轮询搜索结果（pending/done/failed + results）
 */
router.get('/search/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const data = await downloaderClient.getSearch(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('download search result error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

/**
 * POST /api/download - 按 key 批量提交下载任务
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { keys } = req.body as { keys?: string[] };
    if (!keys || !keys.length) {
      return res.status(400).json({ success: false, error: 'keys required' });
    }
    const data = await downloaderClient.submit(keys);
    for (const id of data.task_ids) watchedTasks.add(id);
    startWatcher();
    res.json({ success: true, data });
  } catch (error) {
    logger.error('download submit error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

/**
 * GET /api/download/tasks?ids=a,b,c - 批量查询任务状态（前端轮询）
 */
router.get('/tasks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const ids = ((req.query.ids as string) || '').split(',').filter(Boolean);
    const tasks = await Promise.all(
      ids.map((id) =>
        downloaderClient
          .getTask(id)
          .then((t) => ({ ...t, ok: true }))
          .catch(() => ({ task_id: id, status: 'unknown', ok: false })),
      ),
    );
    res.json({ success: true, data: tasks });
  } catch (error) {
    logger.error('download tasks error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

/**
 * GET /api/download/config - 下载配置（平台列表 + 默认选中源 + 并发数）
 * 默认选中源未配置时回落到 qq（与下载页默认行为一致），并过滤掉不可用平台。
 */
router.get('/config', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const [platforms, storedSources, concurrency] = await Promise.all([
      downloaderClient.getPlatforms(),
      settingsService.getDownloaderDefaultSources(),
      settingsService.getDownloaderConcurrency(),
    ]);
    const availableKeys = new Set(
      platforms.filter((p) => p.enabled).map((p) => p.key),
    );
    let defaultSources: string[];
    if (storedSources.length > 0) {
      defaultSources = storedSources.filter((k) => availableKeys.has(k));
    } else {
      defaultSources = availableKeys.has('qq')
        ? ['qq']
        : platforms.find((p) => p.enabled)?.key
          ? [platforms.find((p) => p.enabled)!.key]
          : [];
    }
    res.json({
      success: true,
      data: { platforms, defaultSources, concurrency },
    });
  } catch (error) {
    logger.error('download config error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

/**
 * GET /api/download/:id - 单个任务状态
 */
router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const task = await downloaderClient.getTask(req.params.id);
    res.json({ success: true, data: task });
  } catch (error) {
    logger.error('download task error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

/**
 * POST /api/download/:id/cancel - 取消任务
 */
router.post('/:id/cancel', authenticateToken, async (req: Request, res: Response) => {
  try {
    const data = await downloaderClient.cancel(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('download cancel error:', error);
    res.status(502).json({ success: false, error: '下载服务不可用' });
  }
});

export default router;
