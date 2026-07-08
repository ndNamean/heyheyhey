import { useEffect, useState } from 'react';
import { useLang } from '../i18n';
import type { MediaRecord } from '../types';

interface Props {
  media: MediaRecord;
  className?: string;
}

function isVideoMedia(media: MediaRecord): boolean {
  return media.mimeType?.startsWith('video/') ?? /\.(webm|mp4|mov)(\?|$)/i.test(media.fileName ?? '');
}

export default function ProofPhoto({ media, className = '' }: Props) {
  const { t } = useLang();
  const directUrl = media.fileUrl || media.file?.url || '';
  const [url, setUrl] = useState(directUrl);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    directUrl ? 'ready' : 'idle',
  );
  const isVideo = isVideoMedia(media);

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
      <div className={`proof-photo-link${className ? ` ${className}` : ''}`}>
        <video src={url} controls playsInline preload="metadata" />
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
