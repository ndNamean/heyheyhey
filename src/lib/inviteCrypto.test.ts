import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

function hashInviteToken(token: string) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function maskEmail(email: string) {
  const trimmed = String(email || '').trim().toLowerCase();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

describe('invite token helpers', () => {
  it('hashes tokens stably and does not equal plaintext', () => {
    const token = 'abc123-invite-token';
    const hash = hashInviteToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hashInviteToken(token)).toBe(hash);
    expect(hashInviteToken('other')).not.toBe(hash);
  });

  it('masks emails without exposing full local part', () => {
    expect(maskEmail('alice@example.com')).toBe('al***@example.com');
    expect(maskEmail('a@x.co')).toBe('a***@x.co');
  });
});
