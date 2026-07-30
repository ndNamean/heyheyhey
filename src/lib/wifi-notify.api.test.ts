import { describe, expect, it } from 'vitest';
import { getClientPublicIp } from '../../api/_lib/wifi-notify/request-ip.js';
import { findMatchingActiveWifiIp } from '../../api/_lib/wifi-notify/match.js';
import { shiftOverlapsNow } from '../../api/_lib/wifi-notify/shift-overlap.js';
import {
  isValidExactPublicIp,
  normalizePublicIp,
} from '../../api/_lib/wifi-notify/ip-normalize.js';

describe('wifi-notify ip-normalize (API)', () => {
  it('mirrors public IPv4 validation', () => {
    expect(normalizePublicIp(' 203.0.113.25 ')).toBe('203.0.113.25');
    expect(isValidExactPublicIp('203.0.113.25')).toBe(true);
    expect(isValidExactPublicIp('192.168.0.1')).toBe(false);
  });
});

describe('getClientPublicIp', () => {
  it('uses the leftmost public hop in x-forwarded-for', () => {
    const ip = getClientPublicIp({
      headers: {
        'x-forwarded-for': '203.0.113.50, 10.0.0.1, 172.16.0.2',
      },
    });
    expect(ip).toBe('203.0.113.50');
  });

  it('skips private leading hops until a public IP', () => {
    const ip = getClientPublicIp({
      headers: {
        'x-forwarded-for': '10.0.0.5, 203.0.113.60',
      },
    });
    expect(ip).toBe('203.0.113.60');
  });

  it('falls back to x-real-ip and x-vercel-forwarded-for', () => {
    expect(
      getClientPublicIp({
        headers: { 'x-real-ip': '203.0.113.70' },
      }),
    ).toBe('203.0.113.70');

    expect(
      getClientPublicIp({
        headers: { 'x-vercel-forwarded-for': '203.0.113.80, 10.1.1.1' },
      }),
    ).toBe('203.0.113.80');
  });

  it('returns null when no public IP is present', () => {
    expect(
      getClientPublicIp({
        headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
      }),
    ).toBeNull();
  });
});

describe('findMatchingActiveWifiIp', () => {
  const wifiIps = [
    { id: 'w1', storeId: 's1', publicIp: '203.0.113.10', active: true },
    { id: 'w2', storeId: 's2', publicIp: '203.0.113.20', active: false },
    { id: 'w3', storeId: 's3', publicIp: '203.0.113.30', active: true },
  ];

  it('matches active IP and skips inactive store', () => {
    const stores = {
      s1: { id: 's1', active: true, code: 'A' },
      s3: { id: 's3', active: false, code: 'C' },
    };
    expect(findMatchingActiveWifiIp('203.0.113.10', wifiIps, stores)?.wifiIp.id).toBe(
      'w1',
    );
    expect(findMatchingActiveWifiIp('203.0.113.30', wifiIps, stores)).toBeNull();
    expect(findMatchingActiveWifiIp('203.0.113.20', wifiIps, stores)).toBeNull();
  });
});

describe('shiftOverlapsNow (API)', () => {
  it('handles overnight overlap', () => {
    const shift = { date: '2026-07-30', startTime: '22:00', endTime: '06:00' };
    expect(shiftOverlapsNow(shift, new Date(2026, 6, 31, 1, 0, 0, 0))).toBe(true);
    expect(shiftOverlapsNow(shift, new Date(2026, 6, 31, 6, 0, 0, 0))).toBe(false);
  });
});
