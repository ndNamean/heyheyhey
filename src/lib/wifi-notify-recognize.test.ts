import { describe, expect, it } from 'vitest';
import {
  isSessionTimeExpired,
  loadActiveSessions,
  recognizeStoreWifi,
} from '../../api/_lib/wifi-notify/recognize.js';

describe('isSessionTimeExpired', () => {
  it('treats empty and invalid expiresAt as not expired', () => {
    expect(isSessionTimeExpired('')).toBe(false);
    expect(isSessionTimeExpired('   ')).toBe(false);
    expect(isSessionTimeExpired('not-a-date')).toBe(false);
  });

  it('expires when timestamp is in the past', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    expect(isSessionTimeExpired('2026-07-30T11:59:59.000Z', now)).toBe(true);
    expect(isSessionTimeExpired('2026-07-30T12:00:01.000Z', now)).toBe(false);
  });
});

describe('recognizeStoreWifi', () => {
  it('recognizes active store wifi with store access and returns no shift/expiry', async () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    };
    const adminDb = {
      query: async () => ({
        storeWifiIps: [{ id: 'w1', storeId: 's1', publicIp: '203.0.113.10', active: true }],
        stores: [{ id: 's1', code: 'OHCM', active: true }],
      }),
    };
    const ctx = {
      role: 'owner',
      roleDefinition: { canAccessAllStores: false },
      storeIds: ['s1'],
      storeIdSet: new Set(['s1']),
    };

    const out = await recognizeStoreWifi(req, adminDb, ctx);
    expect(out.recognized).toBe(true);
    expect(out.reason).toBeNull();
    expect(out.shift).toBeNull();
    expect(out.expiresAt).toBe('');
    expect(out.store?.id).toBe('s1');
  });
});

describe('loadActiveSessions', () => {
  it('keeps non-deactivated sessions when expiresAt is empty', async () => {
    const now = new Date('2026-07-30T12:00:00.000Z');
    const adminDb = {
      query: async () => ({
        notificationActivationSessions: [
          { id: 'a', deactivatedAt: '', expiresAt: '' },
          { id: 'b', deactivatedAt: '', expiresAt: '2026-07-30T13:00:00.000Z' },
          { id: 'c', deactivatedAt: '', expiresAt: '2026-07-30T10:00:00.000Z' },
          { id: 'd', deactivatedAt: '2026-07-30T09:00:00.000Z', expiresAt: '' },
        ],
      }),
    };

    const out = await loadActiveSessions(adminDb, 'u1', 'd1', now);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
