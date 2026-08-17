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
      // 以换行合并为单段；空数组/无则置 null
      lyrics: common.lyrics && common.lyrics.length > 0 ? common.lyrics.join('\n') : null
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
