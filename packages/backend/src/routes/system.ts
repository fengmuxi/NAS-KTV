import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import logger from '../logger';
import { config } from '../config';
import { authenticateToken } from '../middleware/jwt';
import { db, schema } from '../db';
import { sql, gte, eq, desc } from 'drizzle-orm';
import { separatorClient } from '../services/separator-client';

const router = Router();

/**
 * GET /system/stats - 系统基础统计（兼容旧接口）
 */
router.get('/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const totalSongs =
      db.select({ count: sql<number>`count(*)` }).from(schema.songs).get()?.count ?? 0;
    const totalArtists =
      db.select({ count: sql<number>`count(*)` }).from(schema.artists).get()?.count ?? 0;
    const totalRooms =
      db.select({ count: sql<number>`count(*)` }).from(schema.rooms).get()?.count ?? 0;
    const activeRooms =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.rooms)
        .where(eq(schema.rooms.status, 'active'))
        .get()?.count ?? 0;
    const totalPlayCount =
      db
        .select({ sum: sql<number>`coalesce(sum(${schema.songs.playCount}), 0)` })
        .from(schema.songs)
        .get()?.sum ?? 0;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayPlayCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.playHistory)
        .where(gte(schema.playHistory.playedAt, startOfDay))
        .get()?.count ?? 0;

    const pendingSeparation =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.separationTasks)
        .where(eq(schema.separationTasks.status, 'pending'))
        .get()?.count ?? 0;

    const pendingAiParse =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.aiParseTasks)
        .where(eq(schema.aiParseTasks.status, 'pending'))
        .get()?.count ?? 0;

    res.json({
      success: true,
      data: {
        totalSongs,
        totalArtists,
        totalRooms,
        activeRooms,
        totalPlayCount,
        todayPlayCount,
        pendingSeparation,
        pendingAiParse,
      },
    });
  } catch (error) {
    logger.error('Error getting system stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get system stats' });
  }
});

/**
 * GET /system/dashboard - 仪表盘聚合统计
 * 返回歌曲元信息、分离任务、AI 解析任务、播放数据等结构化统计
 */
router.get('/dashboard', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const totalSongs =
      db.select({ count: sql<number>`count(*)` }).from(schema.songs).get()?.count ?? 0;
    const totalArtists =
      db.select({ count: sql<number>`count(*)` }).from(schema.artists).get()?.count ?? 0;
    const totalRooms =
      db.select({ count: sql<number>`count(*)` }).from(schema.rooms).get()?.count ?? 0;
    const activeRooms =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.rooms)
        .where(eq(schema.rooms.status, 'active'))
        .get()?.count ?? 0;

    const totalPlayCount =
      db
        .select({ sum: sql<number>`coalesce(sum(${schema.songs.playCount}), 0)` })
        .from(schema.songs)
        .get()?.sum ?? 0;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayPlayCount =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.playHistory)
        .where(gte(schema.playHistory.playedAt, startOfDay))
        .get()?.count ?? 0;

    const separationPending =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.separationTasks)
        .where(eq(schema.separationTasks.status, 'pending'))
        .get()?.count ?? 0;
    const separationProcessing =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.separationTasks)
        .where(eq(schema.separationTasks.status, 'processing'))
        .get()?.count ?? 0;
    const separationCompleted =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.separationTasks)
        .where(eq(schema.separationTasks.status, 'completed'))
        .get()?.count ?? 0;
    const separationFailed =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.separationTasks)
        .where(eq(schema.separationTasks.status, 'failed'))
        .get()?.count ?? 0;

    const aiParsePending =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.aiParseTasks)
        .where(eq(schema.aiParseTasks.status, 'pending'))
        .get()?.count ?? 0;
    const aiParseProcessing =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.aiParseTasks)
        .where(eq(schema.aiParseTasks.status, 'processing'))
        .get()?.count ?? 0;
    const aiParseCompleted =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.aiParseTasks)
        .where(eq(schema.aiParseTasks.status, 'completed'))
        .get()?.count ?? 0;
    const aiParseFailed =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.aiParseTasks)
        .where(eq(schema.aiParseTasks.status, 'failed'))
        .get()?.count ?? 0;
    const aiNeedReview =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.aiParseTasks)
        .where(eq(schema.aiParseTasks.needReview, 1))
        .get()?.count ?? 0;

    const metadataComplete =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.songs)
        .where(
          sql`${schema.songs.title} IS NOT NULL AND length(${schema.songs.title}) > 0 AND ${schema.songs.artistId} IS NOT NULL`
        )
        .get()?.count ?? 0;
    const metadataMissingTitle =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.songs)
        .where(sql`${schema.songs.title} IS NULL OR length(${schema.songs.title}) = 0`)
        .get()?.count ?? 0;
    const metadataMissingArtist =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.songs)
        .where(sql`${schema.songs.artistId} IS NULL`)
        .get()?.count ?? 0;
    const hasLyrics =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.songs)
        .where(sql`${schema.songs.lyricsPath} IS NOT NULL AND length(${schema.songs.lyricsPath}) > 0`)
        .get()?.count ?? 0;
    const hasVocal =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.songs)
        .where(sql`${schema.songs.vocalsPath} IS NOT NULL AND length(${schema.songs.vocalsPath}) > 0`)
        .get()?.count ?? 0;
    const hasInstrumental =
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.songs)
        .where(sql`${schema.songs.instrumentalPath} IS NOT NULL AND length(${schema.songs.instrumentalPath}) > 0`)
        .get()?.count ?? 0;

    res.json({
      success: true,
      data: {
        songs: {
          total: totalSongs,
          metadataComplete,
          metadataMissingTitle,
          metadataMissingArtist,
          hasLyrics,
          hasVocal,
          hasInstrumental,
        },
        artists: { total: totalArtists },
        rooms: { total: totalRooms, active: activeRooms },
        playback: { total: totalPlayCount, today: todayPlayCount },
        separation: {
          pending: separationPending,
          processing: separationProcessing,
          completed: separationCompleted,
          failed: separationFailed,
        },
        aiParse: {
          pending: aiParsePending,
          processing: aiParseProcessing,
          completed: aiParseCompleted,
          failed: aiParseFailed,
          needReview: aiNeedReview,
        },
      },
    });
  } catch (error) {
    logger.error('Error getting dashboard stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get dashboard stats' });
  }
});

/**
 * GET /system/dashboard/history - 仪表盘趋势数据（近 14 天每日汇总）
 */
router.get('/dashboard/history', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const days = 14;
    const labels: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const playRows = db
      .select({ day: sql<string>`strftime('%Y-%m-%d', ${schema.playHistory.playedAt} / 1000, 'unixepoch', 'localtime')`, count: sql<number>`count(*)` })
      .from(schema.playHistory)
      .where(gte(schema.playHistory.playedAt, startDate))
      .groupBy(sql`strftime('%Y-%m-%d', ${schema.playHistory.playedAt} / 1000, 'unixepoch', 'localtime')`)
      .all();

    const sepRows = db
      .select({ day: sql<string>`strftime('%Y-%m-%d', ${schema.separationTasks.completedAt} / 1000, 'unixepoch', 'localtime')`, count: sql<number>`count(*)` })
      .from(schema.separationTasks)
      .where(sql`${schema.separationTasks.status} = 'completed' AND ${schema.separationTasks.completedAt} >= ${startDate}`)
      .groupBy(sql`strftime('%Y-%m-%d', ${schema.separationTasks.completedAt} / 1000, 'unixepoch', 'localtime')`)
      .all();

    const aiRows = db
      .select({ day: sql<string>`strftime('%Y-%m-%d', ${schema.aiParseTasks.completedAt} / 1000, 'unixepoch', 'localtime')`, count: sql<number>`count(*)` })
      .from(schema.aiParseTasks)
      .where(sql`${schema.aiParseTasks.status} = 'completed' AND ${schema.aiParseTasks.completedAt} >= ${startDate}`)
      .groupBy(sql`strftime('%Y-%m-%d', ${schema.aiParseTasks.completedAt} / 1000, 'unixepoch', 'localtime')`)
      .all();

    const toMap = (rows: { day: string; count: number }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.day, r.count);
      return m;
    };
    const pMap = toMap(playRows);
    const sMap = toMap(sepRows);
    const aMap = toMap(aiRows);

    res.json({
      success: true,
      data: {
        labels,
        playback: labels.map(d => pMap.get(d) ?? 0),
        separation: labels.map(d => sMap.get(d) ?? 0),
        aiParse: labels.map(d => aMap.get(d) ?? 0),
      },
    });
  } catch (error) {
    logger.error('Error getting dashboard history:', error);
    res.status(500).json({ success: false, error: 'Failed to get dashboard history' });
  }
});

router.get('/info', authenticateToken, async (req: Request, res: Response) => {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    const stats = await fs.promises.statfs(config.scanPath);
    const storageTotalBytes = stats.blocks * stats.bsize;
    const storageUsedBytes = (stats.blocks - stats.bfree) * stats.bsize;

    res.json({
      success: true,
      data: {
        version: pkg.version || '0.0.0',
        databasePath: config.dbPath,
        storageUsedBytes,
        storageTotalBytes,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) {
      return res
        .status((error as any).statusCode)
        .json({ success: false, error: error.message });
    }
    logger.error('Error getting system info:', error);
    res
      .status(500)
      .json({ success: false, error: 'Failed to get system info' });
  }
});

/**
 * GET /system/health - 各服务健康状态聚合（后台首页「服务健康」模块使用）
 * 后端自身始终为 ok（能响应即代表存活）；分离服务通过 separatorClient 探测，
 * 不可达视为 down。随仪表盘 10s 轮询刷新，故此处不做缓存。
 */
router.get('/health', authenticateToken, async (_req: Request, res: Response) => {
  // 后端版本号：复用 /system/info 的读取方式（向上两层找 package.json）
  let backendVersion = '0.0.0';
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'),
    );
    backendVersion = pkg.version || '0.0.0';
  } catch {
    // 读取失败时回落到默认版本，不影响健康判定
  }

  const backend = {
    status: 'ok' as const,
    version: backendVersion,
    uptimeSec: Math.floor(process.uptime()),
  };

  // 分离服务：并行探测健康详情与安装状态
  let separator: {
    status: 'ok' | 'down' | 'installing';
    healthy: boolean;
    device?: string;
    ffmpegAvailable?: boolean;
    modelLoaded?: boolean;
    queueSize?: number;
    installState: 'installed' | 'installing' | 'failed' | 'not_installed' | 'unknown';
    installProgress?: number;
    error?: string;
  } = {
    status: 'down',
    healthy: false,
    installState: 'unknown',
  };

  try {
    const [health, install] = await Promise.all([
      separatorClient.getHealth(),
      separatorClient.getInstallStatus().catch(() => null),
    ]);
    const installing = install?.state === 'installing';
    separator = {
      status: installing ? 'installing' : 'ok',
      healthy: true,
      device: health.device,
      ffmpegAvailable: health.ffmpeg_available,
      modelLoaded: health.model_loaded,
      queueSize: health.queue_size,
      installState: (install?.state ?? 'installed') as
        | 'installed'
        | 'installing'
        | 'failed'
        | 'not_installed'
        | 'unknown',
      installProgress: install?.progress,
      error: install?.state === 'failed' ? install.error ?? undefined : undefined,
    };
  } catch (error) {
    separator = {
      ...separator,
      status: 'down',
      healthy: false,
      installState: 'unknown',
      error: error instanceof Error ? error.message : '分离服务不可达',
    };
  }

  res.json({ success: true, data: { backend, separator } });
});

export default router;
