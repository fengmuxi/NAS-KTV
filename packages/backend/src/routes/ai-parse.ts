import { Router, Request, Response } from 'express';
import logger from '../logger';
import { authenticateToken } from '../middleware/jwt';
import { getAiConfig, updateAiConfig, testConnection } from '../services/ai-client';
import { aiParseQueue } from '../services/ai-queue';
import { getPromptTemplate, updatePromptTemplate } from '../services/ai-prompt';
import { getArtistNamesBySong } from '../services/song-service';
import { db, schema } from '../db';
import { eq, desc, sql, and } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/ai-parse/config - 获取AI配置
 */
router.get('/ai-parse/config', authenticateToken, async (req: Request, res: Response) => {
  try {
    const config = await getAiConfig();
    // API Key脱敏
    const maskedConfig = {
      ...config,
      apiKey: config.apiKey ? config.apiKey.substring(0, 8) + '****' : ''
    };
    res.json({ success: true, data: maskedConfig });
  } catch (error) {
    logger.error('Error getting AI config:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI config' });
  }
});

/**
 * PUT /api/ai-parse/config - 更新AI配置
 */
router.put('/ai-parse/config', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey, model, enabled } = req.body;
    
    const updateData: any = {};
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl;
    if (apiKey !== undefined && !apiKey.includes('****')) updateData.apiKey = apiKey;
    if (model !== undefined) updateData.model = model;
    if (enabled !== undefined) updateData.enabled = enabled;
    
    const config = await updateAiConfig(updateData);
    // API Key脱敏
    const maskedConfig = {
      ...config,
      apiKey: config.apiKey ? config.apiKey.substring(0, 8) + '****' : ''
    };
    res.json({ success: true, data: maskedConfig });
  } catch (error) {
    logger.error('Error updating AI config:', error);
    res.status(500).json({ success: false, error: 'Failed to update AI config' });
  }
});

/**
 * POST /api/ai-parse/test - 测试AI连接
 */
router.post('/ai-parse/test', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await testConnection();
    res.json({ success: result.success, data: result });
  } catch (error) {
    logger.error('Error testing AI connection:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to test AI connection',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/ai-parse/trigger - 触发单首歌曲AI解析
 */
router.post('/ai-parse/trigger', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { songId } = req.body;

    if (!songId || typeof songId !== 'number') {
      return res.status(400).json({ success: false, error: 'songId is required' });
    }

    // 检查歌曲是否存在
    const song = db.select().from(schema.songs).where(eq(schema.songs.id, songId)).get();
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }

    // 入队
    const taskId = aiParseQueue.enqueue(songId);

    res.json({
      success: true,
      data: {
        taskId,
        songId,
        message: 'AI parse task enqueued'
      }
    });
  } catch (error) {
    logger.error('Error triggering AI parse:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger AI parse' });
  }
});

/**
 * POST /api/ai-parse/batch - 批量触发AI解析
 */
router.post('/ai-parse/batch', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { songIds } = req.body;
    
    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ success: false, error: 'songIds array is required' });
    }
    
    const taskIds = aiParseQueue.enqueueBatch(songIds);
    
    res.json({ 
      success: true, 
      data: { 
        taskIds, 
        count: taskIds.length,
        message: `${taskIds.length} AI parse tasks enqueued` 
      } 
    });
  } catch (error) {
    logger.error('Error triggering batch AI parse:', error);
    res.status(500).json({ success: false, error: 'Failed to trigger batch AI parse' });
  }
});

/**
 * GET /api/ai-parse/stats - 获取解析统计信息
 */
router.get('/ai-parse/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const all = db.select().from(schema.aiParseTasks).all();
    const stats = {
      total: all.length,
      pending: all.filter(t => t.status === 'pending' || t.status === 'processing').length,
      completed: all.filter(t => t.status === 'completed').length,
      failed: all.filter(t => t.status === 'failed').length,
      needReview: all.filter(t => t.needReview === 1).length,
    };
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Error getting AI parse stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

/**
 * GET /api/ai-parse/tasks - 获取解析任务列表
 */
router.get('/ai-parse/tasks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;

    const tasks = db.select()
      .from(schema.aiParseTasks)
      .where(status ? eq(schema.aiParseTasks.status, status) : undefined)
      .orderBy(desc(schema.aiParseTasks.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    const countResult = status
      ? db.select({ count: sql<number>`count(*)` }).from(schema.aiParseTasks).where(eq(schema.aiParseTasks.status, status)).get()
      : db.select({ count: sql<number>`count(*)` }).from(schema.aiParseTasks).get();

    const total = countResult?.count ?? 0;

    const songIds = [...new Set(tasks.map(t => t.songId).filter((id): id is number => id != null))];
    const songsMap = new Map<number, { id: number; title: string; filePath: string; artistId: number | null; artistName?: string | null; artistNames?: string[] }>();
    for (const songId of songIds) {
      const song = db.select({
        id: schema.songs.id,
        title: schema.songs.title,
        filePath: schema.songs.filePath,
        artistId: schema.songs.artistId,
        artistName: schema.artists.name,
      })
        .from(schema.songs)
        .leftJoin(schema.artists, eq(schema.songs.artistId, schema.artists.id))
        .where(eq(schema.songs.id, songId))
        .get();
      if (song) songsMap.set(songId, song);
    }
    const artistNamesBySong = getArtistNamesBySong(songIds);
    for (const song of songsMap.values()) {
      song.artistNames = artistNamesBySong.get(song.id) ?? [];
    }

    const items = tasks.map(t => ({
      ...t,
      song: t.songId != null ? songsMap.get(t.songId) ?? null : null,
    }));

    res.json({
      success: true,
      data: {
        items,
        total,
        limit,
        offset
      }
    });
  } catch (error) {
    logger.error('Error getting AI parse tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI parse tasks' });
  }
});

/**
 * GET /api/ai-parse/tasks/by-song/:songId - 按歌曲获取最近一次解析任务
 * 供歌曲管理页直接审核使用：定位该歌曲待审核（或最近一次）的解析结果。
 */
router.get('/ai-parse/tasks/by-song/:songId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const songId = parseInt(req.params.songId);
    if (!songId || isNaN(songId)) {
      return res.status(400).json({ success: false, error: 'songId is required' });
    }

    // 优先取待审核任务，否则取最近一次任务
    const pending = db.select()
      .from(schema.aiParseTasks)
      .where(and(eq(schema.aiParseTasks.songId, songId), eq(schema.aiParseTasks.needReview, 1)))
      .orderBy(desc(schema.aiParseTasks.createdAt))
      .get();

    const task = pending ?? db.select()
      .from(schema.aiParseTasks)
      .where(eq(schema.aiParseTasks.songId, songId))
      .orderBy(desc(schema.aiParseTasks.createdAt))
      .get();

    if (!task) {
      return res.status(404).json({ success: false, error: 'No AI parse task for this song' });
    }

    res.json({ success: true, data: task });
  } catch (error) {
    logger.error('Error getting AI parse task by song:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI parse task' });
  }
});

/**
 * GET /api/ai-parse/tasks/:id - 获取解析任务详情
 */
router.get('/ai-parse/tasks/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id);

    const task = db.select()
      .from(schema.aiParseTasks)
      .where(eq(schema.aiParseTasks.id, taskId))
      .get();

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const song = db.select()
      .from(schema.songs)
      .where(eq(schema.songs.id, task.songId!))
      .get();

    let artistName = '';
    if (song?.artistId) {
      const artist = db.select().from(schema.artists).where(eq(schema.artists.id, song.artistId)).get();
      if (artist) artistName = artist.name;
    }

    const artistNames = song ? getArtistNamesBySong([song.id]).get(song.id) ?? [] : [];

    res.json({
      success: true,
      data: {
        ...task,
        song: song ? { ...song, artistName, artistNames } : null
      }
    });
  } catch (error) {
    logger.error('Error getting AI parse task:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI parse task' });
  }
});

/**
 * POST /api/ai-parse/tasks/:id/review - 审核解析结果
 */
router.post('/ai-parse/tasks/:id/review', authenticateToken, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id);
    const { action, modifiedResult } = req.body;
    // action: 'approve' | 'reject' | 'modify'
    
    const task = db.select()
      .from(schema.aiParseTasks)
      .where(eq(schema.aiParseTasks.id, taskId))
      .get();
    
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    if (action === 'approve') {
      // 批准 - 应用解析结果（人工确认，aiParsed 置为已解析）
      const result = JSON.parse(task.result || '{}');
      const { aiParseService } = await import('../services/ai-parse-service');
      await aiParseService.applyParseResult(task.songId!, result, { approved: true });
      
      db.update(schema.aiParseTasks)
        .set({ needReview: 0 })
        .where(eq(schema.aiParseTasks.id, taskId))
        .run();
      
      res.json({ success: true, message: 'Result approved and applied' });
    } else if (action === 'modify' && modifiedResult) {
      // 修改后应用（人工确认，aiParsed 置为已解析）
      const { aiParseService } = await import('../services/ai-parse-service');
      await aiParseService.applyParseResult(task.songId!, modifiedResult, { approved: true });
      
      db.update(schema.aiParseTasks)
        .set({ 
          needReview: 0,
          result: JSON.stringify(modifiedResult)
        })
        .where(eq(schema.aiParseTasks.id, taskId))
        .run();
      
      res.json({ success: true, message: 'Modified result applied' });
    } else if (action === 'reject') {
      // 拒绝：清理任务待审核标记，并清除歌曲的待审核标记
      // （否则歌曲管理页徽标会永远停在「待审核」，可无限次重复审核）
      db.update(schema.aiParseTasks)
        .set({ needReview: 0, status: 'rejected' })
        .where(eq(schema.aiParseTasks.id, taskId))
        .run();

      db.update(schema.songs)
        .set({ aiNeedReview: 0 })
        .where(eq(schema.songs.id, task.songId!))
        .run();

      res.json({ success: true, message: 'Result rejected' });
    } else {
      res.status(400).json({ success: false, error: 'Invalid action' });
    }
  } catch (error) {
    logger.error('Error reviewing AI parse task:', error);
    res.status(500).json({ success: false, error: 'Failed to review AI parse task' });
  }
});

/**
 * POST /api/ai-parse/tasks/:id/retry - 重试解析任务
 */
router.post('/ai-parse/tasks/:id/retry', authenticateToken, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id);

    const task = db.select()
      .from(schema.aiParseTasks)
      .where(eq(schema.aiParseTasks.id, taskId))
      .get();

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const newTaskId = aiParseQueue.enqueue(task.songId!);

    res.json({
      success: true,
      data: {
        taskId: newTaskId,
        songId: task.songId,
        message: 'AI parse task retried'
      }
    });
  } catch (error) {
    logger.error('Error retrying AI parse task:', error);
    res.status(500).json({ success: false, error: 'Failed to retry AI parse task' });
  }
});

router.get('/ai-parse/prompt', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { systemPrompt, userPromptTemplate } = getPromptTemplate();
    res.json({ success: true, data: { systemPrompt, userPromptTemplate } });
  } catch (error) {
    logger.error('Error getting prompt template:', error);
    res.status(500).json({ success: false, error: 'Failed to get prompt template' });
  }
});

router.put('/ai-parse/prompt', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { systemPrompt, userPromptTemplate } = req.body;
    if (!systemPrompt || !userPromptTemplate) {
      return res.status(400).json({ success: false, error: 'systemPrompt and userPromptTemplate are required' });
    }
    updatePromptTemplate(systemPrompt, userPromptTemplate);
    res.json({ success: true, message: 'Prompt template updated' });
  } catch (error) {
    logger.error('Error updating prompt template:', error);
    res.status(500).json({ success: false, error: 'Failed to update prompt template' });
  }
});

router.post('/ai-parse/tasks/:id/rollback', authenticateToken, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id);
    const task = db.select().from(schema.aiParseTasks).where(eq(schema.aiParseTasks.id, taskId)).get();
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    if (!task.originalTitle) {
      return res.status(400).json({ success: false, error: 'No original data to rollback to' });
    }
    const { aiParseService } = await import('../services/ai-parse-service');
    await aiParseService.rollbackParseResult(task.songId!, task.originalTitle, task.originalArtistId);

    db.update(schema.aiParseTasks)
      .set({ status: 'rolled_back' })
      .where(eq(schema.aiParseTasks.id, taskId))
      .run();

    res.json({ success: true, message: 'Rolled back successfully' });
  } catch (error) {
    logger.error('Error rolling back AI parse:', error);
    res.status(500).json({ success: false, error: 'Failed to rollback' });
  }
});

router.post('/ai-parse/tasks/:id/reparse', authenticateToken, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id);
    const task = db.select().from(schema.aiParseTasks).where(eq(schema.aiParseTasks.id, taskId)).get();
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const newTaskId = aiParseQueue.enqueue(task.songId!);
    res.json({ success: true, data: { taskId: newTaskId, songId: task.songId, message: 'Re-parse task enqueued' } });
  } catch (error) {
    logger.error('Error re-parsing:', error);
    res.status(500).json({ success: false, error: 'Failed to re-parse' });
  }
});

router.delete('/ai-parse/tasks/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id);
    const task = db.select().from(schema.aiParseTasks).where(eq(schema.aiParseTasks.id, taskId)).get();
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    if (task.status === 'pending' || task.status === 'processing') {
      return res.status(400).json({ success: false, error: 'Cannot delete running task' });
    }
    db.delete(schema.aiParseTasks).where(eq(schema.aiParseTasks.id, taskId)).run();
    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    logger.error('Error deleting AI parse task:', error);
    res.status(500).json({ success: false, error: 'Failed to delete task' });
  }
});

router.post('/ai-parse/tasks/delete-batch', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ success: false, error: 'taskIds array is required' });
    }
    let deleted = 0;
    for (const taskId of taskIds) {
      const task = db.select().from(schema.aiParseTasks).where(eq(schema.aiParseTasks.id, taskId)).get();
      if (task && task.status !== 'pending' && task.status !== 'processing') {
        db.delete(schema.aiParseTasks).where(eq(schema.aiParseTasks.id, taskId)).run();
        deleted++;
      }
    }
    res.json({ success: true, data: { deleted, message: `Deleted ${deleted} tasks` } });
  } catch (error) {
    logger.error('Error batch deleting AI parse tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to delete tasks' });
  }
});

export default router;
