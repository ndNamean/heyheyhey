/**
 * Client helpers for profile avatar upload / remove / AI background removal.
 */

import { db } from '../db';

async function authHeaders() {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJson(resp: Response) {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(resp.ok ? 'Invalid server response' : `Request failed (${resp.status})`);
    }
  }
  if (!resp.ok) {
    throw Object.assign(new Error(String(data.error || `Request failed (${resp.status})`)), {
      status: resp.status,
      data,
    });
  }
  return data;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function uploadAvatar(blob: Blob, mimeType: string): Promise<{ url: string }> {
  const headers = await authHeaders();
  const fileBase64 = await blobToBase64(blob);
  const resp = await fetch('/api/upload-avatar', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileBase64, mimeType }),
  });
  const data = await parseJson(resp);
  return { url: String(data.url ?? '') };
}

export async function removeAvatar(): Promise<void> {
  const headers = await authHeaders();
  const resp = await fetch('/api/remove-avatar', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  await parseJson(resp);
}

export async function removeBackground(
  blob: Blob,
  mimeType: string,
): Promise<{ blob: Blob; mimeType: string }> {
  const headers = await authHeaders();
  const fileBase64 = await blobToBase64(blob);
  const resp = await fetch('/api/remove-background', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileBase64, mimeType }),
  });
  const data = await parseJson(resp);
  const outMime = String(data.mimeType || 'image/png');
  const outB64 = String(data.fileBase64 || '');
  const binary = atob(outB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: outMime }), mimeType: outMime };
}

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/jpeg,image/jpg,image/png,image/webp';
export const AVATAR_ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export function validateAvatarFile(file: File): string | null {
  const mime = (file.type || '').split(';')[0].trim().toLowerCase();
  if (!AVATAR_ALLOWED_TYPES.has(mime)) {
    return 'unsupportedType';
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'fileTooLarge';
  }
  return null;
}
