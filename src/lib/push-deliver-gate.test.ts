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
});
