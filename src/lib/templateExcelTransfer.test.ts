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
import { normalizedItemToDraft, validateImportFile } from './templateValidation';
import type { Store, Template } from '../types';

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
  assignedRoleCell?: string;
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
    opts.assignedRoleCell ?? 'staff',
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

describe('parseExcelTemplateImport assigned roles', () => {
  it('imports a legacy single Assigned Role cell', () => {
    const root = parseExcelTemplateImport(makeMinimalWorkbook({ assignedRoleCell: 'leader' }));
    expect(root.items[0].assignedRole).toBe('leader');
    expect(root.items[0].assignedRoles).toEqual(['leader']);
  });

  it('imports comma-separated Assigned Role cells as multi-role', () => {
    const root = parseExcelTemplateImport(
      makeMinimalWorkbook({ assignedRoleCell: 'staff, hybrid, leader' }),
    );
    expect(root.items[0].assignedRoles).toEqual(['staff', 'hybrid', 'leader']);
    expect(root.items[0].assignedRole).toBe('staff');
  });

  it('imports * and all as All store members', () => {
    const star = parseExcelTemplateImport(makeMinimalWorkbook({ assignedRoleCell: '*' }));
    expect(star.items[0].assignedRoles).toEqual(['*']);
    expect(star.items[0].assignedRole).toBe('*');

    const all = parseExcelTemplateImport(makeMinimalWorkbook({ assignedRoleCell: 'all' }));
    expect(all.items[0].assignedRoles).toEqual(['*']);
    expect(all.items[0].assignedRole).toBe('*');
  });
});

function assignedRolesExportTemplate(): Template {
  return {
    id: 't1',
    name: 'Export Me',
    reportType: 'Daily Hygiene',
    scheduleJson: JSON.stringify({ version: 2, enabled: false }),
    active: true,
    createdByUserId: 'u1',
    createdAt: '',
    updatedAt: '',
    items: [
      {
        id: 'i1',
        section: 'A',
        title: 'Multi',
        requirement: 'Do it',
        proofType: 'tick',
        required: true,
        assignedRole: 'staff',
        assignedRolesJson: '["staff","leader"]',
        approverRolesJson: '["leader"]',
        weight: 1,
        failureCategory: 'Hygiene',
        sortOrder: 0,
      },
      {
        id: 'i2',
        section: 'A',
        title: 'All members',
        requirement: 'Do it',
        proofType: 'tick',
        required: true,
        assignedRole: '*',
        assignedRolesJson: '["*"]',
        approverRolesJson: '["leader"]',
        weight: 1,
        failureCategory: 'Hygiene',
        sortOrder: 1,
      },
      {
        id: 'i3',
        section: 'A',
        title: 'Legacy only',
        requirement: 'Do it',
        proofType: 'tick',
        required: true,
        assignedRole: 'manager',
        approverRolesJson: '["leader"]',
        weight: 1,
        failureCategory: 'Hygiene',
        sortOrder: 2,
      },
    ],
    stores: [],
  };
}

/** Mirror formatAssignedRolesCell used by Excel export. */
function formatAssignedRolesCellForTest(roles: string[]): string {
  return roles.includes('*') ? '*' : roles.join(',');
}

describe('buildExportPayload assigned roles', () => {
  it('exports assignedRoles array and legacy assignedRole primary', () => {
    const payload = buildExportPayload(assignedRolesExportTemplate());
    expect(payload.items[0].assignedRoles).toEqual(['staff', 'leader']);
    expect(payload.items[0].assignedRole).toBe('staff');
    expect(payload.items[1].assignedRoles).toEqual(['*']);
    expect(payload.items[1].assignedRole).toBe('*');
    expect(payload.items[2].assignedRoles).toEqual(['manager']);
    expect(payload.items[2].assignedRole).toBe('manager');
  });

  it('round-trips multi, All, and legacy assigned roles through JSON export → validate', () => {
    const stores: Store[] = [
      {
        id: 's1',
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
    ];
    const payload = buildExportPayload(assignedRolesExportTemplate());
    const result = validateImportFile(
      {
        schema: payload.schema,
        version: payload.version,
        template: payload.template,
        storeCodes: ['S1'],
        items: payload.items,
      },
      stores,
    );
    expect(result.ok).toBe(true);
    expect(result.normalized?.items.map((i) => i.assignedRoles)).toEqual([
      ['staff', 'leader'],
      ['*'],
      ['manager'],
    ]);
    expect(result.normalized?.items.map((i) => i.assignedRole)).toEqual([
      'staff',
      '*',
      'manager',
    ]);
  });

  it('round-trips multi, All, and legacy assigned roles through Excel cell format → import', () => {
    const payload = buildExportPayload(assignedRolesExportTemplate());
    for (const item of payload.items) {
      const cell = formatAssignedRolesCellForTest(item.assignedRoles);
      const root = parseExcelTemplateImport(makeMinimalWorkbook({ assignedRoleCell: cell }));
      expect(root.items[0].assignedRoles).toEqual(item.assignedRoles);
      expect(root.items[0].assignedRole).toBe(item.assignedRole);
    }
  });
});

describe('validateImportFile assigned roles', () => {
  const stores: Store[] = [
    {
      id: 's1',
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
  ];

  function baseRoot(item: Record<string, unknown>) {
    return {
      schema: TEMPLATE_SCHEMA,
      version: TEMPLATE_VERSION,
      template: {
        name: 'Import',
        reportType: 'Daily Hygiene',
        scheduleJson: JSON.stringify({ version: 2, enabled: false }),
        active: true,
      },
      storeCodes: ['S1'],
      items: [item],
    };
  }

  it('accepts assignedRoles array and keeps assignedRole primary on drafts', () => {
    const result = validateImportFile(
      baseRoot({
        section: 'A',
        title: 'T',
        requirement: 'R',
        proofType: 'tick',
        required: true,
        assignedRoles: ['hybrid', 'staff'],
        approverRoles: ['leader'],
        weight: 1,
        failureCategory: 'Hygiene',
        sortOrder: 0,
      }),
      stores,
    );
    expect(result.ok).toBe(true);
    expect(result.normalized?.items[0].assignedRoles).toEqual(['hybrid', 'staff']);
    expect(result.normalized?.items[0].assignedRole).toBe('hybrid');
    const draft = normalizedItemToDraft(result.normalized!.items[0], 'd1');
    expect(draft.assignedRoles).toEqual(['hybrid', 'staff']);
  });

  it('accepts legacy assignedRole and * / all sentinels', () => {
    const legacy = validateImportFile(
      baseRoot({
        section: 'A',
        title: 'T',
        requirement: 'R',
        proofType: 'tick',
        required: true,
        assignedRole: 'staff',
        approverRoles: ['leader'],
      }),
      stores,
    );
    expect(legacy.ok).toBe(true);
    expect(legacy.normalized?.items[0].assignedRoles).toEqual(['staff']);

    const all = validateImportFile(
      baseRoot({
        section: 'A',
        title: 'T',
        requirement: 'R',
        proofType: 'tick',
        required: true,
        assignedRoles: ['all'],
        approverRoles: ['leader'],
      }),
      stores,
    );
    expect(all.ok).toBe(true);
    expect(all.normalized?.items[0].assignedRoles).toEqual(['*']);
    expect(all.normalized?.items[0].assignedRole).toBe('*');
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
    expect(payload.items[0].assignedRoles).toEqual(['staff']);
    const fields = spreadsheetScheduleFromJson(payload.template.scheduleJson);
    expect(fields.scheduleType).toBe('Monthly');
    expect(fields.monthlyDay).toBe('Last');
  });
});
