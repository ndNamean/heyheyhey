import { describe, expect, it } from 'vitest';
import {
  isSessionTimeExpired,
  loadActiveSessions,
  recognizeStoreWifi,
  resolveNotificationActivationMethod,
  shouldDeactivateSessionForNetwork,
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

describe('resolveNotificationActivationMethod', () => {
  it('returns explicit method when set', () => {
    expect(
      resolveNotificationActivationMethod({ activationMethod: 'geofence', wifiIpId: '' }),
    ).toBe('geofence');
    expect(
      resolveNotificationActivationMethod({ activationMethod: 'wifi_ip', wifiIpId: 'w1' }),
    ).toBe('wifi_ip');
  });

  it('treats legacy empty method + wifiIpId as wifi_ip', () => {
    expect(resolveNotificationActivationMethod({ wifiIpId: 'w1' })).toBe('wifi_ip');
    expect(resolveNotificationActivationMethod({ activationMethod: '', wifiIpId: 'w1' })).toBe(
      'wifi_ip',
    );
  });

  it('returns empty when neither method nor wifiIpId is set', () => {
    expect(resolveNotificationActivationMethod({ wifiIpId: '' })).toBe('');
    expect(resolveNotificationActivationMethod({})).toBe('');
  });
});

describe('shouldDeactivateSessionForNetwork', () => {
  const session = { storeId: 's1' };

  it('deactivates when recognition is unrecognized', () => {
    expect(
      shouldDeactivateSessionForNetwork(session, {
        recognized: false,
        store: null,
      }),
    ).toBe(true);
  });

  it('keeps session when recognition matches the same store', () => {
    expect(
      shouldDeactivateSessionForNetwork(session, {
        recognized: true,
        store: { id: 's1' },
      }),
    ).toBe(false);
  });

  it('deactivates when recognition is a different store', () => {
    expect(
      shouldDeactivateSessionForNetwork(session, {
        recognized: true,
        store: { id: 's2' },
      }),
    ).toBe(true);
  });

  it('keeps geofence session on IP-only miss (no geo attempt)', () => {
    expect(
      shouldDeactivateSessionForNetwork(
        { storeId: 's1', activationMethod: 'geofence', wifiIpId: '' },
        { recognized: false, store: null, method: null, reason: 'ip_unrecognized' },
      ),
    ).toBe(false);
  });

  it('deactivates geofence session when geo re-verify fails', () => {
    expect(
      shouldDeactivateSessionForNetwork(
        { storeId: 's1', activationMethod: 'geofence', wifiIpId: '' },
        {
          recognized: false,
          store: null,
          method: 'geofence',
          reason: 'outside_geofence',
        },
      ),
    ).toBe(true);
  });

  it('keeps geofence session when geo re-verify matches the same store', () => {
    expect(
      shouldDeactivateSessionForNetwork(
        { storeId: 's1', activationMethod: 'geofence', wifiIpId: '' },
        { recognized: true, store: { id: 's1' }, method: 'geofence' },
      ),
    ).toBe(false);
  });

  it('deactivates geofence session when presence is a different store', () => {
    expect(
      shouldDeactivateSessionForNetwork(
        { storeId: 's1', activationMethod: 'geofence', wifiIpId: '' },
        { recognized: true, store: { id: 's2' }, method: 'geofence' },
      ),
    ).toBe(true);
  });

  it('deactivates wifi_ip session on IP miss (N regression)', () => {
    expect(
      shouldDeactivateSessionForNetwork(
        { storeId: 's1', activationMethod: 'wifi_ip', wifiIpId: 'w1' },
        { recognized: false, store: null, method: null, reason: 'ip_unrecognized' },
      ),
    ).toBe(true);
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
    expect(out.wifiIp?.id).toBe('w1');
  });

  it('does not recognize inactive or missing store on matched IP (N)', async () => {
    const ctx = {
      role: 'owner',
      roleDefinition: { canAccessAllStores: false },
      storeIds: ['s1'],
      storeIdSet: new Set(['s1']),
    };
    const inactive = await recognizeStoreWifi(
      { headers: { 'x-forwarded-for': '203.0.113.10' } },
      {
        query: async () => ({
          storeWifiIps: [{ id: 'w1', storeId: 's1', publicIp: '203.0.113.10', active: true }],
          stores: [{ id: 's1', code: 'OHCM', active: false }],
        }),
      },
      ctx,
    );
    expect(inactive.recognized).toBe(false);
    expect(inactive.reason).toBe('ip_unrecognized');

    const missingStore = await recognizeStoreWifi(
      { headers: { 'x-forwarded-for': '203.0.113.10' } },
      {
        query: async () => ({
          storeWifiIps: [{ id: 'w1', storeId: 's1', publicIp: '203.0.113.10', active: true }],
          stores: [],
        }),
      },
      ctx,
    );
    expect(missingStore.recognized).toBe(false);
    expect(missingStore.reason).toBe('store_inactive');
  });

  it('rejects matched IP without store access (N)', async () => {
    const out = await recognizeStoreWifi(
      { headers: { 'x-forwarded-for': '203.0.113.10' } },
      {
        query: async () => ({
          storeWifiIps: [{ id: 'w1', storeId: 's1', publicIp: '203.0.113.10', active: true }],
          stores: [{ id: 's1', code: 'OHCM', active: true }],
        }),
      },
      {
        role: 'staff',
        roleDefinition: { canAccessAllStores: false },
        storeIds: ['s2'],
        storeIdSet: new Set(['s2']),
      },
    );
    expect(out.recognized).toBe(false);
    expect(out.reason).toBe('no_store_access');
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
