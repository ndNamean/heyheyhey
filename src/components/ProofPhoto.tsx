import { useEffect, useState } from 'react';
import type { MediaRecord } from '../types';

interface Props {
  media: MediaRecord;
  className?: string;
}

export default function ProofPhoto({ media, className = '' }: Props) {
  const directUrl = media.fileUrl || media.file?.url || '';
  const [url, setUrl] = useState(directUrl);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    directUrl ? 'ready' : 'idle',
  );

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
        <div className="proof-photo-removed-title">Photo removed</div>
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
        Loading photo…
      </div>
    );
  }

  if (status === 'error' || !url) {
    return (
      <div className={`proof-photo-missing${className ? ` ${className}` : ''}`}>
        Photo unavailable
        {media.photoCode && <span className="proof-photo-code">{media.photoCode}</span>}
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
      <img src={url} alt={media.fileName || media.photoCode || 'Proof photo'} />
    </a>
  );
}
