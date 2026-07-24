import { describe, expect, it } from 'vitest';
import { formatLogbookEntryStamp, ymdInTimeZone } from './proofTime';

const HCM = 'Asia/Ho_Chi_Minh';

describe('ymdInTimeZone', () => {
  it('returns local calendar date near midnight UTC for Asia/Ho_Chi_Minh', () => {
    // 2026-07-23T17:30:00Z = 2026-07-24 00:30 in UTC+7
    const at = new Date('2026-07-23T17:30:00.000Z');
    expect(ymdInTimeZone(at, HCM)).toBe('2026-07-24');
    expect(ymdInTimeZone(at, 'UTC')).toBe('2026-07-23');
  });

  it('stays on the same UTC date before local midnight', () => {
    // 2026-07-23T16:59:00Z = 2026-07-23 23:59 in UTC+7
    const at = new Date('2026-07-23T16:59:00.000Z');
    expect(ymdInTimeZone(at, HCM)).toBe('2026-07-23');
  });
});

describe('formatLogbookEntryStamp', () => {
  it('formats YYYY-MM-DD · HH:MM in the given timezone', () => {
    // 2026-07-23T17:30:00Z → 2026-07-24 · 00:30 in HCM
    expect(formatLogbookEntryStamp('2026-07-23T17:30:00.000Z', HCM)).toBe(
      '2026-07-24 · 00:30',
    );
  });

  it('uses UTC clock when timezone is UTC', () => {
    expect(formatLogbookEntryStamp('2026-07-23T17:30:00.000Z', 'UTC')).toBe(
      '2026-07-23 · 17:30',
    );
  });

  it('returns empty string for missing createdAt', () => {
    expect(formatLogbookEntryStamp(undefined, HCM)).toBe('');
    expect(formatLogbookEntryStamp('', HCM)).toBe('');
  });
});
