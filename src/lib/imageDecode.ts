/**
 * Best-effort image decode for attachment preflight.
 * When `Image` is missing (or jsdom), skip so tests / SSR are not blocked.
 */

export type ImageDecodeResult =
  | { status: 'ok'; width: number; height: number }
  | { status: 'unprocessable' }
  | { status: 'skipped' };

export function imageDecodeIsAvailable(): boolean {
  if (typeof Image === 'undefined') return false;
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

export function decodeImageDimensions(blob: Blob): Promise<ImageDecodeResult> {
  if (!imageDecodeIsAvailable()) {
    return Promise.resolve({ status: 'skipped' });
  }
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve({ status: 'skipped' });
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      revokeUrl(url);
      if (width > 0 && height > 0) {
        resolve({ status: 'ok', width, height });
      } else {
        resolve({ status: 'unprocessable' });
      }
    };
    img.onerror = () => {
      revokeUrl(url);
      resolve({ status: 'unprocessable' });
    };
    img.src = url;
  });
}
