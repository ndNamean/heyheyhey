import { describe, expect, it } from 'vitest';
import {
  ALL_DAYS_OF_WEEK,
  DISABLED_SCHEDULE,
  parseTemplateSchedule,
  schedulesEqual,
  serializeTemplateSchedule,
  summarizeSchedule,
  validateTemplateSchedule,
  type TemplateSchedule,
} from './templateSchedule';

describe('parseTemplateSchedule', () => {
  it('returns disabled for blank input', () => {
    expect(parseTemplateSchedule('')).toEqual(DISABLED_SCHEDULE);
    expect(parseTemplateSchedule(null)).toEqual(DISABLED_SCHEDULE);
    expect(parseTemplateSchedule(undefined)).toEqual(DISABLED_SCHEDULE);
    expect(parseTemplateSchedule('   ')).toEqual(DISABLED_SCHEDULE);
  });

  it('parses legacy { enabled: false }', () => {
    expect(parseTemplateSchedule(JSON.stringify({ enabled: false }))).toEqual({
      version: 2,
      enabled: false,
    });
  });

  it('parses valid v2 daily schedule', () => {
    const raw = JSON.stringify({
      version: 2,
      enabled: true,
      recurrence: 'daily',
      timezone: 'Asia/Ho_Chi_Minh',
      daily: { daysOfWeek: [1, 2, 3, 4, 5] },
      itemDueTimes: { 'item-1': '10:00' },
      effectiveFrom: '2026-07-15T00:00:00+07:00',
    });
    const parsed = parseTemplateSchedule(raw);
    expect(parsed.enabled).toBe(true);
    expect(parsed.recurrence).toBe('daily');
    expect(parsed.daily?.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.itemDueTimes?.['item-1']).toBe('10:00');
  });

  it('migrates legacy recurrence shape', () => {
    const parsed = parseTemplateSchedule(
      JSON.stringify({
        enabled: true,
        recurrence: 'daily',
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        dueTime: '09:00',
      }),
    );
    expect(parsed.enabled).toBe(true);
    expect(parsed.recurrence).toBe('daily');
    expect(parsed.daily?.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('falls back safely on malformed JSON', () => {
    expect(parseTemplateSchedule('{not-json')).toEqual(DISABLED_SCHEDULE);
    expect(parseTemplateSchedule('[]')).toEqual(DISABLED_SCHEDULE);
  });

  it('falls back when recurrence is missing but enabled', () => {
    const parsed = parseTemplateSchedule(
      JSON.stringify({ version: 2, enabled: true }),
    );
    expect(parsed.enabled).toBe(true);
    expect(parsed.recurrence).toBeUndefined();
  });
});

describe('serializeTemplateSchedule', () => {
  it('serializes disabled as versioned false', () => {
    expect(serializeTemplateSchedule(DISABLED_SCHEDULE)).toBe(
      JSON.stringify({ version: 2, enabled: false }),
    );
  });

  it('round-trips a monthly last-day schedule', () => {
    const schedule: TemplateSchedule = {
      version: 2,
      enabled: true,
      recurrence: 'monthly',
      timezone: 'Asia/Ho_Chi_Minh',
      monthly: { dayOfMonth: 'last' },
      itemDueTimes: { a: '22:00' },
      effectiveFrom: '2026-07-01T00:00:00+07:00',
    };
    const again = parseTemplateSchedule(serializeTemplateSchedule(schedule));
    expect(again.monthly?.dayOfMonth).toBe('last');
    expect(again.itemDueTimes?.a).toBe('22:00');
  });
});

describe('summarizeSchedule', () => {
  it('summarizes daily every-day', () => {
    expect(
      summarizeSchedule({
        version: 2,
        enabled: true,
        recurrence: 'daily',
        daily: { daysOfWeek: [...ALL_DAYS_OF_WEEK] },
        itemDueTimes: { x: '09:00' },
      }),
    ).toBe('Daily · Monday–Sunday · Item deadlines vary');
  });

  it('summarizes weekly Monday', () => {
    expect(
      summarizeSchedule({
        version: 2,
        enabled: true,
        recurrence: 'weekly',
        weekly: { dayOfWeek: 1 },
      }),
    ).toBe('Weekly · Every Monday · No item deadlines');
  });

  it('summarizes monthly last day', () => {
    expect(
      summarizeSchedule({
        version: 2,
        enabled: true,
        recurrence: 'monthly',
        monthly: { dayOfMonth: 'last' },
        itemDueTimes: { a: '12:00' },
      }),
    ).toBe('Monthly · Last day · Item deadlines vary');
  });

  it('summarizes disabled', () => {
    expect(summarizeSchedule(DISABLED_SCHEDULE)).toBe('Schedule disabled');
  });
});

describe('schedulesEqual', () => {
  it('treats identical schedules as equal', () => {
    const a: TemplateSchedule = {
      version: 2,
      enabled: true,
      recurrence: 'weekly',
      timezone: 'Asia/Ho_Chi_Minh',
      weekly: { dayOfWeek: 1 },
      itemDueTimes: { i1: '10:00' },
      effectiveFrom: '2026-07-15T00:00:00+07:00',
    };
    const b = parseTemplateSchedule(serializeTemplateSchedule(a));
    expect(schedulesEqual(a, b)).toBe(true);
  });

  it('detects structural change', () => {
    const a: TemplateSchedule = {
      version: 2,
      enabled: true,
      recurrence: 'weekly',
      weekly: { dayOfWeek: 1 },
      timezone: 'Asia/Ho_Chi_Minh',
    };
    const b: TemplateSchedule = {
      ...a,
      weekly: { dayOfWeek: 5 },
    };
    expect(schedulesEqual(a, b)).toBe(false);
  });

  it('detects disabled vs enabled', () => {
    expect(
      schedulesEqual(DISABLED_SCHEDULE, {
        version: 2,
        enabled: true,
        recurrence: 'daily',
        daily: { daysOfWeek: [...ALL_DAYS_OF_WEEK] },
      }),
    ).toBe(false);
  });
});

describe('validateTemplateSchedule', () => {
  it('allows disabled with no items', () => {
    expect(validateTemplateSchedule(DISABLED_SCHEDULE, [])).toEqual([]);
  });

  it('requires completion times for required items when enabled', () => {
    const issues = validateTemplateSchedule(
      {
        version: 2,
        enabled: true,
        recurrence: 'daily',
        timezone: 'Asia/Ho_Chi_Minh',
        daily: { daysOfWeek: [1] },
        effectiveFrom: '2026-07-15T00:00:00+07:00',
        itemDueTimes: {},
      },
      [
        { id: 'a', required: true },
        { id: 'b', required: false },
      ],
    );
    expect(issues.some((i) => i.field === 'itemDueTime:a')).toBe(true);
    expect(issues.some((i) => i.field === 'itemDueTime:b')).toBe(false);
  });
});
