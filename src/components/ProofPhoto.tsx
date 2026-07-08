import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../i18n';
import { isVideoMedia, videoProxyUrl } from '../lib/mediaMime';
import type { MediaRecord } from '../types';

interface Props {
  media: MediaRecord;
  className?: string;
}

export default function ProofPhoto({ media, className = '' }: Props) {
  const { t } = useLang();
  const directUrl = media.fileUrl || media.file?.url || '';
  const [url, setUrl] = useState(directUrl);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    directUrl ? 'ready' : 'idle',
  );
  const [videoError, setVideoError] = useState(false);
  const [useDirectVideo, setUseDirectVideo] = useState(false);
  const isVideo = isVideoMedia(media.mimeType, media.fileName);

  useEffect(() => {
    setVideoError(false);
    setUseDirectVideo(false);
  }, [media.id, directUrl]);

  useEffect(() => {
    if (media.storageDeleted) {
      setStatus('error');
      return;
    }

    if (directUrl) {
      setUrl(directUrl);
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    (async () => {
      try {
        const res = await fetch(`/api/media-url?mediaId=${encodeURIComponent(media.id)}`);
        const data = (await res.json()) as { url?: string; error?: string };
        if (cancelled) return;

        if (res.ok && data.url) {
          setUrl(data.url);
          setStatus('ready');
        } else {
          setStatus('error');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [media.id, media.storageDeleted, directUrl]);

  const videoSrc = useMemo(() => {
    if (!isVideo || !url) return '';
    if (useDirectVideo) return url;
    return videoProxyUrl(media.id);
  }, [isVideo, url, useDirectVideo, media.id]);

  if (media.storageDeleted) {
    return (
      <div className={`proof-photo-removed${className ? ` ${className}` : ''}`}>
        <div className="proof-photo-removed-title">{t.photoSheet.photoRemoved}</div>
        <div className="proof-photo-removed-meta">
          {media.photoCode && <span>{media.photoCode}</span>}
          {media.capturedAt && <span>{media.capturedAt.slice(0, 16)}</span>}
        </div>
      </div>
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className={`proof-photo-loading${className ? ` ${className}` : ''}`}>
        {t.photoSheet.loading}
      </div>
    );
  }

  if (status === 'error' || !url) {
    return (
      <div className={`proof-photo-missing${className ? ` ${className}` : ''}`}>
        {t.photoSheet.photoMissing}
        {media.photoCode && <span className="proof-photo-code">{media.photoCode}</span>}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className={`proof-photo-link proof-photo-video${className ? ` ${className}` : ''}`}>
        {!videoError ? (
          <video
            key={videoSrc}
            src={videoSrc}
            controls
            playsInline
            preload="metadata"
            onError={() => {
              if (!useDirectVideo) {
                setUseDirectVideo(true);
                return;
              }
              setVideoError(true);
            }}
          />
        ) : (
          <div className="proof-video-fallback">
            <p>{t.photoSheet.videoPlaybackFailed}</p>
          </div>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="proof-video-open-link"
        >
          {t.photoSheet.openVideoInNewTab}
        </a>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`proof-photo-link${className ? ` ${className}` : ''}`}
    >
      <img src={url} alt={media.fileName || media.photoCode || t.photoSheet.title} />
    </a>
  );
}
