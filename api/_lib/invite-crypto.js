import { createHash, randomBytes } from 'crypto';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function generateInviteToken() {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function maskEmail(email) {
  const trimmed = String(email || '').trim().toLowerCase();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

export function parseStoreIdsJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function isExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t <= now.getTime();
}
