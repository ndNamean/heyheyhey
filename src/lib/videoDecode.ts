/**
 * Best-effort video metadata decode for Community attachment preflight.
 * Client UX only — grant/Instant cannot see duration.
 * When `HTMLVideoElement` is missing (or jsdom), skip so tests / SSR are not blocked.
 */

import { CHAT_VIDEO_MAX_DURATION_SECONDS } from './chatAttachmentPolicy';

export type VideoDecodeResult =
  | { status: 'ok'; width: number; height: number; duration: number }
  | { status: 'unprocessable' }
  | { status: 'too_long' }
  | { status: 'skipped' };

export function videoDecodeIsAvailable(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return false;
  }
  if (typeof HTMLVideoElement === 'undefined') return false;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
    return false;
  }
  return true;
}

function revokeUrl(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

function cleanupVideo(video: HTMLVideoElement, url: string) {
  try {
    video.pause();
  } catch {
    /* ignore */
  }
  video.removeAttribute('src');
  video.src = '';
  try {
    video.load();
  } catch {
    /* ignore */
  }
  revokeUrl(url);
}

export function decodeVideoMetadata(
  blob: Blob,
  maxDurationSeconds = CHAT_VIDEO_MAX_DURATION_SECONDS,
): Promise<VideoDecodeResult> {
  if (!videoDecodeIsAvailable()) {
    return Promise.resolve({ status: 'skipped' });
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve({ status: 'skipped' });
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const timer = window.setTimeout(() => finish({ status: 'unprocessable' }), 8000);

    const finish = (result: VideoDecodeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      cleanupVideo(video, url);
      resolve(result);
    };

    video.onloadedmetadata = () => {
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      const duration = Number(video.duration);
      if (!(width > 0 && height > 0) || !Number.isFinite(duration) || duration <= 0) {
        finish({ status: 'unprocessable' });
        return;
      }
      if (duration > maxDurationSeconds) {
        finish({ status: 'too_long' });
        return;
      }
      finish({ status: 'ok', width, height, duration });
    };
    video.onerror = () => {
      finish({ status: 'unprocessable' });
    };
    video.src = url;
  });
}
