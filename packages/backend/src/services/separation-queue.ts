import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import logger from '../logger';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import {
  separatorClient,
  SeparationModel,
  SeparationTaskResponse,
} from './separator-client';
import { parseAudioTags } from './id3';
import { config } from '../config';
import { getSeparationConcurrency } from './settings-service';

const DEFAULT_CONCURRENCY = 1;
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000; // 单任务最长 30 分钟
const RETRY_BASE_DELAY_MS = 1000; // 指数退避基数：1s, 2s, 4s
const DEFAULT_MODEL: SeparationModel = 'htdemucs';
// 统一基于项目根目录解析（本地=仓库根 data/separation，Docker=/app/data/separation），
// 避免依赖进程 CWD 导致本地/Docker 产物路径不一致
const DEFAULT_OUTPUT_DIR = config.separationOutputDir;

if (!fs.existsSync(DEFAULT_OUTPUT_DIR)) {
  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
}

/**
 * 解析数据库中存储的产物路径（相对路径基于项目根解析，与音频流路由保持一致）
 */
function resolveStoredPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(config.projectRoot, p);
}

export interface QueueItem {
  taskId: number; // 数据库 separation_tasks.id
  songId: number;
  model: SeparationModel;
  retryCount: number;
  separatorTaskId?: string; // Python 服务返回的 task_id
  pollTimer?: NodeJS.Timeout;
  pollStartedAt?: number;
  // 重新分离场景：任务开始前歌曲已有旧分离产物。
  // 新任务成功后才备份/替换旧产物；失败则回滚为 completed 继续使用旧版。
  hadPreviousOutput?: boolean;
  previousCompletedAt?: Date | null;
}

export type SeparationEventType =
  | 'started'
  | 'progress'
  | 'completed'
  | 'failed';

export interface SeparationEvent {
  type: SeparationEventType;
  taskId: number;
  songId: number;
  songTitle: string;
  progress?: number;
  stage?: 'extracting' | 'separating' | 'encoding' | 'done';
  vocalsPath?: string;
  instrumentalPath?: string;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
}

class SeparationQueue extends EventEmitter {
  private queue: QueueItem[] = [];
  private processing: Map<number, QueueItem> = new Map();
  private concurrency: number;

  constructor(concurrency: number = DEFAULT_CONCURRENCY) {
    super();
    // 同步用环境变量兜底，避免启动初期 updateConcurrency 未完成时任务以默认并发 1 串行
    const env = parseInt(process.env.SEPARATION_CONCURRENCY ?? '', 10);
    this.concurrency = Number.isFinite(env) && env > 0 ? env : concurrency;
    // 异步从 settings 读取（覆盖环境变量），失败则保持环境变量值
    this.updateConcurrency().catch(() => {});
  }

  /**
   * 从 settings 动态更新并发数
   */
  async updateConcurrency(): Promise<void> {
    this.concurrency = await getSeparationConcurrency();
    logger.info(`Separation concurrency set to ${this.concurrency}`);
    // 并发数提高后，尝试填充空闲槽位
    this.processNext();
  }

  /**
   * 任务入队：创建数据库记录，加入内存队列，触发处理
   */
  enqueue(
    songId: number,
    model: SeparationModel = DEFAULT_MODEL,
  ): number {
    const song = db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, songId))
      .get();

    if (!song) {
      throw new Error(`Song ${songId} not found`);
    }
    if (!song.filePath) {
      throw new Error(`Song ${songId} has no file_path`);
    }

    // 重新分离：记录旧产物状态，新任务成功后才备份/替换旧文件（失败则旧版继续可用）
    const hadPreviousOutput =
      song.separationStatus === 'completed' &&
      Boolean(song.vocalsPath || song.instrumentalPath);
    const previousCompletedAt = hadPreviousOutput
      ? song.separationCompletedAt
      : null;

    const result = db
      .insert(schema.separationTasks)
      .values({
        songId,
        status: 'pending',
        model,
        progress: 0,
        createdAt: new Date(),
      })
      .returning()
      .get();

    const taskId = result.id;

    // 重置歌曲分离状态
    db.update(schema.songs)
      .set({
        separationStatus: 'pending',
        separationModel: model,
        separationStartedAt: null,
        separationCompletedAt: null,
        separationError: null,
      })
      .where(eq(schema.songs.id, songId))
      .run();

    this.queue.push({
      taskId,
      songId,
      model,
      retryCount: 0,
      hadPreviousOutput,
      previousCompletedAt,
    });

    logger.info(
      `Separation task ${taskId} enqueued for song ${songId} (${song.title})`,
    );

    this.processNext();
    return taskId;
  }

  /**
   * 重试失败任务
   */
  retry(taskId: number): void {
    const task = db
      .select()
      .from(schema.separationTasks)
      .where(eq(schema.separationTasks.id, taskId))
      .get();

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    if (task.status !== 'failed' && task.status !== 'completed') {
      throw new Error(
        `Task ${taskId} is not in failed or completed state (current: ${task.status})`,
      );
    }
    if (!task.songId) {
      throw new Error(`Task ${taskId} has no song_id`);
    }

    // 防止同一歌曲并发重复分离（如歌曲正在被其他任务处理时重试旧任务）
    const song = db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, task.songId))
      .get();
    if (
      song &&
      (song.separationStatus === 'processing' ||
        song.separationStatus === 'pending')
    ) {
      throw new Error(
        `Song ${task.songId} already has an in-progress separation task`,
      );
    }

    // 重试已完成任务：记录旧产物状态，新任务成功后才备份/替换（失败则旧版继续可用）
    const hadPreviousOutput =
      song?.separationStatus === 'completed' &&
      Boolean(song.vocalsPath || song.instrumentalPath);
    const previousCompletedAt = hadPreviousOutput
      ? song?.separationCompletedAt
      : null;

    db.update(schema.separationTasks)
      .set({
        status: 'pending',
        progress: 0,
        stage: null,
        error: null,
        retryCount: 0,
        startedAt: null,
        completedAt: null,
      })
      .where(eq(schema.separationTasks.id, taskId))
      .run();

    db.update(schema.songs)
      .set({
        separationStatus: 'pending',
        separationCompletedAt: null,
        separationError: null,
      })
      .where(eq(schema.songs.id, task.songId))
      .run();

    this.queue.push({
      taskId,
      songId: task.songId,
      model: (task.model as SeparationModel) || DEFAULT_MODEL,
      retryCount: 0,
      hadPreviousOutput,
      previousCompletedAt,
    });

    logger.info(`Separation task ${taskId} retried for song ${task.songId}`);
    this.processNext();
  }

  async forceStop(taskId: number): Promise<boolean> {
    const task = db
      .select()
      .from(schema.separationTasks)
      .where(eq(schema.separationTasks.id, taskId))
      .get();

    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== 'processing')
      throw new Error(
        `Task ${taskId} is not processing (status: ${task.status})`,
      );

    const item = this.processing.get(taskId);
    if (item) {
      this.clearPollTimer(item);
      this.processing.delete(taskId);
    }

    if (item?.separatorTaskId) {
      try {
        await separatorClient.cancelTask(item.separatorTaskId);
      } catch (err) {
        logger.warn(
          { err, taskId },
          'Failed to cancel separator task (continuing with force stop)',
        );
      }
    }

    db.update(schema.separationTasks)
      .set({
        status: 'failed',
        error: '用户强制停止',
        completedAt: new Date(),
      })
      .where(eq(schema.separationTasks.id, taskId))
      .run();

    if (task.songId) {
      // 清理临时输出目录
      const tmpDir = path.join(DEFAULT_OUTPUT_DIR, `.tmp_${taskId}`);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ err, taskId, tmpDir }, 'Failed to remove temp output dir');
      }

      // 重新分离被停止：旧产物未被破坏，歌曲回滚为 completed 继续使用旧版
      db.update(schema.songs)
        .set(
          item?.hadPreviousOutput
            ? {
                separationStatus: 'completed',
                separationCompletedAt: item?.previousCompletedAt ?? null,
                separationError: '用户强制停止',
              }
            : {
                separationStatus: 'failed',
                separationError: '用户强制停止',
              },
        )
        .where(eq(schema.songs.id, task.songId))
        .run();
    }

    this.emit('failed', {
      type: 'failed',
      taskId,
      songId: task.songId,
      songTitle: 'Unknown',
      error: '用户强制停止',
    } as SeparationEvent);

    logger.info({ taskId }, 'Task force-stopped');
    setTimeout(() => this.processNext(), 100);
    return true;
  }

  /**
   * 处理队列中下一个任务（受并发限制）
   */
  private processNext(): void {
    while (this.processing.size < this.concurrency) {
      const item = this.queue.shift();
      if (!item) break;

      this.processing.set(item.taskId, item);
      // 异步处理，不阻塞循环
      this.processTask(item).catch((err) => {
        logger.error(
          `Unexpected error processing task ${item.taskId}:`,
          err,
        );
        this.processing.delete(item.taskId);
        this.processNext();
      });
    }
  }

  private async processTask(item: QueueItem): Promise<void> {
    const { taskId, songId, model } = item;

    const song = db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, songId))
      .get();
    const songTitle = song?.title ?? 'Unknown';

    try {
      // 更新任务为 processing
      db.update(schema.separationTasks)
        .set({ status: 'processing', startedAt: new Date(), error: null })
        .where(eq(schema.separationTasks.id, taskId))
        .run();

      db.update(schema.songs)
        .set({
          separationStatus: 'processing',
          separationStartedAt: new Date(),
          separationError: null,
        })
        .where(eq(schema.songs.id, songId))
        .run();

      this.emit('started', {
        type: 'started',
        taskId,
        songId,
        songTitle,
      } as SeparationEvent);

      // 调用 Python 服务创建任务。
      // 输出到临时目录（.tmp_<taskId>），旧产物在任务成功前保持不动；
      // 成功后由 handleTaskCompleted 备份旧产物并替换为新结果。
      const inputPath = song!.filePath!;
      const tmpDir = path.join(DEFAULT_OUTPUT_DIR, `.tmp_${taskId}`);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ err, taskId, tmpDir }, 'Failed to clean temp output dir');
      }

      const response = await separatorClient.createSeparationTask({
        input_path: inputPath,
        output_dir: tmpDir,
        model,
      });

      item.separatorTaskId = response.task_id;
      item.pollStartedAt = Date.now();

      db.update(schema.separationTasks)
        .set({ separatorTaskId: response.task_id })
        .where(eq(schema.separationTasks.id, taskId))
        .run();

      logger.info(
        `Task ${taskId} created separator task ${response.task_id}`,
      );

      // 轮询任务进度
      await this.pollTaskStatus(item, songTitle);
    } catch (error) {
      await this.handleTaskError(item, error, songTitle);
    }
  }

  /**
   * 轮询 Python 服务获取任务状态
   *
   * 使用 setTimeout 递归模式（而非 setInterval），避免上一次
   * getTaskStatus 请求未完成时下一次 interval 触发导致并发请求。
   */
  private pollTaskStatus(
    item: QueueItem,
    songTitle: string,
  ): Promise<void> {
    const { taskId, songId, separatorTaskId, pollStartedAt } = item;

    if (!separatorTaskId) {
      return Promise.reject(new Error('No separator task id'));
    }

    return new Promise<void>((resolve, reject) => {
      const poll = async (): Promise<void> => {
        try {
          // 超时保护
          if (pollStartedAt && Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
            throw new Error(
              `Polling timeout after ${POLL_TIMEOUT_MS}ms`,
            );
          }

          const status = await separatorClient.getTaskStatus(
            separatorTaskId,
          );

          // 更新数据库进度
          db.update(schema.separationTasks)
            .set({
              progress: status.progress ?? 0,
              stage: (status.stage as any) ?? null,
            })
            .where(eq(schema.separationTasks.id, taskId))
            .run();

          this.emit('progress', {
            type: 'progress',
            taskId,
            songId,
            songTitle,
            progress: status.progress ?? 0,
            stage: (status.stage as any) || 'separating',
          } as SeparationEvent);

          if (status.status === 'completed') {
            this.processing.delete(taskId);
            try {
              await this.handleTaskCompleted(item, status, songTitle);
              this.processNext();
              resolve();
            } catch (err) {
              reject(err);
            }
          } else if (status.status === 'failed') {
            this.processing.delete(taskId);
            reject(new Error(status.error || 'Separation failed'));
          } else {
            // 继续轮询：递归 setTimeout
            item.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
          }
        } catch (error) {
          this.processing.delete(item.taskId);
          reject(error);
        }
      };

      // 首次轮询：先等待一个 interval
      item.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    });
  }

  private clearPollTimer(item: QueueItem): void {
    if (item.pollTimer) {
      clearTimeout(item.pollTimer);
      item.pollTimer = undefined;
    }
  }

  /**
   * 任务完成：移除旧产物 → 替换为新产物 → 写回歌曲表
   *
   * 后台无恢复备份的功能，保留旧结果无意义，故重新分离成功时直接删除旧产物：
   * 1. 删除 song_<id>/ 下的旧 vocals/instrumental 成品
   * 2. 再把临时目录中的新产物移动到正式位置
   * 3. 清理临时目录（含 demucs 中间产物）
   */
  private async handleTaskCompleted(
    item: QueueItem,
    status: SeparationTaskResponse,
    songTitle: string,
  ): Promise<void> {
    const { taskId, songId } = item;
    const outputDir = path.join(DEFAULT_OUTPUT_DIR, `song_${songId}`);
    const tmpDir = path.join(DEFAULT_OUTPUT_DIR, `.tmp_${taskId}`);

    // 1. 移除旧产物（后台无恢复功能，备份无意义；新结果就绪后直接删旧）
    const song = db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.id, songId))
      .get();
    if (song && (song.vocalsPath || song.instrumentalPath)) {
      for (const p of [song.vocalsPath, song.instrumentalPath]) {
        if (!p) continue;
        const resolved = resolveStoredPath(p);
        if (fs.existsSync(resolved)) {
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      }
    }

    // 2. 新产物移动到正式位置
    fs.mkdirSync(outputDir, { recursive: true });
    const moveNew = (srcPath: string): string => {
      if (!srcPath) return '';
      const resolved = resolveStoredPath(srcPath);
      if (!fs.existsSync(resolved)) return '';
      const dest = path.join(outputDir, path.basename(resolved));
      fs.renameSync(resolved, dest);
      return dest;
    };
    const vocalsPath = moveNew(status.vocals_path ?? '');
    const instrumentalPath = moveNew(status.instrumental_path ?? '');

    // 3. 清理临时目录（含 demucs 中间产物）
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, taskId, tmpDir }, 'Failed to remove temp output dir');
    }

    db.update(schema.separationTasks)
      .set({
        status: 'completed',
        progress: 100,
        stage: 'done',
        error: null,
        completedAt: new Date(),
      })
      .where(eq(schema.separationTasks.id, taskId))
      .run();

    const songUpdate: Record<string, unknown> = {
      separationStatus: 'completed',
      separationCompletedAt: new Date(),
      vocalsPath,
      instrumentalPath,
      separationError: null,
    };

    try {
      const refPath = instrumentalPath || vocalsPath;
      if (refPath && fs.existsSync(resolveStoredPath(refPath))) {
        const tags = await parseAudioTags(resolveStoredPath(refPath));
        if (tags && tags.duration > 0) {
          songUpdate.duration = tags.duration;
        }
      }
    } catch (err) {
      logger.warn(
        { err, songId },
        'Failed to extract metadata from separated files',
      );
    }

    db.update(schema.songs)
      .set(songUpdate)
      .where(eq(schema.songs.id, songId))
      .run();

    this.emit('completed', {
      type: 'completed',
      taskId,
      songId,
      songTitle,
      vocalsPath,
      instrumentalPath,
    } as SeparationEvent);

    logger.info(`Task ${taskId} completed for song ${songId}`);
  }

  /**
   * 任务失败：指数退避重试或标记失败
   */
  private async handleTaskError(
    item: QueueItem,
    error: unknown,
    songTitle: string,
  ): Promise<void> {
    const { taskId, songId } = item;
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    this.clearPollTimer(item);
    this.processing.delete(taskId);

    item.retryCount++;

    if (item.retryCount < MAX_RETRIES) {
      const delay =
        RETRY_BASE_DELAY_MS * Math.pow(2, item.retryCount - 1);
      logger.warn(
        `Task ${taskId} failed (attempt ${item.retryCount}/${MAX_RETRIES}): ${errorMessage}, retrying in ${delay}ms`,
      );

      db.update(schema.separationTasks)
        .set({
          status: 'pending',
          error: errorMessage,
          retryCount: item.retryCount,
        })
        .where(eq(schema.separationTasks.id, taskId))
        .run();

      db.update(schema.songs)
        .set({
          separationStatus: 'pending',
          separationError: errorMessage,
        })
        .where(eq(schema.songs.id, songId))
        .run();

      setTimeout(() => {
        // 重新创建 separatorTaskId（旧的可能已失效）
        item.separatorTaskId = undefined;
        item.pollStartedAt = undefined;
        this.queue.push(item);
        this.processNext();
      }, delay);
    } else {
      // 永久失败
      db.update(schema.separationTasks)
        .set({
          status: 'failed',
          error: errorMessage,
          completedAt: new Date(),
        })
        .where(eq(schema.separationTasks.id, taskId))
        .run();

      // 清理临时输出目录，避免残留
      const tmpDir = path.join(DEFAULT_OUTPUT_DIR, `.tmp_${taskId}`);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn({ err, taskId, tmpDir }, 'Failed to remove temp output dir');
      }

      // 重新分离失败：旧产物未被破坏，歌曲回滚为 completed 继续使用旧版
      db.update(schema.songs)
        .set(
          item.hadPreviousOutput
            ? {
                separationStatus: 'completed',
                separationCompletedAt: item.previousCompletedAt ?? null,
                separationError: errorMessage,
              }
            : {
                separationStatus: 'failed',
                separationError: errorMessage,
              },
        )
        .where(eq(schema.songs.id, songId))
        .run();

      this.emit('failed', {
        type: 'failed',
        taskId,
        songId,
        songTitle,
        error: errorMessage,
        retryCount: item.retryCount,
        maxRetries: MAX_RETRIES,
      } as SeparationEvent);

      logger.error(
        `Task ${taskId} failed permanently: ${errorMessage}`,
      );
    }

    // 即使本任务在重试等待，也尝试处理其他任务
    this.processNext();
  }

  /**
   * 查询队列状态
   */
  getQueueStatus(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const count = (status: string) =>
      db
        .select()
        .from(schema.separationTasks)
        .where(eq(schema.separationTasks.status, status))
        .all().length;

    return {
      pending: this.queue.length,
      processing: this.processing.size,
      completed: count('completed'),
      failed: count('failed'),
    };
  }

  /**
   * 应用重启时恢复未完成任务
   *
   * 注：separatorTaskId 不持久化（schema 中无此字段），
   * 因此处理中的任务会被重置为 pending 重新执行。
   */
  recoverPendingTasks(): void {
    const processing = db
      .select()
      .from(schema.separationTasks)
      .where(eq(schema.separationTasks.status, 'processing'))
      .all();

    const pending = db
      .select()
      .from(schema.separationTasks)
      .where(eq(schema.separationTasks.status, 'pending'))
      .all();

    // 处理中的任务无法继续轮询，重置为 pending
    if (processing.length > 0) {
      db.update(schema.separationTasks)
        .set({ status: 'pending' })
        .where(eq(schema.separationTasks.status, 'processing'))
        .run();

      db.update(schema.songs)
        .set({ separationStatus: 'pending' })
        .where(eq(schema.songs.separationStatus, 'processing'))
        .run();
    }

    const toRecover = [...processing, ...pending];
    for (const task of toRecover) {
      if (!task.songId) continue;
      // 重启后无法得知是否重新分离，按歌曲当前产物引用判断
      const song = db
        .select()
        .from(schema.songs)
        .where(eq(schema.songs.id, task.songId))
        .get();
      const hadPreviousOutput = Boolean(song?.vocalsPath || song?.instrumentalPath);
      this.queue.push({
        taskId: task.id,
        songId: task.songId,
        model: (task.model as SeparationModel) || DEFAULT_MODEL,
        retryCount: task.retryCount ?? 0,
        hadPreviousOutput,
        previousCompletedAt: song?.separationCompletedAt ?? null,
      });
    }

    if (toRecover.length > 0) {
      logger.info(`Recovered ${toRecover.length} separation tasks`);
      this.processNext();
    }
  }
}

export const separationQueue = new SeparationQueue();

/**
 * 存量数据修复：对已分离完成但 duration 缺失（0）的歌曲，
 * 从分离产物（instrumental 优先）读取时长回填。
 * 单首歌失败不影响其他歌曲；无待修复歌曲时静默返回。
 */
export async function backfillMissingDurations(): Promise<void> {
  const songs = db
    .select()
    .from(schema.songs)
    .where(and(eq(schema.songs.separationStatus, 'completed'), eq(schema.songs.duration, 0)))
    .all();

  if (songs.length === 0) {
    return;
  }

  let fixed = 0;
  for (const song of songs) {
    try {
      const refPath = song.instrumentalPath || song.vocalsPath;
      if (!refPath || !fs.existsSync(resolveStoredPath(refPath))) {
        continue;
      }
      const tags = await parseAudioTags(resolveStoredPath(refPath));
      if (tags && tags.duration > 0) {
        db.update(schema.songs)
          .set({ duration: tags.duration })
          .where(eq(schema.songs.id, song.id))
          .run();
        fixed++;
      }
    } catch (err) {
      logger.warn({ err, songId: song.id }, 'Failed to backfill song duration');
    }
  }

  logger.info(`Backfilled duration for ${fixed}/${songs.length} songs`);
}
