/* Hallmark · component: video-preview-modal · genre: modern-minimal · theme: Cobalt
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * contrast: pass (AA on paper/ink pairings)
 */

import { useRef, useEffect, useState } from 'react';
import Modal from './Modal';
import AudioPlayer from './AudioPlayer';
import { Film, Music, Mic } from 'lucide-react';

interface VideoPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  songId: number;
  songTitle: string;
  separationStatus?: string | null;
}

export default function VideoPreviewModal({
  isOpen,
  onClose,
  songId,
  songTitle,
  separationStatus,
}: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 视频容器宽高比，跟随视频自身比例，避免横/竖屏视频出现难看黑条
  const [aspect, setAspect] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    // 重新打开时重置，等待新视频 metadata
    if (isOpen) setAspect(undefined);
  }, [isOpen]);

  if (!isOpen) return null;

  const showSeparated = separationStatus === 'completed';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="MV 预览" size="lg">
      <div className="space-y-md">
        <div className="flex items-center gap-xs">
          <Film className="w-4 h-4 text-accent" />
          <p className="text-sm text-ink-2 truncate" title={songTitle}>
            {songTitle}
          </p>
        </div>

        <div
          className="relative w-full bg-black rounded-lg overflow-hidden mx-auto"
          style={{
            aspectRatio: aspect ?? '16/9',
            maxHeight: 'min(60vh, 560px)',
          }}
        >
          <video
            ref={videoRef}
            src={`/api/songs/${songId}/audio`}
            controls
            autoPlay
            className="w-full h-full object-contain"
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) {
                setAspect(`${v.videoWidth}/${v.videoHeight}`);
              }
            }}
          >
            您的浏览器不支持视频播放
          </video>
        </div>

        {showSeparated && (
          <div className="grid grid-cols-2 gap-sm pt-xs border-t border-border">
            <div className="space-y-xs">
              <div className="flex items-center gap-xs">
                <Music className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-medium text-ink-3 uppercase tracking-wide">
                  伴奏
                </span>
              </div>
              <AudioPlayer
                src={`/api/songs/${songId}/instrumental`}
                label="伴奏音频"
                accentColor="instrumental"
              />
            </div>
            <div className="space-y-xs">
              <div className="flex items-center gap-xs">
                <Mic className="w-3.5 h-3.5 text-warning" />
                <span className="text-xs font-medium text-ink-3 uppercase tracking-wide">
                  人声
                </span>
              </div>
              <AudioPlayer
                src={`/api/songs/${songId}/vocals`}
                label="人声音频"
                accentColor="vocals"
              />
            </div>
          </div>
        )}

        {separationStatus && !showSeparated && (
          <div className="text-xs text-ink-3 bg-paper-2 rounded-md p-sm border border-border">
            {separationStatus === 'processing'
              ? '人声分离处理中，完成后可试听伴奏和人声。'
              : '该歌曲尚未完成人声分离，仅可预览原视频。'}
          </div>
        )}
      </div>
    </Modal>
  );
}