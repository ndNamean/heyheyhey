import { describe, expect, it } from 'vitest';
import {
  calculateScheduledTaskMetrics,
  eachYmdInclusive,
  formatAverageCompletionTime,
  formatLateDuration,
  getScheduledOccurrences,
  resolveFirstCompletedAt,
} from './scheduledTaskMetrics';
import type { Report, ReportResponse, ReviewEvent, Template } from '../types';

function makeTemplate(overrides: Partial<Template> & { id: string; name: string }): Template {
  return {
    reportType: 'Daily',
    scheduleJson: JSON.stringify({ version: 2, enabled: false }),
    active: true,
    createdByUserId: 'u1',
    createdAt: '',
    updatedAt: '',
    items: [],
    stores: [],
    scheduleVersions: [],
    ...overrides,
  };
}

function dailyTemplate(): Template {
  return makeTemplate({
    id: 'tmpl-daily',
    name: 'Daily Hygiene',
    scheduleJson: JSON.stringify({
      version: 2,
      enabled: true,
      recurrence: 'daily',
      timezone: 'Asia/Ho_Chi_Minh',
      daily: { daysOfWeek: [1, 2, 3, 4, 5, 6, 0] },
      itemDueTimes: { item1: '10:00' },
      effectiveFrom: '2026-07-01T00:00:00+07:00',
    }),
    items: [
      {
        id: 'item1',
        section: 'Kitchen',
        title: 'Clean sink',
        requirement: '',
        proofType: 'photo',
        required: true,
        assignedRole: 'staff',
        approverRolesJson: '[]',
        weight: 1,
        failureCategory: 'Hygiene',
        sortOrder: 0,
      },
    ],
    stores: [
      {
        id: 'store1',
        code: 'S1',
        name: 'Store 1',
        address: '',
        area: '',
        lat: 0,
        lng: 0,
        geofenceRadiusM: 100,
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ],
  });
}

describe('eachYmdInclusive', () => {
  it('lists days inclusively', () => {
    expect(eachYmdInclusive('2026-07-30', '2026-08-01')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
  });
});

describe('getScheduledOccurrences — daily', () => {
  it('counts every day in a 31-day month', () => {
    const expected = getScheduledOccurrences({
      templates: [dailyTemplate()],
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(expected).toHaveLength(31);
  });

  it('counts weekdays only', () => {
    const tmpl = dailyTemplate();
    tmpl.scheduleJson = JSON.stringify({
      version: 2,
      enabled: true,
      recurrence: 'daily',
      daily: { daysOfWeek: [1, 2, 3, 4, 5] },
      itemDueTimes: { item1: '10:00' },
      effectiveFrom: '2026-07-01T00:00:00+07:00',
    });
    const expected = getScheduledOccurrences({
      templates: [tmpl],
      from: '2026-07-01',
      to: '2026-07-31',
    });
    // July 2026 weekdays: 23
    expect(expected).toHaveLength(23);
  });

  it('respects mid-month range and effectiveFrom', () => {
    const tmpl = dailyTemplate();
    tmpl.scheduleJson = JSON.stringify({
      version: 2,
      enabled: true,
      recurrence: 'daily',
      daily: { daysOfWeek: [1, 2, 3, 4, 5, 6, 0] },
      itemDueTimes: { item1: '10:00' },
      effectiveFrom: '2026-07-15T00:00:00+07:00',
    });
    const expected = getScheduledOccurrences({
      templates: [tmpl],
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(expected).toHaveLength(17); // 15..31
    expect(expected[0].dateYmd).toBe('2026-07-15');
  });

  it('uses different item deadlines', () => {
    const tmpl = dailyTemplate();
    tmpl.items = [
      ...(tmpl.items ?? []),
      {
        id: 'item2',
        section: 'Kitchen',
        title: 'Mop floor',
        requirement: '',
        proofType: 'tick',
        required: true,
        assignedRole: 'staff',
        approverRolesJson: '[]',
        weight: 1,
        failureCategory: 'Hygiene',
        sortOrder: 1,
      },
    ];
    tmpl.scheduleJson = JSON.stringify({
      version: 2,
      enabled: true,
      recurrence: 'daily',
      daily: { daysOfWeek: [1] },
      itemDueTimes: { item1: '09:00', item2: '18:00' },
      effectiveFrom: '2026-07-01T00:00:00+07:00',
    });
    // 2026-07-13 is Monday
    const expected = getScheduledOccurrences({
      templates: [tmpl],
      from: '2026-07-13',
      to: '2026-07-13',
    });
    expect(expected).toHaveLength(2);
    expect(expected.find((e) => e.templateItemId === 'item1')?.dueTimeHhmm).toBe('09:00');
    expect(expected.find((e) => e.templateItemId === 'item2')?.dueTimeHhmm).toBe('18:00');
  });
});

describe('getScheduledOccurrences — weekly', () => {
  it('counts four Mondays in some months and five in others', () => {
    const tmpl = dailyTemplate();
    tmpl.id = 'tmpl-weekly';
    tmpl.scheduleJson = JSON.stringify({
      version: 2,
      enabled: true,
      recurrence: 'weekly',
      weekly: { dayOfWeek: 1 },
      itemDueTimes: { item1: '10:00' },
      effectiveFrom: '2026-01-01T00:00:00+07:00',
    });

    const june = getScheduledOccurrences({
      templates: [tmpl],
      from: '2026-06-01',
      to: '2026-06-30',
    });
    // Mondays in June 2026: 1,8,15,22,29 = 5
    expect(june).toHaveLength(5);

    const feb = getScheduledOccurrences({
      templates: [tmpl],
      from: '2026-02-01',
      to: '2026-02-28',
    });
    // Mondays in Feb 2026: 2,9,16,23 = 4
    expect(feb).toHaveLength(4);
  });
});

describe('getScheduledOccurrences — monthly', () => {
  it('supports day 1, day 28, and last day in leap February', () => {
    const base = dailyTemplate();
    base.id = 'tmpl-monthly';

    const day1 = {
      ...base,
      scheduleJson: JSON.stringify({
        version: 2,
        enabled: true,
        recurrence: 'monthly',
        monthly: { dayOfMonth: 1 },
        itemDueTimes: { item1: '10:00' },
        effectiveFrom: '2024-01-01T00:00:00+07:00',
      }),
    };
    expect(
      getScheduledOccurrences({ templates: [day1], from: '2024-02-01', to: '2024-02-29' }),
    ).toHaveLength(1);

    const day28 = {
      ...base,
      scheduleJson: JSON.stringify({
        version: 2,
        enabled: true,
        recurrence: 'monthly',
        monthly: { dayOfMonth: 28 },
        itemDueTimes: { item1: '10:00' },
        effectiveFrom: '2024-01-01T00:00:00+07:00',
      }),
    };
    expect(
      getScheduledOccurrences({ templates: [day28], from: '2024-02-01', to: '2024-02-29' }),
    ).toHaveLength(1);

    const last = {
      ...base,
      scheduleJson: JSON.stringify({
        version: 2,
        enabled: true,
        recurrence: 'monthly',
        monthly: { dayOfMonth: 'last' },
        itemDueTimes: { item1: '10:00' },
        effectiveFrom: '2024-01-01T00:00:00+07:00',
      }),
    };
    const leap = getScheduledOccurrences({
      templates: [last],
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(leap).toHaveLength(1);
    expect(leap[0].dateYmd).toBe('2024-02-29');

    const nonLeap = getScheduledOccurrences({
      templates: [last],
      from: '2025-02-01',
      to: '2025-02-28',
    });
    expect(nonLeap[0].dateYmd).toBe('2025-02-28');
  });

  it('counts multi-month filters', () => {
    const tmpl = dailyTemplate();
    tmpl.scheduleJson = JSON.stringify({
      version: 2,
      enabled: true,
      recurrence: 'monthly',
      monthly: { dayOfMonth: 1 },
      itemDueTimes: { item1: '10:00' },
      effectiveFrom: '2026-01-01T00:00:00+07:00',
    });
    expect(
      getScheduledOccurrences({
        templates: [tmpl],
        from: '2026-01-01',
        to: '2026-03-31',
      }),
    ).toHaveLength(3);
  });
});

describe('calculateScheduledTaskMetrics — timing', () => {
  function response(partial: Partial<ReportResponse> & { id: string }): ReportResponse {
    return {
      reportId: 'r1',
      templateItemId: 'item1',
      section: 'Kitchen',
      title: 'Clean sink',
      proofType: 'photo',
      required: true,
      assignedRole: 'staff',
      approverRolesJson: '[]',
      weight: 1,
      failureCategory: 'Hygiene',
      ticked: true,
      numberValue: '',
      note: '',
      status: 'waiting_approval',
      rejectionReason: '',
      feedbackCode: '',
      feedbackNote: '',
      submittedByUserId: 'u1',
      submittedByRole: 'staff',
      submittedAt: '',
      approvedByUserId: '',
      approvedAt: '',
      updatedAt: '',
      ...partial,
    };
  }

  function reportWith(responses: ReportResponse[]): Report {
    return {
      id: 'r1',
      storeId: 'store1',
      storeCode: 'S1',
      storeName: 'Store 1',
      templateId: 'tmpl-daily',
      templateName: 'Daily Hygiene',
      reportType: 'Daily',
      reportDate: '2026-07-15',
      submittedByUserId: 'u1',
      submittedByRole: 'staff',
      submittedAt: '2026-07-15T03:00:00.000Z',
      status: 'waiting_approval',
      completionPercent: 100,
      compliancePercent: 0,
      archived: false,
      archiveMonth: '',
      createdAt: '',
      updatedAt: '',
      responses,
    };
  }

  it('marks on-time, exact, and late correctly', () => {
    const expected = getScheduledOccurrences({
      templates: [dailyTemplate()],
      from: '2026-07-15',
      to: '2026-07-15',
    });
    expect(expected).toHaveLength(1);

    const onTime = calculateScheduledTaskMetrics({
      expected,
      reports: [
        reportWith([
          response({
            id: 'resp1',
            scheduleOccurrenceKey: expected[0].occurrenceKey,
            scheduledDueAt: expected[0].scheduledDueAt,
            firstCompletedAt: '2026-07-15T02:30:00.000Z', // 09:30 +07
            submittedAt: '2026-07-15T02:30:00.000Z',
          }),
        ]),
      ],
      events: [],
      now: '2026-07-16T00:00:00.000Z',
    });
    expect(onTime.rows[0].onTime).toBe(1);
    expect(onTime.rows[0].late).toBe(0);

    const exact = calculateScheduledTaskMetrics({
      expected,
      reports: [
        reportWith([
          response({
            id: 'resp1',
            scheduleOccurrenceKey: expected[0].occurrenceKey,
            scheduledDueAt: '2026-07-15T10:00:00+07:00',
            firstCompletedAt: '2026-07-15T03:00:00.000Z', // 10:00 +07
            submittedAt: '2026-07-15T03:00:00.000Z',
          }),
        ]),
      ],
      events: [],
      now: '2026-07-16T00:00:00.000Z',
    });
    expect(exact.rows[0].onTime).toBe(1);

    const late = calculateScheduledTaskMetrics({
      expected,
      reports: [
        reportWith([
          response({
            id: 'resp1',
            scheduleOccurrenceKey: expected[0].occurrenceKey,
            scheduledDueAt: '2026-07-15T10:00:00+07:00',
            firstCompletedAt: '2026-07-15T04:00:00.000Z', // 11:00 +07
            submittedAt: '2026-07-15T04:00:00.000Z',
          }),
        ]),
      ],
      events: [],
      now: '2026-07-16T00:00:00.000Z',
    });
    expect(late.rows[0].late).toBe(1);
    expect(late.rows[0].averageLateDurationMs).toBe(60 * 60 * 1000);
  });

  it('does not count future deadlines as overdue', () => {
    const expected = getScheduledOccurrences({
      templates: [dailyTemplate()],
      from: '2026-07-15',
      to: '2026-07-16',
    });
    // now = morning of July 15 before both deadlines? Use now before July 15 10:00+07
    const result = calculateScheduledTaskMetrics({
      expected,
      reports: [],
      events: [],
      now: '2026-07-15T01:00:00.000Z', // 08:00 +07, before 10:00 deadline on 15th
    });
    // July 15 10:00+07 = 03:00Z — still in future relative to 01:00Z
    expect(result.rows[0].expected).toBe(0);
    expect(result.rows[0].expectedFullPeriod).toBe(2);
    expect(result.rows[0].overdueIncomplete).toBe(0);
  });

  it('counts waiting_approval as completed and uses submitted event for firstCompletedAt', () => {
    const expected = getScheduledOccurrences({
      templates: [dailyTemplate()],
      from: '2026-07-15',
      to: '2026-07-15',
    });
    const events: ReviewEvent[] = [
      {
        id: 'e1',
        reportId: 'r1',
        reportResponseId: 'resp1',
        storeId: 'store1',
        eventType: 'submitted',
        itemTitle: 'Clean sink',
        templateItemId: 'item1',
        sectionSnapshot: 'Kitchen',
        categorySnapshot: 'Hygiene',
        statusAfter: 'waiting_approval',
        previousStatus: 'not_started',
        actorUserId: 'u1',
        actorRole: 'staff',
        actorDisplayNameSnapshot: 'Staff',
        note: '',
        feedbackCode: '',
        feedbackNote: '',
        createdAt: '2026-07-15T02:00:00.000Z',
      },
    ];
    const resp = response({
      id: 'resp1',
      status: 'waiting_approval',
      scheduleOccurrenceKey: expected[0].occurrenceKey,
      scheduledDueAt: expected[0].scheduledDueAt,
      firstCompletedAt: '2026-07-15T02:00:00.000Z',
      submittedAt: '2026-07-15T05:00:00.000Z', // overwritten later — event wins
    });
    expect(resolveFirstCompletedAt(resp, events)).toBe('2026-07-15T02:00:00.000Z');

    const result = calculateScheduledTaskMetrics({
      expected,
      reports: [reportWith([resp])],
      events,
      now: '2026-07-16T00:00:00.000Z',
    });
    expect(result.rows[0].completed).toBe(1);
    expect(result.rows[0].onTime).toBe(1);
  });

  it('does not double-count duplicate occurrence keys', () => {
    const expected = getScheduledOccurrences({
      templates: [dailyTemplate()],
      from: '2026-07-15',
      to: '2026-07-15',
    });
    const key = expected[0].occurrenceKey;
    const r1 = reportWith([
      response({
        id: 'resp1',
        scheduleOccurrenceKey: key,
        scheduledDueAt: expected[0].scheduledDueAt,
        firstCompletedAt: '2026-07-15T02:00:00.000Z',
        submittedAt: '2026-07-15T02:00:00.000Z',
      }),
    ]);
    const r2: Report = {
      ...r1,
      id: 'r2',
      responses: [
        response({
          id: 'resp2',
          scheduleOccurrenceKey: key,
          scheduledDueAt: expected[0].scheduledDueAt,
          firstCompletedAt: '2026-07-15T05:00:00.000Z',
          submittedAt: '2026-07-15T05:00:00.000Z',
        }),
      ],
    };
    const result = calculateScheduledTaskMetrics({
      expected,
      reports: [r1, r2],
      events: [],
      now: '2026-07-16T00:00:00.000Z',
    });
    expect(result.rows[0].completed).toBe(1);
    expect(result.rows[0].completionPercentage).toBe(100);
  });

  it('keeps on-time when later correction exists (first submit wins)', () => {
    const expected = getScheduledOccurrences({
      templates: [dailyTemplate()],
      from: '2026-07-15',
      to: '2026-07-15',
    });
    const events: ReviewEvent[] = [
      {
        id: 'e1',
        reportId: 'r1',
        reportResponseId: 'resp1',
        storeId: 'store1',
        eventType: 'submitted',
        itemTitle: 'Clean sink',
        templateItemId: 'item1',
        sectionSnapshot: '',
        categorySnapshot: '',
        statusAfter: 'waiting_approval',
        previousStatus: '',
        actorUserId: 'u1',
        actorRole: 'staff',
        actorDisplayNameSnapshot: '',
        note: '',
        feedbackCode: '',
        feedbackNote: '',
        createdAt: '2026-07-15T02:00:00.000Z',
      },
      {
        id: 'e2',
        reportId: 'r1',
        reportResponseId: 'resp1',
        storeId: 'store1',
        eventType: 'resubmitted',
        itemTitle: 'Clean sink',
        templateItemId: 'item1',
        sectionSnapshot: '',
        categorySnapshot: '',
        statusAfter: 'waiting_approval',
        previousStatus: 'need_correction',
        actorUserId: 'u1',
        actorRole: 'staff',
        actorDisplayNameSnapshot: '',
        note: '',
        feedbackCode: '',
        feedbackNote: '',
        createdAt: '2026-07-15T08:00:00.000Z',
      },
    ];
    const result = calculateScheduledTaskMetrics({
      expected,
      reports: [
        reportWith([
          response({
            id: 'resp1',
            scheduleOccurrenceKey: expected[0].occurrenceKey,
            scheduledDueAt: expected[0].scheduledDueAt,
            firstCompletedAt: '2026-07-15T02:00:00.000Z',
            submittedAt: '2026-07-15T08:00:00.000Z',
          }),
        ]),
      ],
      events,
      now: '2026-07-16T00:00:00.000Z',
    });
    expect(result.rows[0].onTime).toBe(1);
    expect(result.rows[0].late).toBe(0);
  });
});

describe('format helpers', () => {
  it('formats late duration', () => {
    expect(formatLateDuration(18 * 60 * 1000)).toBe('18 min');
    expect(formatLateDuration((1 * 3600 + 24 * 60) * 1000)).toBe('1 hr 24 min');
    expect(formatLateDuration((2 * 86400 + 3 * 3600) * 1000)).toBe('2 days 3 hr');
  });

  it('averages completion times in VN local', () => {
    // 09:00+07 = 02:00Z, 11:00+07 = 04:00Z → avg 10:00
    expect(
      formatAverageCompletionTime([
        '2026-07-15T02:00:00.000Z',
        '2026-07-15T04:00:00.000Z',
      ]),
    ).toBe('10:00');
  });
});

describe('backward compatibility', () => {
  it('ignores templates with schedule disabled', () => {
    const tmpl = dailyTemplate();
    tmpl.scheduleJson = JSON.stringify({ version: 2, enabled: false });
    expect(
      getScheduledOccurrences({
        templates: [tmpl],
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).toHaveLength(0);
  });
});
