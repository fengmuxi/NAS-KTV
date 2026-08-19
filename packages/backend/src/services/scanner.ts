import { glob } from 'fast-glob';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import logger from '../logger';
import { db, schema } from '../db';
import { eq, and, or, isNull } from 'drizzle-orm';
import { parseAudioTags, getFileType, isMediaFile, AudioTags } from './id3';
import { config } from '../config';
import { getPinyin, getFirstLetter } from '@nasktv/shared';
import {
  parseSongInfo,
  ensureUnknownArtist,
  ensureUnknownCategory,
  removeUnknownCategory,
} from './song-info-parser';
import { initializeDefaultCategories, isDefaultCategoriesInitialized } from './category-init';
import { separationQueue } from './separation-queue';
import { aiParseQueue } from './ai-queue';
import { getAutoAiParseEnabled, getScanMd5DedupEnabled } from './settings-service';
import { countArtistSongs, deleteSong, setSongArtists } from './song-service';
import {
  SEPARATION_MODELS,
  type SeparationModel,
} from './separator-client';

// 扫描状态
export interface ScanStatus {
  isScanning: boolean;
  scanId: string | null;
  startTime: number | null;
  currentFile: string | null;
  processed: number;
  total: number;
  newSongs: number;
  updatedSongs: number;
  skippedSongs: number;
  errors: string[];
}

// 扫描进度回调
export type ScanProgressCallback = (progress: {
  type: 'started' | 'progress' | 'completed' | 'failed';
  data: any;
}) => void;

// 当前扫描状态
let scanStatus: ScanStatus = {
  isScanning: false,
  scanId: null,
  startTime: null,
  currentFile: null,
  processed: 0,
  total: 0,
  newSongs: 0,
  updatedSongs: 0,
  skippedSongs: 0,
  errors: []
};

// 进度回调列表
const progressCallbacks: ScanProgressCallback[] = [];

/**
 * 注册扫描进度回调
 */
export function onScanProgress(callback: ScanProgressCallback): () => void {
  progressCallbacks.push(callback);
  return () => {
    const index = progressCallbacks.indexOf(callback);
    if (index > -1) {
      progressCallbacks.splice(index, 1);
    }
  };
}

/**
 * 发送扫描进度
 */
function emitProgress(progress: { type: 'started' | 'progress' | 'completed' | 'failed'; data: any }) {
  progressCallbacks.forEach(callback => {
    try {
      callback(progress);
    } catch (error) {
      logger.error('Error in scan progress callback:', error);
    }
  });
}

/**
 * 获取当前扫描状态
 */
export function getScanStatus(): ScanStatus {
  return { ...scanStatus };
}

/**
 * 查找或创建歌手
 */
async function findOrCreateArtist(artistName: string): Promise<number | null> {
  if (!artistName || artistName.trim() === '') {
    return null;
  }
  
  const trimmedName = artistName.trim();
  
  // 查找现有歌手
  const existingArtist = await db
    .select()
    .from(schema.artists)
    .where(eq(schema.artists.name, trimmedName))
    .limit(1);
  
  if (existingArtist.length > 0) {
    return existingArtist[0].id;
  }
  
  // 创建新歌手
  const pinyin = getPinyin(trimmedName);
  const firstLetter = getFirstLetter(trimmedName);
  
  const [newArtist] = await db
    .insert(schema.artists)
    .values({
      name: trimmedName,
      pinyin: pinyin,
      firstLetter: firstLetter,
      songCount: 0
    })
    .returning();
  
  logger.info(`Created new artist: ${trimmedName} (${pinyin})`);
  return newArtist.id;
}

/**
 * 更新歌手歌曲数量（含副歌手参与）
 */
async function updateArtistSongCount(artistId: number): Promise<void> {
  await db
    .update(schema.artists)
    .set({ songCount: countArtistSongs(artistId) })
    .where(eq(schema.artists.id, artistId));
}

/**
 * 检查歌词文件是否存在
 */
async function checkLyricsFile(audioFilePath: string): Promise<string | null> {
  const dir = path.dirname(audioFilePath);
  const baseName = path.basename(audioFilePath, path.extname(audioFilePath));
  const lrcPath = path.join(dir, `${baseName}.lrc`);
  
  try {
    await fs.access(lrcPath);
    return lrcPath;
  } catch {
    return null;
  }
}

type ProcessResult = {
  status: 'new' | 'updated' | 'skipped' | 'error';
  songId?: number;
  reason?: string;
  error?: string;
};

/**
 * 计算文件 MD5 哈希
 */
function computeFileHash(filePath: string): string {
  const hash = createHash('md5');
  const buffer = fsSync.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * 补全历史歌曲缺失的 MD5 哈希（开启 MD5 去重前入库的歌曲 file_hash 为 NULL，
 * 不补全则新扫描的重复文件无法命中查重）。文件已丢失的歌曲跳过，保留 NULL。
 * @returns 成功回填的歌曲数
 */
export async function backfillFileHashes(): Promise<number> {
  const missing = db
    .select({ id: schema.songs.id, filePath: schema.songs.filePath })
    .from(schema.songs)
    .where(isNull(schema.songs.fileHash))
    .all();

  if (missing.length === 0) return 0;

  let filled = 0;
  for (const song of missing) {
    try {
      await fs.access(song.filePath);
      const hash = computeFileHash(song.filePath);
      db.update(schema.songs).set({ fileHash: hash }).where(eq(schema.songs.id, song.id)).run();
      filled++;
    } catch {
      // 文件不可读/已丢失：跳过，保留 NULL
    }
  }
  return filled;
}

/**
 * 清理库中 MD5 哈希相同的重复歌曲记录（保留最早入库的一首）。
 * 仅删除 DB 记录与分类关联，不删除磁盘文件；正在播放队列中的歌曲跳过。
 * @returns 删除的歌曲记录数
 */
export async function cleanupDuplicateHashes(): Promise<number> {
  const dups = db
    .select({
      hash: schema.songs.fileHash,
      id: schema.songs.id,
      createdAt: schema.songs.createdAt,
    })
    .from(schema.songs)
    .all();

  // 按 hash 分组，过滤出重复组
  const groups = new Map<string, typeof dups>();
  for (const s of dups) {
    if (!s.hash) continue;
    const g = groups.get(s.hash);
    if (g) g.push(s);
    else groups.set(s.hash, [s]);
  }

  const playingSongIds = new Set(
    db
      .select({ songId: schema.roomQueues.songId })
      .from(schema.roomQueues)
      .where(eq(schema.roomQueues.status, 'playing'))
      .all()
      .map((r) => r.songId)
      .filter((id): id is number => id != null),
  );

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // 保留最早入库（createdAt 最小，其次 id 最小）；队列中的歌曲优先保留
    const sorted = [...group].sort((a, b) => {
      const aTs = a.createdAt?.getTime() ?? 0;
      const bTs = b.createdAt?.getTime() ?? 0;
      return aTs !== bTs ? aTs - bTs : a.id - b.id;
    });
    let keep = sorted[0];
    for (const s of sorted) {
      if (playingSongIds.has(s.id)) {
        keep = s;
        break;
      }
    }
    for (const s of sorted) {
      if (s.id === keep.id) continue;
      await deleteSong(s.id);
      removed++;
      logger.info(`MD5 dedup: removed song ${s.id} as duplicate of ${keep.id} (hash ${s.hash})`);
    }
  }
  return removed;
}

/**
 * 标准化歌曲名称用于去重比较
 * 去除括号内容、版本标记、空格、特殊字符，统一小写
 */
function normalizeSongName(name: string): string {
  return name
    .replace(/[\(\[\{（【][^\)\]\}）】]*[\)\]\}）】]/g, '') // 去除括号内容
    .replace(/[-–—_]\s*(live|remix|ver\.?|version|cover|acoustic|instrumental|karaoke|伴奏|纯音乐|铃声|片段|高潮版|抖音版|片段版).*/gi, '') // 去除版本标记
    .replace(/\.(mp3|flac|m4a|wav|aac|ogg|wma|mp4|mkv|avi|mov|wmv|flv|webm)$/i, '') // 去除扩展名残留
    .replace(/[\s\-_\.]+/g, '') // 去除空格和分隔符
    .toLowerCase()
    .trim();
}

/**
 * 处理单个媒体文件
 * @param options.skipDedup 跳过 MD5 查重（还原被去重删除的歌曲时使用，避免与保留副本哈希相同被跳过）
 */
export async function processMediaFile(filePath: string, options?: { skipDedup?: boolean }): Promise<ProcessResult> {
  try {
    const fileType = getFileType(filePath);
    if (!fileType) {
      return { status: 'skipped', reason: '不支持的媒体类型' };
    }

    // 检查文件路径是否已存在
    const existingSong = await db
      .select()
      .from(schema.songs)
      .where(eq(schema.songs.filePath, filePath))
      .limit(1);

    // 如果文件路径已存在：增量补全缺失的内嵌歌词（不影响其它字段），
    // 使重扫一次即可为老歌补齐歌词；已有 lyricsPath 的歌直接跳过，零开销
    if (existingSong.length > 0) {
      const song = existingSong[0];
      if (!song.lyricsPath && fileType === 'audio') {
        try {
          const tags = await parseAudioTags(filePath);
          if (typeof tags?.lyrics === 'string' && tags.lyrics.trim()) {
            const embeddedPath = path
              .join(
                path.dirname(filePath),
                path.basename(filePath, path.extname(filePath)) + '.lrc',
              )
              .replace(/\\/g, '/');
            await fs.mkdir(path.dirname(embeddedPath), { recursive: true });
            await fs.writeFile(embeddedPath, tags.lyrics, 'utf-8');
            await db
              .update(schema.songs)
              .set({ lyricsPath: embeddedPath })
              .where(eq(schema.songs.id, song.id));
            logger.info(`Backfilled embedded lyrics for existing song ${song.id} (${song.title})`);
            return { status: 'updated', songId: song.id };
          }
        } catch (err) {
          logger.warn(`Failed to backfill embedded lyrics for ${filePath}:`, err);
        }
      }
      return { status: 'skipped', reason: '文件已存在' };
    }

    // MD5 哈希去重
    const md5DedupEnabled = await getScanMd5DedupEnabled();
    let fileHash: string | null = null;
    if (md5DedupEnabled && !options?.skipDedup) {
      fileHash = computeFileHash(filePath);
      const hashMatch = await db
        .select()
        .from(schema.songs)
        .where(eq(schema.songs.fileHash, fileHash))
        .limit(1);
      if (hashMatch.length > 0) {
        logger.info(`MD5 dedup: ${filePath} matches existing song ${hashMatch[0].id} (${hashMatch[0].title})`);
        return { status: 'skipped', reason: 'MD5 哈希与库中歌曲重复' };
      }
    }

    // AI 智能去重（本地脚本）已改为在 AI 解析完成后执行（见 dedup-service.ts），
    // 不再在扫描阶段按文件名比对跳过。

    // 解析音频标签（仅对音频文件）
    let tags: AudioTags | null = null;
    if (fileType === 'audio') {
      tags = await parseAudioTags(filePath);
    }

    // 无论是否开启 AI，都先用本地元数据（ID3 标签 / 文件名 / 目录）识别并回写；
    // AI 解析结果仅在置信度达标或人工审核通过后覆盖本地数据（见 ai-parse-service）
    const info = await parseSongInfo(filePath);
    let title = info.title;
    let artistId: number | null = null;
    const artistIds: number[] = [];
    let identified = false;

    if (info.artist) {
      artistId = await findOrCreateArtist(info.artist);
      identified = true;
    }
    if (artistId) artistIds.push(artistId);

    // 合作歌手（`&`/`、` 分隔）：主歌手之外依次写入 song_artists（position 0 为主歌手）
    for (const name of info.secondaryArtists) {
      const aid = await findOrCreateArtist(name);
      if (aid && !artistIds.includes(aid)) artistIds.push(aid);
    }

    // 歌手兜底：没有歌手的歌曲分配到「未知歌手」
    if (artistIds.length === 0) {
      artistId = await ensureUnknownArtist();
      artistIds.push(artistId);
    }

    // 检查歌词文件（外部同名 .lrc 优先于内嵌歌词）
    const lyricsPath = await checkLyricsFile(filePath);

    // 创建歌曲记录
    const [newSong] = await db
      .insert(schema.songs)
      .values({
        title,
        artistId: artistId,
        filePath: filePath,
        fileType: fileType,
        duration: tags?.duration || 0,
        lyricsPath: lyricsPath,
        fileHash: fileHash,
        // rawTags 仅作标签快照，剥离 lyrics 字段避免整段歌词撑大 DB
        rawTags: tags ? JSON.stringify({ ...tags, lyrics: undefined }) : null
      })
      .returning();

    // 内嵌歌词落地：无外部同名 .lrc 时，把 ID3/m4a 内嵌歌词写入与音频同目录同名的 .lrc
    // 并回写 lyricsPath；扫描优先识别外部同名 .lrc，仅在无外部时才落盘内嵌/后台歌词
    if (!lyricsPath && typeof tags?.lyrics === 'string' && tags.lyrics.trim()) {
      try {
        const embeddedLyricsPath = path
          .join(
            path.dirname(filePath),
            path.basename(filePath, path.extname(filePath)) + '.lrc',
          )
          .replace(/\\/g, '/');
        await fs.mkdir(path.dirname(embeddedLyricsPath), { recursive: true });
        await fs.writeFile(embeddedLyricsPath, tags.lyrics, 'utf-8');
        await db
          .update(schema.songs)
          .set({ lyricsPath: embeddedLyricsPath })
          .where(eq(schema.songs.id, newSong.id));
        logger.info(`Extracted embedded lyrics for song ${newSong.id} (${title})`);
      } catch (err) {
        logger.warn(`Failed to extract embedded lyrics for ${filePath}:`, err);
      }
    }

    // 写入全部歌手关联（主歌手 + 合作歌手）
    await setSongArtists(newSong.id, artistIds);

    // 分类兜底：没有分类的歌曲分配到「未知」分类；识别到歌手信息后移除
    const unknownCategoryItemId = await ensureUnknownCategory();
    await db
      .insert(schema.songCategories)
      .values({
        songId: newSong.id,
        categoryItemId: unknownCategoryItemId,
        source: 'manual' as const,
      });

    if (identified) {
      await removeUnknownCategory(newSong.id);
    }

    // 更新歌手歌曲数量
    if (artistId) {
      await updateArtistSongCount(artistId);
    }

    return { status: 'new', songId: newSong.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing file ${filePath}:`, error);
    return { status: 'error', error: errorMessage };
  }
}

// 扫描文件级结果明细：批量缓冲，每满一批事务写入，避免逐条插入开销
interface PendingScanResult {
  scanId: string;
  filePath: string;
  status: string;
  songId?: number;
  reason?: string;
  error?: string;
}

const SCAN_RESULT_BATCH_SIZE = 100;
let pendingScanResults: PendingScanResult[] = [];

function flushScanResults(): void {
  if (pendingScanResults.length === 0) return;
  const batch = pendingScanResults;
  pendingScanResults = [];
  db.transaction((tx) => {
    for (const r of batch) {
      tx.insert(schema.scanResults)
        .values({
          scanId: r.scanId,
          filePath: r.filePath,
          status: r.status,
          songId: r.songId ?? null,
          reason: r.reason ?? null,
          error: r.error ?? null,
        })
        .run();
    }
  });
}

function recordScanResult(scanId: string, filePath: string, result: ProcessResult): void {
  pendingScanResults.push({
    scanId,
    filePath,
    status: result.status,
    songId: result.songId,
    reason: result.reason,
    error: result.error,
  });
  if (pendingScanResults.length >= SCAN_RESULT_BATCH_SIZE) {
    flushScanResults();
  }
}

/**
 * 扫描目录
 */
export async function scanDirectory(dirPath: string, options?: { 
  scanId?: string;
  forceRescan?: boolean;
}): Promise<void> {
  // 检查是否正在扫描
  if (scanStatus.isScanning) {
    throw new Error('Scan already in progress');
  }
  
  const scanId = options?.scanId || `scan_${Date.now()}`;
  const startTime = Date.now();
  
  // 初始化扫描状态
  scanStatus = {
    isScanning: true,
    scanId,
    startTime,
    currentFile: null,
    processed: 0,
    total: 0,
    newSongs: 0,
    updatedSongs: 0,
    skippedSongs: 0,
    errors: []
  };
  
  // 发送扫描开始事件
  emitProgress({
    type: 'started',
    data: { scanId, scanPath: dirPath, startTime }
  });
  
  try {
    // 确保默认分类已初始化
    if (!(await isDefaultCategoriesInitialized())) {
      await initializeDefaultCategories();
    }
    
    // 查找所有媒体文件
    const files = await glob('**/*.{mp3,flac,m4a,wav,aac,ogg,wma,mp4,mkv,avi,mov,wmv,flv,webm}', {
      cwd: dirPath,
      absolute: true,
      onlyFiles: true,
      caseSensitiveMatch: false
    });
    
    scanStatus.total = files.length;

    logger.info(`Found ${files.length} media files in ${dirPath}`);

    // MD5 去重开启时：先补全历史歌曲缺失的哈希，保证旧歌也能被哈希查重命中
    const md5DedupEnabled = await getScanMd5DedupEnabled();
    if (md5DedupEnabled) {
      try {
        const filled = await backfillFileHashes();
        if (filled > 0) {
          logger.info(`Backfilled MD5 hashes for ${filled} existing songs`);
        }
      } catch (error) {
        logger.error('Backfill file hashes failed:', error);
      }
    }

    // 收集本次扫描新增歌曲 ID，供扫描完成后自动入队分离
    const newSongIds: number[] = [];

    // 处理每个文件
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      scanStatus.currentFile = filePath;
      scanStatus.processed = i + 1;

      // 发送进度更新
      emitProgress({
        type: 'progress',
        data: {
          scanId,
          current: i + 1,
          total: files.length,
          percentage: Math.round(((i + 1) / files.length) * 100),
          currentFile: path.relative(dirPath, filePath)
        }
      });

      // 处理文件
      const result = await processMediaFile(filePath);
      recordScanResult(scanId, filePath, result);

      switch (result.status) {
        case 'new':
          scanStatus.newSongs++;
          if (typeof result.songId === 'number') {
            newSongIds.push(result.songId);
          }
          break;
        case 'updated':
          scanStatus.updatedSongs++;
          break;
        case 'skipped':
          scanStatus.skippedSongs++;
          break;
        case 'error':
          scanStatus.errors.push(filePath);
          break;
      }
    }

    const duration = Date.now() - startTime;

    // 发送扫描完成事件
    emitProgress({
      type: 'completed',
      data: {
        scanId,
        totalSongs: scanStatus.newSongs + scanStatus.updatedSongs + scanStatus.skippedSongs,
        newSongs: scanStatus.newSongs,
        updatedSongs: scanStatus.updatedSongs,
        skippedSongs: scanStatus.skippedSongs,
        duration
      }
    });

    logger.info(`Scan completed: ${scanStatus.newSongs} new, ${scanStatus.updatedSongs} updated, ${scanStatus.skippedSongs} skipped`);

    // MD5 去重开启时：清理库中哈希相同的重复记录（含本次补全后识别出的历史重复）
    if (md5DedupEnabled) {
      try {
        const removed = await cleanupDuplicateHashes();
        if (removed > 0) {
          logger.info(`MD5 dedup: removed ${removed} duplicate song records`);
        }
      } catch (error) {
        logger.error('Cleanup duplicate hashes failed:', error);
      }
    }

    // 扫描完成后自动入队分离任务（错误隔离：不影响扫描结果）
    if (newSongIds.length > 0) {
      try {
        await autoEnqueueSeparation(newSongIds);
      } catch (error) {
        logger.error('Auto separation enqueue failed:', error);
      }

      // 扫描完成后自动入队 AI 解析任务
      try {
        await autoEnqueueAiParse(newSongIds);
      } catch (error) {
        logger.error('Auto AI parse enqueue failed:', error);
      }
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    scanStatus.errors.push(errorMessage);
    
    // 发送扫描失败事件
    emitProgress({
      type: 'failed',
      data: {
        scanId,
        error: errorMessage,
        partialResults: {
          totalSongs: scanStatus.newSongs + scanStatus.updatedSongs + scanStatus.skippedSongs,
          newSongs: scanStatus.newSongs
        }
      }
    });
    
    logger.error('Scan failed:', error);
  } finally {
    // 落盘剩余的明细记录（扫描完成或失败均执行）
    try {
      flushScanResults();
    } catch (error) {
      logger.error('Flush scan results failed:', error);
    }
    // 重置扫描状态
    scanStatus.isScanning = false;
    scanStatus.currentFile = null;
  }
}

/**
 * 读取 settings 表中的字符串配置
 * 优先级：数据库 settings 表 > 回退值
 */
function getSetting(key: string, fallback: string): string {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get();
  return row?.value ?? fallback;
}

/**
 * 判断是否启用扫描后自动分离
 *
 * 配置优先级：
 *   1. 数据库 settings 表 `separation_auto_enable`（'true' / 'false'）
 *   2. 环境变量 `SEPARATION_AUTO_ENABLE`
 *   3. 默认值 'true'（与 docker-compose.yml 一致）
 */
function isAutoSeparationEnabled(): boolean {
  const envDefault = process.env.SEPARATION_AUTO_ENABLE ?? 'true';
  const value = getSetting('separation_auto_enable', envDefault);
  return value === 'true';
}

/**
 * 获取分离模型配置
 *
 * 优先级：数据库 settings 表 `separation_model` > 默认 'htdemucs'
 */
export function getSeparationModel(): SeparationModel {
  const value = getSetting('separation_model', 'htdemucs');
  return SEPARATION_MODELS.includes(value as SeparationModel)
    ? (value as SeparationModel)
    : 'htdemucs';
}

/**
 * 扫描完成后自动将新增歌曲入队分离
 *
 * 错误隔离：单首歌曲入队失败不影响其他歌曲；整体失败由调用方 try/catch 兜底。
 */
async function autoEnqueueSeparation(songIds: number[]): Promise<void> {
  if (!isAutoSeparationEnabled()) {
    return;
  }

  const model = getSeparationModel();
  let enqueued = 0;
  let failed = 0;

  for (const songId of songIds) {
    try {
      separationQueue.enqueue(songId, model);
      enqueued++;
    } catch (error) {
      failed++;
      logger.error(`Auto enqueue failed for song ${songId}:`, error);
    }
  }

  logger.info(
    `Auto separation enqueue: ${enqueued} succeeded, ${failed} failed (model=${model})`,
  );
}

/**
 * 扫描完成后自动将新增歌曲入队 AI 解析
 *
 * 错误隔离：单首歌曲入队失败不影响其他歌曲；整体失败由调用方 try/catch 兜底。
 */
async function autoEnqueueAiParse(songIds: number[]): Promise<void> {
  if (!(await getAutoAiParseEnabled())) {
    return;
  }

  let enqueued = 0;
  let failed = 0;

  for (const songId of songIds) {
    try {
      aiParseQueue.enqueue(songId);
      enqueued++;
    } catch (error) {
      failed++;
      logger.error(`Auto AI parse enqueue failed for song ${songId}:`, error);
    }
  }

  logger.info(`Auto AI parse enqueue: ${enqueued} succeeded, ${failed} failed`);
}
