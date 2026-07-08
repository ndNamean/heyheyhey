/** Strip codec params; use a stable MIME for storage and playback headers. */
export function normalizeStoredMime(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() || '';
  if (base.startsWith('video/')) {
    if (base.includes('mp4')) return 'video/mp4';
    return 'video/webm';
  }
  if (base === 'image/png') return 'image/png';
  if (base.startsWith('image/')) return 'image/jpeg';
  return base || 'application/octet-stream';
}

export function isVideoMime(mime?: string): boolean {
  const base = mime?.split(';')[0]?.trim().toLowerCase() ?? '';
  return base.startsWith('video/');
}

export function isVideoFileName(name?: string): boolean {
  return /\.(webm|mp4|mov)(\?|$)/i.test(name ?? '');
}

export function isVideoMedia(mimeType?: string, fileName?: string): boolean {
  if (isVideoMime(mimeType)) return true;
  return isVideoFileName(fileName);
}

export function videoProxyUrl(mediaId: string): string {
  return `/api/video-proxy?mediaId=${encodeURIComponent(mediaId)}`;
}
