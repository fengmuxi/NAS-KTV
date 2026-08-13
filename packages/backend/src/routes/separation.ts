import { Router, Request, Response } from 'express';
import logger from '../logger';
import fs from 'fs';
import path from 'path';
import { authenticateToken } from '../middleware/jwt';
import { createAppError } from '../middleware/error';
import { db, schema } from '../db';
import { eq, desc, sql } from 'drizzle-orm';
import { separationQueue } from '../services/separation-queue';
import {
  separatorClient,
  SEPARATION_MODELS,
  SeparationModel,
} from '../services/separator-client';
import { parseLRC, readLyricsFile } from '../services/lyrics-parser';
import { config } from '../config';
import { getSeparationModel } from '../services/scanner';

const router = Router();

/**
 * POST /api/songs/:id/separate - 触发歌曲人声分离
 */
router.post(
  '/songs/:id/separate',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const songId = parseInt(req.params.id);
      const model =
        (req.body?.model as SeparationModel) || getSeparationModel();

      if (!SEPARATION_MODELS.includes(model)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid model',
        });
      }

      const song = db
        .select()
        .from(schema.songs)
        .where(eq(schema.songs.id, songId))
        .get();

      if (!song) {
        return res
          .status(404)
          .json({ success: false, error: 'Song not found' });
      }
      if (!song.filePath) {
        return res
          .status(400)
          .json({ success: false, error: 'Song has no file_path' });
      }

      // 处理中或排队中则拒绝重复触发
      if (
        song.separationStatus === 'processing' ||
        song.separationStatus === 'pending'
      ) {
        return res.status(409).json({
          success: false,
          error: `Separation already in progress (status: ${song.separationStatus})`,
        });
      }

      const taskId = separationQueue.enqueue(songId, model);

      res.json({
        success: true,
        data: {
          taskId,
          songId,
          model,
          message: 'Separation task enqueued',
        },
      });
    } catch (error) {
      logger.error('Error triggering separation:', error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to trigger separation',
      });
    }
  },
);

/**
 * GET /api/separation/tasks - 分离任务列表（支持分页和状态筛选）
 */
router.get(
  '/separation/tasks',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const status = req.query.status as string | undefined;
      const offset = (page - 1) * pageSize;

      let items: any[];
      if (status) {
        items = db
          .select()
          .from(schema.separationTasks)
          .where(eq(schema.separationTasks.status, status))
          .orderBy(desc(schema.separationTasks.createdAt))
          .limit(pageSize)
          .offset(offset)
          .all();
      } else {
        items = db
          .select()
          .from(schema.separationTasks)
          .orderBy(desc(schema.separationTasks.createdAt))
          .limit(pageSize)
          .offset(offset)
          .all();
      }

      // 关联歌曲信息
      const itemsWithSong = items.map((task) => {
        const song = task.songId
          ? db
              .select({
                id: schema.songs.id,
                title: schema.songs.title,
                filePath: schema.songs.filePath,
                separationStatus: schema.songs.separationStatus,
                vocalsPath: schema.songs.vocalsPath,
                instrumentalPath: schema.songs.instrumentalPath,
              })
              .from(schema.songs)
              .where(eq(schema.songs.id, task.songId))
              .get()
          : null;
        return { ...task, song };
      });

      // 统计总数
      const totalResult = status
        ? db
            .select({ count: sql<number>`count(*)` })
            .from(schema.separationTasks)
            .where(eq(schema.separationTasks.status, status))
            .get()
        : db
            .select({ count: sql<number>`count(*)` })
            .from(schema.separationTasks)
            .get();

      const total = totalResult?.count ?? 0;

      res.json({
        success: true,
        data: {
          items: itemsWithSong,
          total,
          page,
          pageSize,
        },
      });
    } catch (error) {
      logger.error('Error getting separation tasks:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to get separation tasks' });
    }
  },
);

/**
 * GET /api/separation/tasks/:id - 任务详情
 */
router.get(
  '/separation/tasks/:id',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.id);

      const task = db
        .select()
        .from(schema.separationTasks)
        .where(eq(schema.separationTasks.id, taskId))
        .get();

      if (!task) {
        return res
          .status(404)
          .json({ success: false, error: 'Task not found' });
      }

      const song = task.songId
        ? db
            .select()
            .from(schema.songs)
            .where(eq(schema.songs.id, task.songId))
            .get()
        : null;

      res.json({
        success: true,
        data: { ...task, song },
      });
    } catch (error) {
      logger.error('Error getting separation task:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to get separation task' });
    }
  },
);

/**
 * POST /api/separation/tasks/:id/retry - 重试失败任务
 */
router.post(
  '/separation/tasks/:id/retry',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.id);
      separationQueue.retry(taskId);
      res.json({
        success: true,
        data: { taskId, message: 'Task re-queued for processing' },
      });
    } catch (error) {
      logger.error('Error retrying separation task:', error);
      const status =
        error instanceof Error && error.message.includes('not found')
          ? 404
          : error instanceof Error &&
            error.message.includes('not in failed or completed state')
            ? 400
            : 500;
      res.status(status).json({
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to retry task',
      });
    }
  },
);

router.post(
  '/separation/tasks/:id/stop',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const taskId = parseInt(req.params.id);
      await separationQueue.forceStop(taskId);
      res.json({
        success: true,
        data: { taskId, message: 'Task force-stopped' },
      });
    } catch (error) {
      logger.error('Error stopping task:', error);
      const status =
        error instanceof Error && error.message.includes('not found')
          ? 404
          : error instanceof Error &&
              error.message.includes('not processing')
            ? 400
            : 500;
      res.status(status).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to stop task',
      });
    }
  },
);

router.post(
  '/separation/tasks/batch-retry',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'taskIds array is required' });
      }
      let succeeded = 0;
      let skipped = 0;
      for (const id of taskIds) {
        try {
          separationQueue.retry(id);
          succeeded++;
        } catch {
          skipped++;
        }
      }
      res.json({ success: true, data: { succeeded, skipped } });
    } catch (error) {
      logger.error('Error batch retrying:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to batch retry' });
    }
  },
);

router.post(
  '/separation/tasks/batch-delete',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'taskIds array is required' });
      }
      let succeeded = 0;
      let skipped = 0;
      for (const id of taskIds) {
        const task = db
          .select()
          .from(schema.separationTasks)
          .where(eq(schema.separationTasks.id, id))
          .get();
        if (!task || task.status === 'processing') {
          skipped++;
          continue;
        }
        db.delete(schema.separationTasks)
          .where(eq(schema.separationTasks.id, id))
          .run();
        succeeded++;
      }
      res.json({ success: true, data: { succeeded, skipped } });
    } catch (error) {
      logger.error('Error batch deleting:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to batch delete' });
    }
  },
);

router.post(
  '/separation/tasks/batch-stop',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'taskIds array is required' });
      }
      let succeeded = 0;
      let skipped = 0;
      for (const id of taskIds) {
        try {
          await separationQueue.forceStop(id);
          succeeded++;
        } catch {
          skipped++;
        }
      }
      res.json({ success: true, data: { succeeded, skipped } });
    } catch (error) {
      logger.error('Error batch stopping:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to batch stop' });
    }
  },
);

/**
 * GET /api/separation/health - 分离服务健康检查
 */
router.get(
  '/separation/health',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const healthy = await separatorClient.healthCheck();
      res.json({ success: true, data: { healthy } });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Health check failed' });
    }
  },
);

/**
 * GET /api/separation/queue/status - 队列状态
 */
router.get(
  '/separation/queue/status',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const status = separationQueue.getQueueStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get queue status' });
    }
  },
);

/**
 * 跨源音频流响应头
 *
 * TV 端通过 Web Audio API（createMediaElementSource）接入跨源音频做混音，浏览器要求
 * 媒体「CORS 干净」且响应带 Cross-Origin-Resource-Policy，否则报
 * ERR_BLOCKED_BY_RESPONSE.NotSameOrigin 并无法播放。音频路由为公开接口（无鉴权），
 * 故显式放行跨源。
 */
const STREAM_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

/**
 * 音频流辅助函数 - 支持 Range 请求
 *
 * 返回 true 表示已处理响应（成功或失败），false 表示文件不存在
 */
function streamAudioFile(
  req: Request,
  res: Response,
  filePath: string | null | undefined,
): boolean {
  if (!filePath) {
    return false;
  }

  // 统一路径基准：相对路径（如旧数据中的 data/separation/...）基于项目根目录解析，
  // 避免依赖进程 CWD 导致本地/Docker 读取位置不一致
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(config.projectRoot, filePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    return false;
  }

  if (!stat.isFile()) {
    return false;
  }

  const fileSize = stat.size;
  const range = req.headers.range;

  // 音频 MIME 推断（默认 audio/mpeg）
  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.flv': 'video/x-flv',
    '.wmv': 'video/x-ms-wmv',
  };
  const isVideo = ext in mimeMap && mimeMap[ext].startsWith('video/');
  const contentType = mimeMap[ext] || 'audio/mpeg';

  if (range) {
    // 解析 Range: bytes=start-end
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).json({ success: false, error: 'Invalid range' });
      return true;
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      res
        .status(416)
        .set('Content-Range', `bytes */${fileSize}`)
        .json({ success: false, error: 'Requested range not satisfiable' });
      return true;
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(resolvedPath, { start, end });

    res.status(206).set({
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize.toString(),
      'Content-Type': contentType,
      ...STREAM_CORS_HEADERS,
    });

    stream.pipe(res);
    stream.on('error', (err) => {
      logger.error('Audio stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Stream error' });
      }
    });
    return true;
  }

  // 无 Range 头，返回完整文件
  res.status(200).set({
    'Content-Length': fileSize.toString(),
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    ...STREAM_CORS_HEADERS,
  });

  const stream = fs.createReadStream(resolvedPath);
  stream.pipe(res);
  stream.on('error', (err) => {
    logger.error('Audio stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Stream error' });
    }
  });
  return true;
}

/**
 * GET /api/songs/:id/instrumental - 伴奏音频流（支持 Range）
 */
router.get(
  '/songs/:id/instrumental',
  async (req: Request, res: Response) => {
    try {
      const songId = parseInt(req.params.id);
      const song = db
        .select()
        .from(schema.songs)
        .where(eq(schema.songs.id, songId))
        .get();

      if (!song) {
        throw createAppError('Song not found', 404);
      }

      const served = streamAudioFile(req, res, song.instrumentalPath);
      if (!served) {
        throw createAppError(
          'Instrumental track not available for this song',
          404,
        );
      }
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        return res
          .status((error as any).statusCode)
          .json({ success: false, error: error.message });
      }
      logger.error('Error streaming instrumental:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to stream instrumental' });
    }
  },
);

/**
 * GET /api/songs/:id/vocals - 人声音频流（支持 Range）
 */
router.get(
  '/songs/:id/vocals',
  async (req: Request, res: Response) => {
    try {
      const songId = parseInt(req.params.id);
      const song = db
        .select()
        .from(schema.songs)
        .where(eq(schema.songs.id, songId))
        .get();

      if (!song) {
        throw createAppError('Song not found', 404);
      }

      const served = streamAudioFile(req, res, song.vocalsPath);
      if (!served) {
        throw createAppError(
          'Vocals track not available for this song',
          404,
        );
      }
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        return res
          .status((error as any).statusCode)
          .json({ success: false, error: error.message });
      }
      logger.error('Error streaming vocals:', error);
      res
        .status(500)
        .json({ success: false, error: 'Failed to stream vocals' });
    }
  },
);

/**
 * GET /api/songs/:id/audio - 原始音频流（支持 Range）
 */
router.get('/songs/:id/audio', async (req: Request, res: Response) => {
  try {
    const songId = parseInt(req.params.id);
    const song = db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, songId))
      .get();

    if (!song) {
      throw createAppError('Song not found', 404);
    }

    const served = streamAudioFile(req, res, song.filePath);
    if (!served) {
      throw createAppError('File not found', 404);
    }
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) {
      return res
        .status((error as any).statusCode)
        .json({ success: false, error: error.message });
    }
    logger.error('Error streaming audio:', error);
    res.status(500).json({ success: false, error: 'Failed to stream audio' });
  }
});

/**
 * GET /api/songs/:id/lyrics - 歌词数据（LRC 解析）→ 返回 { lines, wordTiming }
 *
 * 无歌词路径或文件不存在时返回空结果，不报错
 */
router.get('/songs/:id/lyrics', async (req: Request, res: Response) => {
  try {
    const songId = parseInt(req.params.id);
    const song = db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, songId))
      .get();

    if (!song) {
      throw createAppError('Song not found', 404);
    }

    // 无歌词路径或文件不存在则返回空结果（不报错）
    if (!song.lyricsPath || !fs.existsSync(song.lyricsPath)) {
      return res.json({ success: true, data: { lines: [], wordTiming: false } });
    }

    const content = readLyricsFile(song.lyricsPath);
    const result = parseLRC(content);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) {
      return res
        .status((error as any).statusCode)
        .json({ success: false, error: error.message });
    }
    logger.error('Error getting lyrics:', error);
    res.status(500).json({ success: false, error: 'Failed to get lyrics' });
  }
});

/**
 * GET /api/songs/:id/lyrics/raw - 原始 LRC 文本（Admin 歌词编辑回填用）
 * 无歌词时返回空字符串
 */
router.get('/songs/:id/lyrics/raw', async (req: Request, res: Response) => {
  try {
    const songId = parseInt(req.params.id);
    const song = db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, songId))
      .get();

    if (!song) {
      throw createAppError('Song not found', 404);
    }

    let content = '';
    if (song.lyricsPath && fs.existsSync(song.lyricsPath)) {
      content = readLyricsFile(song.lyricsPath);
    }
    res.json({ success: true, data: { content } });
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error) {
      return res
        .status((error as any).statusCode)
        .json({ success: false, error: error.message });
    }
    logger.error('Error getting raw lyrics:', error);
    res.status(500).json({ success: false, error: 'Failed to get lyrics' });
  }
});

/**
 * PUT /api/songs/:id/lyrics - 保存 LRC 歌词（Admin 维护入口）
 * body: { content: string }（LRC 格式文本）；写入 <projectRoot>/data/lyrics/<songId>.lrc
 * 并更新 songs.lyrics_path；内容非空但解析不出有效行则拒绝
 */
router.put(
  '/songs/:id/lyrics',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const songId = parseInt(req.params.id);
      const content = typeof req.body?.content === 'string' ? req.body.content : '';

      if (!content.trim()) {
        return res
          .status(400)
          .json({ success: false, error: '歌词内容不能为空' });
      }

      const lineCount = parseLRC(content).lines.length;
      if (lineCount === 0) {
        return res
          .status(400)
          .json({ success: false, error: '不是有效的 LRC 格式（需包含 [mm:ss.xx] 时间行）' });
      }

      const song = db
        .select()
        .from(schema.songs)
        .where(eq(schema.songs.id, songId))
        .get();

      if (!song) {
        throw createAppError('Song not found', 404);
      }

      fs.mkdirSync(config.lyricsDir, { recursive: true });
      const lyricsFile = path.join(config.lyricsDir, `${songId}.lrc`);
      fs.writeFileSync(lyricsFile, content, 'utf-8');

      db.update(schema.songs)
        .set({ lyricsPath: lyricsFile })
        .where(eq(schema.songs.id, songId))
        .run();

      res.json({ success: true, data: { lineCount, path: lyricsFile } });
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        return res
          .status((error as any).statusCode)
          .json({ success: false, error: error.message });
      }
      logger.error('Error saving lyrics:', error);
      res.status(500).json({ success: false, error: 'Failed to save lyrics' });
    }
  },
);

/**
 * DELETE /api/songs/:id/lyrics - 删除歌词（文件 + 清空 songs.lyrics_path）
 */
router.delete(
  '/songs/:id/lyrics',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const songId = parseInt(req.params.id);
      const song = db
        .select()
        .from(schema.songs)
        .where(eq(schema.songs.id, songId))
        .get();

      if (!song) {
        throw createAppError('Song not found', 404);
      }

      if (song.lyricsPath && fs.existsSync(song.lyricsPath)) {
        // 仅删除本站歌词目录下的文件，避免误删扫描发现的同名 .lrc
        if (path.resolve(song.lyricsPath).startsWith(config.lyricsDir)) {
          fs.unlinkSync(song.lyricsPath);
        }
      }

      db.update(schema.songs)
        .set({ lyricsPath: null })
        .where(eq(schema.songs.id, songId))
        .run();

      res.json({ success: true, data: null });
    } catch (error) {
      if (error instanceof Error && 'statusCode' in error) {
        return res
          .status((error as any).statusCode)
          .json({ success: false, error: error.message });
      }
      logger.error('Error deleting lyrics:', error);
      res.status(500).json({ success: false, error: 'Failed to delete lyrics' });
    }
  },
);

export default router;
