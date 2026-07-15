import { describe, expect, it } from 'vitest';
import {
  buildScheduleCaptureForItem,
  buildScheduleOccurrenceKey,
  findDuplicateOccurrenceKeys,
  getScheduledDueAt,
  isScheduledDateForSchedule,
  isoWeekPeriodToken,
  lastDayOfMonth,
  resolveActiveScheduleVersion,
  weekdayOfYmd,
  type TemplateSchedule,
} from './templateSchedule';

const dailySchedule: TemplateSchedule = {
  version: 2,
  enabled: true,
  recurrence: 'daily',
  timezone: 'Asia/Ho_Chi_Minh',
  daily: { daysOfWeek: [1, 2, 3, 4, 5] },
  itemDueTimes: { itemA: '10:00', itemB: '14:30' },
  effectiveFrom: '2026-07-01T00:00:00+07:00',
};

describe('buildScheduleOccurrenceKey', () => {
  it('builds daily key with YYYY-MM-DD', () => {
    expect(
      buildScheduleOccurrenceKey({
        templateId: 't1',
        itemId: 'i1',
        storeId: 's1',
        recurrence: 'daily',
        dateYmd: '2026-07-15',
      }),
    ).toBe('t1:i1:s1:2026-07-15');
  });

  it('builds weekly key with ISO week', () => {
    // 2026-07-15 is a Wednesday in ISO week 29
    expect(isoWeekPeriodToken('2026-07-15')).toBe('2026-W29');
    expect(
      buildScheduleOccurrenceKey({
        templateId: 't1',
        itemId: 'i1',
        storeId: 's1',
        recurrence: 'weekly',
        dateYmd: '2026-07-15',
      }),
    ).toBe('t1:i1:s1:2026-W29');
  });

  it('builds monthly key with YYYY-MM', () => {
    expect(
      buildScheduleOccurrenceKey({
        templateId: 't1',
        itemId: 'i1',
        storeId: 's1',
        recurrence: 'monthly',
        dateYmd: '2026-07-28',
      }),
    ).toBe('t1:i1:s1:2026-07');
  });
});

describe('getScheduledDueAt', () => {
  it('formats Asia/Ho_Chi_Minh due timestamp', () => {
    expect(
      getScheduledDueAt({ dateYmd: '2026-07-15', dueTimeHhmm: '09:00' }),
    ).toBe('2026-07-15T09:00:00+07:00');
    expect(
      getScheduledDueAt({ dateYmd: '2026-07-15', dueTimeHhmm: '22:00' }),
    ).toBe('2026-07-15T22:00:00+07:00');
  });
});

describe('isScheduledDateForSchedule', () => {
  it('matches weekdays for daily Mon–Fri', () => {
    // 2026-07-15 = Wednesday
    expect(weekdayOfYmd('2026-07-15')).toBe(3);
    expect(isScheduledDateForSchedule(dailySchedule, '2026-07-15')).toBe(true);
    // 2026-07-18 = Saturday
    expect(isScheduledDateForSchedule(dailySchedule, '2026-07-18')).toBe(false);
  });

  it('respects effectiveFrom', () => {
    expect(isScheduledDateForSchedule(dailySchedule, '2026-06-30')).toBe(false);
  });

  it('matches weekly Monday only', () => {
    const weekly: TemplateSchedule = {
      version: 2,
      enabled: true,
      recurrence: 'weekly',
      weekly: { dayOfWeek: 1 },
      itemDueTimes: { itemA: '10:00' },
      effectiveFrom: '2026-01-01T00:00:00+07:00',
    };
    // 2026-07-13 = Monday
    expect(isScheduledDateForSchedule(weekly, '2026-07-13')).toBe(true);
    expect(isScheduledDateForSchedule(weekly, '2026-07-14')).toBe(false);
  });

  it('matches monthly last day including leap February', () => {
    const monthly: TemplateSchedule = {
      version: 2,
      enabled: true,
      recurrence: 'monthly',
      monthly: { dayOfMonth: 'last' },
      itemDueTimes: { itemA: '10:00' },
      effectiveFrom: '2024-01-01T00:00:00+07:00',
    };
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(isScheduledDateForSchedule(monthly, '2024-02-29')).toBe(true);
    expect(isScheduledDateForSchedule(monthly, '2024-02-28')).toBe(false);
    expect(lastDayOfMonth(2025, 2)).toBe(28);
    expect(isScheduledDateForSchedule(monthly, '2025-02-28')).toBe(true);
  });
});

describe('resolveActiveScheduleVersion', () => {
  it('picks the version whose window covers the date', () => {
    const versions = [
      {
        id: 'v1',
        scheduleJson: JSON.stringify({
          version: 2,
          enabled: true,
          recurrence: 'daily',
          daily: { daysOfWeek: [1, 2, 3, 4, 5, 6, 0] },
          itemDueTimes: { itemA: '10:00' },
        }),
        effectiveFrom: '2026-06-01T00:00:00+07:00',
        effectiveTo: '2026-07-01T00:00:00+07:00',
      },
      {
        id: 'v2',
        scheduleJson: JSON.stringify({
          version: 2,
          enabled: true,
          recurrence: 'daily',
          daily: { daysOfWeek: [1, 2, 3, 4, 5, 6, 0] },
          itemDueTimes: { itemA: '12:00' },
        }),
        effectiveFrom: '2026-07-01T00:00:00+07:00',
        effectiveTo: '',
      },
    ];
    expect(resolveActiveScheduleVersion(versions, '2026-06-15')?.id).toBe('v1');
    expect(resolveActiveScheduleVersion(versions, '2026-07-15')?.id).toBe('v2');
    expect(
      resolveActiveScheduleVersion(versions, '2026-07-15')?.schedule.itemDueTimes?.itemA,
    ).toBe('12:00');
  });
});

describe('buildScheduleCaptureForItem', () => {
  it('captures fields for a completed scheduled item', () => {
    const capture = buildScheduleCaptureForItem({
      templateId: 't1',
      itemId: 'itemA',
      storeId: 's1',
      reportDateYmd: '2026-07-15',
      completedAtIso: '2026-07-15T09:30:00.000Z',
      schedule: dailySchedule,
      scheduleVersionId: 'ver-1',
    });
    expect(capture).toEqual({
      scheduleOccurrenceKey: 't1:itemA:s1:2026-07-15',
      scheduledDueAt: '2026-07-15T10:00:00+07:00',
      firstCompletedAt: '2026-07-15T09:30:00.000Z',
      scheduleVersionId: 'ver-1',
    });
  });

  it('returns null when schedule disabled or wrong day', () => {
    expect(
      buildScheduleCaptureForItem({
        templateId: 't1',
        itemId: 'itemA',
        storeId: 's1',
        reportDateYmd: '2026-07-18', // Saturday
        completedAtIso: '2026-07-18T09:30:00.000Z',
        schedule: dailySchedule,
        scheduleVersionId: 'ver-1',
      }),
    ).toBeNull();
  });
});

describe('findDuplicateOccurrenceKeys', () => {
  it('finds overlapping keys', () => {
    expect(
      findDuplicateOccurrenceKeys(
        ['t1:i1:s1:2026-07-15', 'other'],
        ['t1:i1:s1:2026-07-15', 't1:i2:s1:2026-07-15'],
      ),
    ).toEqual(['t1:i1:s1:2026-07-15']);
  });

  it('returns empty when no overlap', () => {
    expect(findDuplicateOccurrenceKeys(['a'], ['b', 'c'])).toEqual([]);
  });
});
