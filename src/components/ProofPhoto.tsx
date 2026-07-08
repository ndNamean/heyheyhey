import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../i18n';
import { isVideoMedia, videoProxyUrl } from '../lib/mediaMime';
import {
  buildReviewProofSnapshot,
  shouldRenderReviewOverlay,
  type ReviewContext,
} from '../lib/proofReviewOverlay';
import { formatMediaCaptureTime } from '../lib/proofTime';
import ProofReviewOverlay from './ProofReviewOverlay';
import type { MediaRecord } from '../types';

interface Props {
  media: MediaRecord;
  className?: string;
  reviewContext?: ReviewContext;
}

function logVideoDebug(tag: string, payload: unknown) {
  if (import.meta.env.DEV) {
    console.debug(`[ProofPhoto] ${tag}`, payload);
  }
}

export default function ProofPhoto({ media, className = '', reviewContext }: Props) {
  const { t } = useLang();
  const directUrl = media.fileUrl || media.file?.url || '';
  const [url, setUrl] = useState(directUrl);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    directUrl ? 'ready' : 'idle',
  );
  const [videoError, setVideoError] = useState(false);
  const [useProxyFallback, setUseProxyFallback] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = isVideoMedia(media.mimeType, media.fileName);

  const showReviewOverlay = useMemo(
    () => shouldRenderReviewOverlay(media, reviewContext),
    [media, reviewContext],
  );

  const legacyProof = useMemo(
    () => (showReviewOverlay ? buildReviewProofSnapshot(media, reviewContext) : null),
    [showReviewOverlay, media, reviewContext],
  );

  useEffect(() => {
    setVideoError(false);
    setUseProxyFallback(false);
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
    if (useProxyFallback) return videoProxyUrl(media.id);
    return url;
  }, [isVideo, url, useProxyFallback, media.id]);

  useEffect(() => {
    if (isVideo && videoSrc) {
      logVideoDebug('VIDEO_INLINE_SRC', { mediaId: media.id, src: videoSrc, useProxyFallback });
    }
  }, [isVideo, videoSrc, useProxyFallback, media.id]);

  function handleVideoError() {
    const el = videoRef.current;
    logVideoDebug('VIDEO_ERROR', {
      code: el?.error?.code,
      message: el?.error?.message,
      src: videoSrc,
    });
    if (!useProxyFallback) {
      setUseProxyFallback(true);
      return;
    }
    setVideoError(true);
  }

  function renderLegacyOverlay() {
    if (!showReviewOverlay || !legacyProof) return null;
    return <ProofReviewOverlay proof={legacyProof} />;
  }

  if (media.storageDeleted) {
    return (
      <div className={`proof-photo-removed${className ? ` ${className}` : ''}`}>
        <div className="proof-photo-removed-title">{t.photoSheet.photoRemoved}</div>
        <div className="proof-photo-removed-meta">
          {media.photoCode && <span>{media.photoCode}</span>}
          {media.capturedAt && <span>{formatMediaCaptureTime(media)}</span>}
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
        <div className="proof-media-frame">
          <div className="proof-video-player">
            {!videoError ? (
              <video
                ref={videoRef}
                key={videoSrc}
                src={videoSrc}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={() => logVideoDebug('VIDEO_LOADED_METADATA', { src: videoSrc })}
                onCanPlay={() => logVideoDebug('VIDEO_CAN_PLAY', { src: videoSrc })}
                onPlay={() => logVideoDebug('VIDEO_PLAY_ATTEMPT', { src: videoSrc })}
                onError={handleVideoError}
              />
            ) : (
              <div className="proof-video-fallback">
                <p>{t.photoSheet.videoPlaybackFailed}</p>
              </div>
            )}
          </div>
          {renderLegacyOverlay()}
        </div>
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
      <div className="proof-media-frame">
        <img src={url} alt={media.fileName || media.photoCode || t.photoSheet.title} />
        {renderLegacyOverlay()}
      </div>
    </a>
  );
}
