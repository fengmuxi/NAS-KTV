import logger from '../logger';
import { loadMusicMetadata } from 'music-metadata';
import * as chardet from 'chardet';
import * as iconv from 'iconv-lite';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AudioTags {
  title: string;
  artist: string;
  album: string;
  year: number | null;
  genre: string;
  track: number | null;
  duration: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
  lossless: boolean;
  /** 内嵌歌词（ID3 USLT / m4a ©lyr / 等），多条（原文+翻译）以换行合并；无则为 null */
  lyrics?: string | null;
}

export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.wma'];
export const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'];

// music-metadata v10+ 为 ESM-only 包，CJS 下必须通过 loadMusicMetadata 动态加载
let musicMetadataModule: Awaited<ReturnType<typeof loadMusicMetadata>> | null = null;

async function getMusicMetadata() {
  if (!musicMetadataModule) {
    musicMetadataModule = await loadMusicMetadata();
  }
  return musicMetadataModule;
}

function fixEncoding(text: string): string {
  if (!text) return '';

  const hasGarbled = /[\ufffd\ufffe\uffff]/.test(text) ||
                     (/[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(text) && !/[À-ÿ]/.test(text));

  if (hasGarbled) {
    const detected = chardet.detect(Buffer.from(text, 'latin1'));
    if (detected && detected !== 'UTF-8' && detected !== 'ASCII') {
      try {
        return iconv.decode(Buffer.from(text, 'latin1'), detected);
      } catch {
        return text;
      }
    }
  }

  return text;
}

/**
 * 把单个 lyrics 元素展开为若干文本行。
 * 支持三种形态：
 *  - 普通字符串（无时间戳）
 *  - 同步歌词对象 { syncText: [{ timestamp(ms), text }] } → 转成 [mm:ss.xx]text 的 LRC 行
 *  - 普通歌词对象 { text | lyrics | content } → 取对应字段
 */
function extractLyricLines(item: unknown): string[] {
  if (typeof item === 'string') return [item];
  if (item == null || typeof item !== 'object') {
    const s = String(item);
    return s === '[object Object]' ? [] : [s];
  }
  const obj = item as Record<string, unknown>;
  // 同步歌词（SYLT）：按时间戳生成 LRC 行
  if (Array.isArray(obj.syncText)) {
    return obj.syncText
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => {
        const text = typeof s.text === 'string' ? s.text : '';
        const ts = typeof s.timestamp === 'number' ? s.timestamp : null;
        if (ts != null && ts >= 0) {
          const totalSec = ts / 1000;
          const mm = Math.floor(totalSec / 60);
          const ss = (totalSec % 60).toFixed(2).padStart(5, '0');
          return `[${String(mm).padStart(2, '0')}:${ss}]${text}`;
        }
        return text;
      })
      .filter((s) => s.length > 0);
  }
  // 非同步歌词对象
  const candidate = obj.text ?? obj.lyrics ?? obj.content ?? obj.unsynchronisedText;
  if (typeof candidate === 'string') return [candidate];
  if (Array.isArray(candidate)) {
    return candidate.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

/**
 * 将 music-metadata 返回的 lyrics 规整为单行字符串（LRC 优先带时间戳）。
 * common.lyrics 通常是 string[]，但个别标签格式（同步歌词 SYLT）会把元素存成对象，
 * 直接 .join 会把对象 coerce 成 "[object Object]"。这里逐元素兜底展开，
 * 并过滤掉 "[object Object]" 等无效片段。无任何有效内容时返回 null。
 */
function normalizeLyrics(lyrics: unknown): string | null {
  if (!lyrics) return null;
  const arr = Array.isArray(lyrics) ? lyrics : [lyrics];
  const lines: string[] = [];
  for (const item of arr) lines.push(...extractLyricLines(item));
  const cleaned = lines
    .map((s) => s.replace(/\r\n/g, '\n').trim())
    .filter((s) => s.length > 0 && s !== '[object Object]');
  return cleaned.length > 0 ? cleaned.join('\n') : null;
}

export async function parseAudioTags(filePath: string): Promise<AudioTags | null> {
  try {
    const musicMetadata = await getMusicMetadata();
    const metadata = await musicMetadata.parseFile(filePath, {
      duration: true,
      skipCovers: true
    });

    const { common, format } = metadata;

    return {
      title: fixEncoding(common.title || path.basename(filePath, path.extname(filePath))),
      artist: fixEncoding(common.artist || ''),
      album: fixEncoding(common.album || ''),
      year: common.year || null,
      genre: common.genre?.[0] || '',
      track: common.track?.no || null,
      duration: Math.round(format.duration || 0),
      bitrate: format.bitrate || 0,
      sampleRate: format.sampleRate || 0,
      channels: format.numberOfChannels || 2,
      lossless: format.lossless || false,
      // 内嵌歌词：music-metadata 把 USLT/©lyr 等归一为 string[]（原文+翻译等多条），
      // 个别元素可能是对象，统一规整为单行字符串并过滤无效片段；无则置 null
      lyrics: normalizeLyrics(common.lyrics)
    };
  } catch (error) {
    logger.error(`Failed to parse audio tags: ${filePath}`, error);
    return null;
  }
}

export function isAudioFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

export function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

export function isMediaFile(filePath: string): boolean {
  return isAudioFile(filePath) || isVideoFile(filePath);
}

export function getFileType(filePath: string): 'audio' | 'video' | null {
  if (isAudioFile(filePath)) return 'audio';
  if (isVideoFile(filePath)) return 'video';
  return null;
}
