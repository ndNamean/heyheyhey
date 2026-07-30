import { describe, expect, it } from 'vitest';
import {
  findDuplicateActiveIpAssignment,
  isValidExactPublicIp,
  normalizePublicIp,
  parseShiftWindow,
  shiftOverlapsNow,
} from './storeWifiIp';

describe('normalizePublicIp', () => {
  it('trims and lowercases IPv6', () => {
    expect(normalizePublicIp('  2001:DB8::1  ')).toBe('2001:db8::1');
  });

  it('rejects empty input', () => {
    expect(normalizePublicIp('')).toBeNull();
    expect(normalizePublicIp('   ')).toBeNull();
    expect(normalizePublicIp(null)).toBeNull();
    expect(normalizePublicIp(undefined)).toBeNull();
  });

  it('leaves IPv4 unchanged aside from trim', () => {
    expect(normalizePublicIp(' 203.0.113.25 ')).toBe('203.0.113.25');
  });
});

describe('isValidExactPublicIp', () => {
  it('accepts public IPv4 documentation and real-looking addresses', () => {
    expect(isValidExactPublicIp('203.0.113.25')).toBe(true);
    expect(isValidExactPublicIp('8.8.8.8')).toBe(true);
    expect(isValidExactPublicIp('1.1.1.1')).toBe(true);
  });

  it('rejects private, loopback, and link-local IPv4', () => {
    expect(isValidExactPublicIp('10.0.0.1')).toBe(false);
    expect(isValidExactPublicIp('172.16.0.1')).toBe(false);
    expect(isValidExactPublicIp('172.31.255.255')).toBe(false);
    expect(isValidExactPublicIp('172.15.0.1')).toBe(true);
    expect(isValidExactPublicIp('172.32.0.1')).toBe(true);
    expect(isValidExactPublicIp('192.168.1.1')).toBe(false);
    expect(isValidExactPublicIp('127.0.0.1')).toBe(false);
    expect(isValidExactPublicIp('169.254.1.1')).toBe(false);
    expect(isValidExactPublicIp('0.0.0.0')).toBe(false);
  });

  it('rejects CIDR, wildcards, and malformed IPv4', () => {
    expect(isValidExactPublicIp('203.0.113.0/24')).toBe(false);
    expect(isValidExactPublicIp('203.0.113.*')).toBe(false);
    expect(isValidExactPublicIp('203.0.113')).toBe(false);
    expect(isValidExactPublicIp('203.0.113.256')).toBe(false);
    expect(isValidExactPublicIp('01.2.3.4')).toBe(false);
  });

  it('accepts public IPv6 and rejects loopback / ULA / link-local', () => {
    expect(isValidExactPublicIp('2001:db8::1')).toBe(true);
    expect(isValidExactPublicIp('2606:4700:4700::1111')).toBe(true);
    expect(isValidExactPublicIp('::1')).toBe(false);
    expect(isValidExactPublicIp('::')).toBe(false);
    expect(isValidExactPublicIp('fc00::1')).toBe(false);
    expect(isValidExactPublicIp('fd12:3456::1')).toBe(false);
    expect(isValidExactPublicIp('fe80::1')).toBe(false);
  });

  it('rejects IPv6 CIDR and embedded IPv4 forms', () => {
    expect(isValidExactPublicIp('2001:db8::/32')).toBe(false);
    expect(isValidExactPublicIp('::ffff:203.0.113.1')).toBe(false);
  });
});

describe('findDuplicateActiveIpAssignment', () => {
  const rows = [
    { id: 'a', storeId: 's1', publicIp: '203.0.113.10', active: true },
    { id: 'b', storeId: 's2', publicIp: '203.0.113.20', active: true },
    { id: 'c', storeId: 's3', publicIp: '203.0.113.10', active: false },
    { id: 'd', storeId: 's4', publicIp: ' 203.0.113.30 ', active: true },
  ];

  it('finds another active assignment of the same IP', () => {
    expect(findDuplicateActiveIpAssignment('203.0.113.10', rows)?.id).toBe('a');
    expect(findDuplicateActiveIpAssignment('203.0.113.10', rows, 'a')).toBeNull();
  });

  it('ignores inactive rows and normalizes whitespace', () => {
    expect(findDuplicateActiveIpAssignment('203.0.113.30', rows)?.id).toBe('d');
    expect(findDuplicateActiveIpAssignment('203.0.113.99', rows)).toBeNull();
  });
});

describe('parseShiftWindow / shiftOverlapsNow', () => {
  it('parses a same-day window', () => {
    const window = parseShiftWindow('2026-07-30', '09:00', '17:00');
    expect(window).not.toBeNull();
    expect(window!.start.getHours()).toBe(9);
    expect(window!.end.getHours()).toBe(17);
    expect(window!.end.getDate()).toBe(window!.start.getDate());
  });

  it('treats endTime <= startTime as overnight into the next day', () => {
    const window = parseShiftWindow('2026-07-30', '22:00', '06:00');
    expect(window).not.toBeNull();
    expect(window!.end.getDate()).toBe(window!.start.getDate() + 1);
    expect(window!.end.getHours()).toBe(6);
  });

  it('overlaps when now is inside the window and not at end', () => {
    const shift = { date: '2026-07-30', startTime: '09:00', endTime: '17:00' };
    const mid = new Date(2026, 6, 30, 12, 0, 0, 0);
    const before = new Date(2026, 6, 30, 8, 59, 0, 0);
    const atEnd = new Date(2026, 6, 30, 17, 0, 0, 0);
    expect(shiftOverlapsNow(shift, mid)).toBe(true);
    expect(shiftOverlapsNow(shift, before)).toBe(false);
    expect(shiftOverlapsNow(shift, atEnd)).toBe(false);
  });

  it('overlaps overnight shifts across midnight', () => {
    const shift = { date: '2026-07-30', startTime: '22:00', endTime: '06:00' };
    const late = new Date(2026, 6, 30, 23, 0, 0, 0);
    const earlyNext = new Date(2026, 6, 31, 5, 0, 0, 0);
    const afterEnd = new Date(2026, 6, 31, 6, 0, 0, 0);
    expect(shiftOverlapsNow(shift, late)).toBe(true);
    expect(shiftOverlapsNow(shift, earlyNext)).toBe(true);
    expect(shiftOverlapsNow(shift, afterEnd)).toBe(false);
  });

  it('returns null / false for invalid inputs', () => {
    expect(parseShiftWindow('2026-13-01', '09:00', '17:00')).toBeNull();
    expect(parseShiftWindow('2026-07-30', '25:00', '17:00')).toBeNull();
    expect(
      shiftOverlapsNow({ date: 'bad', startTime: '09:00', endTime: '17:00' }),
    ).toBe(false);
  });
});
