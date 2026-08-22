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
import FloatableVideo from './media-interaction/FloatableVideo';
import ZoomableImage from './media-interaction/ZoomableImage';
import type { MediaRecord } from '../types';

/** Full media record or thin $files-linked shape (e.g. logbookEntryPhoto). */
export type ProofPhotoMedia = Partial<MediaRecord> & {
  id: string;
  url?: string;
};

interface Props {
  media: ProofPhotoMedia;
  className?: string;
  reviewContext?: ReviewContext;
  /** Desktop hover float for inline videos. Photo Sheet thumbs pass false. */
  enableVideoFloat?: boolean;
}

function logVideoDebug(tag: string, payload: unknown) {
  if (import.meta.env.DEV) {
    console.debug(`[ProofPhoto] ${tag}`, payload);
  }
}

/** Instant $files CDN URLs carry a CloudFront Policy; stale ones 403 in Console. */
function instantSignedUrlExpirySec(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)instantdb\.(com|io)$/i.test(parsed.hostname)) return null;
    const raw = parsed.searchParams.get('Policy');
    if (!raw) return null;
    let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const policy = JSON.parse(atob(b64)) as {
      Statement?: Array<{
        Condition?: { DateLessThan?: { 'AWS:EpochTime'?: number } };
      }>;
    };
    const exp = policy.Statement?.[0]?.Condition?.DateLessThan?.['AWS:EpochTime'];
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

function isExpiredInstantFileUrl(url: string): boolean {
  const exp = instantSignedUrlExpirySec(url);
  if (exp == null) return false;
  return exp <= Date.now() / 1000 + 30;
}

const PROXY_MAX = 4;
let proxyInflight = 0;
const proxyWaiters: Array<() => void> = [];

function acquireProxySlot(): Promise<void> {
  if (proxyInflight < PROXY_MAX) {
    proxyInflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    proxyWaiters.push(() => {
      proxyInflight += 1;
      resolve();
    });
  });
}

function releaseProxySlot() {
  proxyInflight = Math.max(0, proxyInflight - 1);
  const next = proxyWaiters.shift();
  if (next) next();
}

export default function ProofPhoto({
  media,
  className = '',
  reviewContext,
  enableVideoFloat = true,
}: Props) {
  const { t } = useLang();
  const rawDirectUrl = media.fileUrl || media.url || media.file?.url || '';
  const directUrl = rawDirectUrl && !isExpiredInstantFileUrl(rawDirectUrl) ? rawDirectUrl : '';
  const [url, setUrl] = useState(directUrl);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    directUrl ? 'ready' : 'idle',
  );
  const [videoError, setVideoError] = useState(false);
  const [useProxyFallback, setUseProxyFallback] = useState(false);
  const needsProxy = !directUrl || useProxyFallback;
  const [allowProxy, setAllowProxy] = useState(
    () => !needsProxy || typeof IntersectionObserver === 'undefined',
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = isVideoMedia(media.mimeType, media.fileName);

  const showReviewOverlay = useMemo(
    () =>
      !!(media.lat != null && media.proofMetadataJson != null) &&
      shouldRenderReviewOverlay(media as MediaRecord, reviewContext),
    [media, reviewContext],
  );

  const legacyProof = useMemo(
    () =>
      showReviewOverlay
        ? buildReviewProofSnapshot(media as MediaRecord, reviewContext)
        : null,
    [showReviewOverlay, media, reviewContext],
  );

  useEffect(() => {
    setVideoError(false);
    setUseProxyFallback(false);
    setAllowProxy(!!directUrl || typeof IntersectionObserver === 'undefined');
  }, [directUrl, media.id]);

  useEffect(() => {
    if (useProxyFallback) setAllowProxy(true);
  }, [useProxyFallback]);

  useEffect(() => {
    if (!needsProxy || allowProxy) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setAllowProxy(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setAllowProxy(true);
      },
      { rootMargin: '240px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [allowProxy, media.id, needsProxy]);

  useEffect(() => {
    if (media.storageDeleted) {
      setStatus('error');
      return;
    }

    if (directUrl && !useProxyFallback) {
      setUrl(directUrl);
      setStatus('ready');
      return;
    }

    if (!allowProxy) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let acquired = false;
    setStatus('loading');

    (async () => {
      try {
        await acquireProxySlot();
        acquired = true;
        if (cancelled) return;
        const res = await fetch(`/api/image-proxy?mediaId=${encodeURIComponent(media.id)}`);
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
      } finally {
        if (acquired) releaseProxySlot();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowProxy, media.id, media.storageDeleted, directUrl, rawDirectUrl, useProxyFallback]);

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
          {media.capturedAt && (
            <span>{formatMediaCaptureTime(media as MediaRecord)}</span>
          )}
        </div>
      </div>
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div
        ref={hostRef}
        className={`proof-photo-loading${className ? ` ${className}` : ''}`}
      >
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
        <FloatableVideo enableFloat={enableVideoFloat} resetKey={`${media.id}:${videoSrc}`}>
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
        </FloatableVideo>
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

  const alt = media.fileName || media.photoCode || t.photoSheet.title;

  return (
    <div className={`proof-photo-link${className ? ` ${className}` : ''}`}>
      <div className="proof-media-frame">
        <ZoomableImage
          alt={alt}
          ariaLabel={t.photoSheet.zoomImage.replace('{alt}', alt)}
          resetKey={`${media.id}:${url}`}
        >
          <img
            src={url}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => {
              if (!useProxyFallback) setUseProxyFallback(true);
              else setStatus('error');
            }}
          />
          {renderLegacyOverlay()}
        </ZoomableImage>
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="proof-photo-open-original">
        {t.photoSheet.openOriginal}
      </a>
    </div>
  );
}
