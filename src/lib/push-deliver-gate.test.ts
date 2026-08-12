import { describe, expect, it } from 'vitest';
import {
  evaluateDeliveryGates,
  normalizeNotificationIds,
} from '../../api/_lib/push/deliver-gate.js';

describe('normalizeNotificationIds', () => {
  it('dedupes and trims', () => {
    expect(normalizeNotificationIds([' a ', 'a', 'b', '', null])).toEqual(['a', 'b']);
  });

  it('returns empty for non-arrays', () => {
    expect(normalizeNotificationIds(null)).toEqual([]);
    expect(normalizeNotificationIds('x')).toEqual([]);
  });
});

describe('evaluateDeliveryGates', () => {
  const base = {
    notification: { id: 'n1', storeId: 's1', title: 'Hi', body: 'Body' },
    session: {
      id: 'sess1',
      storeId: 's1',
      wifiIpId: 'w1',
      subscriptionId: 'sub1',
      deactivatedAt: '',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      deviceId: 'd1',
    },
    subscription: {
      id: 'sub1',
      endpoint: 'https://push.example/x',
      p256dh: 'p',
      auth: 'a',
      revokedAt: '',
    },
    wifiIp: { id: 'w1', active: true },
    store: { id: 's1', active: true },
    hasStoreAccess: true,
    now: new Date(),
  };

  it('allows when all gates pass', () => {
    expect(evaluateDeliveryGates(base)).toEqual({ allow: true, reason: null });
  });

  it('allows explicit wifi_ip method with active wifiIp (N)', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: { ...base.session, activationMethod: 'wifi_ip', expiresAt: '' },
      }),
    ).toEqual({ allow: true, reason: null });
  });

  it('wifi_ip still requires active wifiIp even with empty expiresAt (N)', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: { ...base.session, activationMethod: 'wifi_ip', expiresAt: '' },
        wifiIp: { id: 'w1', active: false },
      }).reason,
    ).toBe('wifi_ip_inactive');
    expect(
      evaluateDeliveryGates({
        ...base,
        session: { ...base.session, activationMethod: 'wifi_ip', expiresAt: '' },
        wifiIp: null,
      }).reason,
    ).toBe('wifi_ip_inactive');
  });

  it('suppresses without session', () => {
    expect(evaluateDeliveryGates({ ...base, session: null }).reason).toBe(
      'no_active_session',
    );
  });

  it('suppresses expired session', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: {
          ...base.session,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      }).reason,
    ).toBe('session_expired');
  });

  it('allows empty expiresAt (no time expiry)', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: { ...base.session, expiresAt: '' },
      }),
    ).toEqual({ allow: true, reason: null });
  });

  it('suppresses store mismatch', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        notification: { ...base.notification, storeId: 'other' },
      }).reason,
    ).toBe('store_mismatch');
  });

  it('suppresses revoked subscription', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        subscription: { ...base.subscription, revokedAt: new Date().toISOString() },
      }).reason,
    ).toBe('subscription_missing');
  });

  it('suppresses inactive wifi / store / access', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        wifiIp: { id: 'w1', active: false },
      }).reason,
    ).toBe('wifi_ip_inactive');
    expect(
      evaluateDeliveryGates({
        ...base,
        store: { id: 's1', active: false },
      }).reason,
    ).toBe('store_inactive');
    expect(evaluateDeliveryGates({ ...base, hasStoreAccess: false }).reason).toBe(
      'store_access_denied',
    );
  });

  it('legacy session without activationMethod still requires wifiIp', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: { ...base.session, activationMethod: '', expiresAt: '' },
        wifiIp: null,
      }).reason,
    ).toBe('wifi_ip_inactive');
  });

  it('allows geofence session with empty wifiIpId and no wifiIp row', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: {
          ...base.session,
          activationMethod: 'geofence',
          wifiIpId: '',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        wifiIp: null,
      }),
    ).toEqual({ allow: true, reason: null });
  });

  it('suppresses expired geofence session', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: {
          ...base.session,
          activationMethod: 'geofence',
          wifiIpId: '',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
        wifiIp: null,
      }).reason,
    ).toBe('session_expired');
  });

  it('suppresses geofence session with empty expiresAt', () => {
    expect(
      evaluateDeliveryGates({
        ...base,
        session: {
          ...base.session,
          activationMethod: 'geofence',
          wifiIpId: '',
          expiresAt: '',
        },
        wifiIp: null,
      }).reason,
    ).toBe('session_expired');
  });

  it('geofence still requires store match, active store, and access', () => {
    const geoSession = {
      ...base.session,
      activationMethod: 'geofence' as const,
      wifiIpId: '',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(
      evaluateDeliveryGates({
        ...base,
        session: geoSession,
        wifiIp: null,
        notification: { ...base.notification, storeId: 'other' },
      }).reason,
    ).toBe('store_mismatch');
    expect(
      evaluateDeliveryGates({
        ...base,
        session: geoSession,
        wifiIp: null,
        store: { id: 's1', active: false },
      }).reason,
    ).toBe('store_inactive');
    expect(
      evaluateDeliveryGates({
        ...base,
        session: geoSession,
        wifiIp: null,
        hasStoreAccess: false,
      }).reason,
    ).toBe('store_access_denied');
  });
});
