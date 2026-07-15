import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ExcelParseError, parseExcelTemplateImport } from './templateExcelTransfer';
import {
  TEMPLATE_SCHEMA,
  TEMPLATE_VERSION,
  buildExportPayload,
} from './templateTransfer';
import {
  attachDraftItemDueTimes,
  parseTemplateSchedule,
  scheduleJsonFromSpreadsheet,
  spreadsheetScheduleFromJson,
  validateSpreadsheetSchedule,
} from './templateSchedule';
import type { Template } from '../types';

function makeMinimalWorkbook(opts: {
  scheduleEnabled?: boolean;
  scheduleType?: string;
  dailyDays?: string;
  weeklyDay?: string;
  monthlyDay?: string;
  scheduleTime?: string;
  scheduleTimezone?: string;
  scheduleEffectiveFrom?: string;
  includeCompletionTimeColumn?: boolean;
  completionTimes?: string[];
  legacyScheduleDays?: string;
}): ArrayBuffer {
  const enabled = opts.scheduleEnabled ?? false;

  const templateRows = [
    ['Field', 'Value'],
    ['Template Name', 'Import Test'],
    ['Report Type', 'Daily Hygiene'],
    ['Active', 'TRUE'],
    ['Schedule Enabled', enabled ? 'TRUE' : 'FALSE'],
    ['Schedule Type', opts.scheduleType ?? ''],
    ['Schedule Time', opts.scheduleTime ?? ''],
    ['Schedule Days', opts.legacyScheduleDays ?? ''],
    ['Schedule Assigned Role', ''],
    ['Daily Days', opts.dailyDays ?? ''],
    ['Weekly Day', opts.weeklyDay ?? ''],
    ['Monthly Day', opts.monthlyDay ?? ''],
    ['Schedule Timezone', opts.scheduleTimezone ?? ''],
    ['Schedule Effective From', opts.scheduleEffectiveFrom ?? ''],
  ];

  const itemHeader = [
    'Item Key',
    'Source Item ID',
    'Section',
    'Title',
    'Requirement',
    'Proof Type',
    'Required',
    'Assigned Role',
    'Approver Roles',
    'Weight',
    'Failure Category',
    'Sort Order',
  ];
  if (opts.includeCompletionTimeColumn !== false) {
    itemHeader.push('Completion Time');
  }

  const itemRow = [
    'item-1',
    'src-item-1',
    'Kitchen',
    'Clean sink',
    'Wash thoroughly',
    'photo',
    'TRUE',
    'staff',
    'leader,manager',
    '1',
    'Hygiene',
    '0',
  ];
  if (opts.includeCompletionTimeColumn !== false) {
    itemRow.push(opts.completionTimes?.[0] ?? '');
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(templateRows), 'Template');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([itemHeader, itemRow]), 'Items');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Store Code', 'Store Name', 'Included'],
      ['S1', 'Store 1', 'TRUE'],
    ]),
    'Stores',
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Field', 'Value'],
      ['schema', TEMPLATE_SCHEMA],
      ['version', String(TEMPLATE_VERSION)],
      ['exportedAt', '2026-07-15T00:00:00.000Z'],
      ['sourceTemplateId', ''],
      ['format', 'excel'],
    ]),
    '_Metadata',
  );

  expect(wb.SheetNames).toEqual(['Template', 'Items', 'Stores', '_Metadata']);

  const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  return bytes.buffer;
}

describe('spreadsheetScheduleFromJson / scheduleJsonFromSpreadsheet', () => {
  it('exports disabled schedule with blank type fields', () => {
    const fields = spreadsheetScheduleFromJson(JSON.stringify({ version: 2, enabled: false }));
    expect(fields.scheduleEnabled).toBe(false);
    expect(fields.scheduleType).toBe('');
  });

  it('round-trips a daily v2 schedule', () => {
    const json = scheduleJsonFromSpreadsheet(
      {
        scheduleEnabled: true,
        scheduleType: 'Daily',
        scheduleTime: '',
        scheduleDays: '',
        scheduleAssignedRole: '',
        scheduleTimezone: 'Asia/Ho_Chi_Minh',
        scheduleEffectiveFrom: '2026-07-15',
        dailyDays: 'Mon,Tue,Wed,Thu,Fri',
        weeklyDay: '',
        monthlyDay: '',
      },
      { 'item-a': '10:00' },
    );
    const parsed = parseTemplateSchedule(json);
    expect(parsed.enabled).toBe(true);
    expect(parsed.recurrence).toBe('daily');
    expect(parsed.daily?.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.itemDueTimes?.['item-a']).toBe('10:00');
    expect(parsed.effectiveFrom?.startsWith('2026-07-15')).toBe(true);

    const back = spreadsheetScheduleFromJson(json);
    expect(back.scheduleEnabled).toBe(true);
    expect(back.scheduleType).toBe('Daily');
    expect(back.dailyDays).toContain('Mon');
  });

  it('validates schedule type and monthly day', () => {
    expect(
      validateSpreadsheetSchedule({
        scheduleEnabled: true,
        scheduleType: 'Yearly',
        scheduleTime: '',
        scheduleDays: '',
        scheduleAssignedRole: '',
        scheduleTimezone: '',
        scheduleEffectiveFrom: '',
        dailyDays: '',
        weeklyDay: '',
        monthlyDay: '',
      }).some((e) => e.field === 'Schedule Type'),
    ).toBe(true);

    expect(
      validateSpreadsheetSchedule({
        scheduleEnabled: true,
        scheduleType: 'Monthly',
        scheduleTime: '',
        scheduleDays: '',
        scheduleAssignedRole: '',
        scheduleTimezone: '',
        scheduleEffectiveFrom: '',
        dailyDays: '',
        weeklyDay: '',
        monthlyDay: '31',
      }).some((e) => e.field === 'Monthly Day'),
    ).toBe(true);
  });
});

describe('attachDraftItemDueTimes', () => {
  it('maps completion times onto draft ids', () => {
    const base = scheduleJsonFromSpreadsheet({
      scheduleEnabled: true,
      scheduleType: 'Weekly',
      scheduleTime: '',
      scheduleDays: '',
      scheduleAssignedRole: '',
      scheduleTimezone: 'Asia/Ho_Chi_Minh',
      scheduleEffectiveFrom: '2026-07-01',
      dailyDays: '',
      weeklyDay: 'Monday',
      monthlyDay: '',
    });
    const merged = attachDraftItemDueTimes(
      base,
      [{ completionTime: '14:30', sourceItemId: 'old' }],
      [{ id: 'draft-1' }],
    );
    const parsed = parseTemplateSchedule(merged);
    expect(parsed.itemDueTimes?.['draft-1']).toBe('14:30');
  });

  it('applies legacy Schedule Time when item times missing', () => {
    const base = scheduleJsonFromSpreadsheet({
      scheduleEnabled: true,
      scheduleType: 'Daily',
      scheduleTime: '09:00',
      scheduleDays: 'Mon,Tue',
      scheduleAssignedRole: '',
      scheduleTimezone: '',
      scheduleEffectiveFrom: '',
      dailyDays: 'Mon,Tue',
      weeklyDay: '',
      monthlyDay: '',
    });
    const merged = attachDraftItemDueTimes(base, [{}], [{ id: 'd1' }], '09:00');
    expect(parseTemplateSchedule(merged).itemDueTimes?.d1).toBe('09:00');
  });
});

describe('parseExcelTemplateImport', () => {
  it('imports old workbook without new columns as schedule-disabled compatible', () => {
    const buffer = makeMinimalWorkbook({
      scheduleEnabled: false,
      includeCompletionTimeColumn: false,
    });
    const root = parseExcelTemplateImport(buffer);
    expect(root.template.name).toBe('Import Test');
    expect(parseTemplateSchedule(root.template.scheduleJson).enabled).toBe(false);
    expect(root.items[0].completionTime).toBeUndefined();
  });

  it('imports v2 schedule with per-item completion time', () => {
    const buffer = makeMinimalWorkbook({
      scheduleEnabled: true,
      scheduleType: 'Daily',
      dailyDays: 'Mon,Tue,Wed,Thu,Fri',
      scheduleTimezone: 'Asia/Ho_Chi_Minh',
      scheduleEffectiveFrom: '2026-07-15',
      completionTimes: ['10:00'],
    });
    const root = parseExcelTemplateImport(buffer);
    const schedule = parseTemplateSchedule(root.template.scheduleJson);
    expect(schedule.enabled).toBe(true);
    expect(schedule.recurrence).toBe('daily');
    expect(schedule.itemDueTimes?.['src-item-1']).toBe('10:00');
    expect(root.items[0].completionTime).toBe('10:00');
  });

  it('accepts legacy Schedule Time when Completion Time column is blank', () => {
    const buffer = makeMinimalWorkbook({
      scheduleEnabled: true,
      scheduleType: 'Weekly',
      weeklyDay: 'Friday',
      scheduleTime: '11:30',
      completionTimes: [''],
    });
    let root;
    try {
      root = parseExcelTemplateImport(buffer);
    } catch (e) {
      if (e instanceof ExcelParseError) {
        throw new Error(`Workbook validation failed: ${e.errors.join(' | ')}`);
      }
      throw e;
    }
    expect(root.items[0].completionTime).toBe('11:30');
  });

  it('rejects invalid Completion Time without silent coercion', () => {
    const buffer = makeMinimalWorkbook({
      scheduleEnabled: true,
      scheduleType: 'Daily',
      dailyDays: 'Mon',
      completionTimes: ['25:99'],
    });
    expect(() => parseExcelTemplateImport(buffer)).toThrow(ExcelParseError);
  });

  it('rejects invalid Schedule Type when enabled', () => {
    const buffer = makeMinimalWorkbook({
      scheduleEnabled: true,
      scheduleType: 'Yearly',
      dailyDays: 'Mon',
      completionTimes: ['10:00'],
    });
    expect(() => parseExcelTemplateImport(buffer)).toThrow(ExcelParseError);
  });
});

describe('buildExportPayload completion times', () => {
  it('includes item completion times from scheduleJson', () => {
    const template: Template = {
      id: 't1',
      name: 'Export Me',
      reportType: 'Daily Hygiene',
      scheduleJson: JSON.stringify({
        version: 2,
        enabled: true,
        recurrence: 'monthly',
        monthly: { dayOfMonth: 'last' },
        timezone: 'Asia/Ho_Chi_Minh',
        itemDueTimes: { i1: '22:00' },
        effectiveFrom: '2026-07-01T00:00:00+07:00',
      }),
      active: true,
      createdByUserId: 'u1',
      createdAt: '',
      updatedAt: '',
      items: [
        {
          id: 'i1',
          section: 'A',
          title: 'Task',
          requirement: 'Do it',
          proofType: 'tick',
          required: true,
          assignedRole: 'staff',
          approverRolesJson: '["leader"]',
          weight: 1,
          failureCategory: 'Hygiene',
          sortOrder: 0,
        },
      ],
      stores: [],
    };
    const payload = buildExportPayload(template);
    expect(payload.items[0].completionTime).toBe('22:00');
    const fields = spreadsheetScheduleFromJson(payload.template.scheduleJson);
    expect(fields.scheduleType).toBe('Monthly');
    expect(fields.monthlyDay).toBe('Last');
  });
});
