import * as XLSX from 'xlsx';
import { FAILURE_CATEGORIES, PROOF_TYPES, ROLES } from './roles';
import {
  booleanToSpreadsheet,
  normalizeSpreadsheetBoolean,
  scheduleJsonFromSpreadsheet,
  spreadsheetScheduleFromJson,
  validateSpreadsheetSchedule,
  type SpreadsheetScheduleFields,
} from './templateSchedule';
import {
  buildExportPayload,
  slugifyTemplateName,
  TEMPLATE_SCHEMA,
  TEMPLATE_VERSION,
  type ChecklistTemplateExport,
  type ExportedChecklistItem,
  type ParsedImportRoot,
} from './templateTransfer';
import type { Store, Template } from '../types';

const SHEET_README = 'README';
const SHEET_TEMPLATE = 'Template';
const SHEET_ITEMS = 'Items';
const SHEET_STORES = 'Stores';
const SHEET_ALLOWED = 'Allowed Values';
const SHEET_METADATA = '_Metadata';

const ITEM_HEADERS = [
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
] as const;

const STORE_HEADERS = ['Store Code', 'Store Name', 'Included'] as const;

const TEMPLATE_FIELDS = [
  'Template Name',
  'Report Type',
  'Active',
  'Schedule Enabled',
  'Schedule Type',
  'Schedule Time',
  'Schedule Days',
  'Schedule Assigned Role',
] as const;

export class ExcelParseError extends Error {
  constructor(
    message: string,
    public readonly errors: string[] = [],
  ) {
    super(message);
    this.name = 'ExcelParseError';
  }
}

function generateExcelFilename(templateName: string, date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10);
  return `checklist-template-${slugifyTemplateName(templateName)}-${ymd}.xlsx`;
}

function downloadXlsxFile(filename: string, data: Uint8Array): void {
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map((wch) => ({ wch }));
}

function freezeTopRow(ws: XLSX.WorkSheet) {
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
}

function buildReadmeRows(payload: ChecklistTemplateExport): string[][] {
  return [
    ['Checklist Template Export'],
    [''],
    ['Template', payload.template.name],
    ['Exported At', payload.exportedAt],
    [''],
    ['This workbook is an editable checklist template export.'],
    ['You may update cells highlighted in yellow on the Template, Items, and Stores sheets.'],
    ['Do not rename worksheets or column headers.'],
    ['Do not delete Source Item ID values when updating an existing template.'],
    [''],
    ['When finished, save or download the file as .xlsx and import it from the Templates page.'],
    ['Importing will not change any existing template automatically.'],
    ['You must choose Create as New or Update Existing and confirm changes.'],
    ['Historical reports will not be modified.'],
    [''],
    ['Invalid rows will be rejected or reported during preview.'],
  ];
}

function buildTemplateRows(payload: ChecklistTemplateExport): string[][] {
  const schedule = spreadsheetScheduleFromJson(payload.template.scheduleJson);
  return [
    ['Field', 'Value', 'Editable', 'Notes'],
    ['Template Name', payload.template.name, 'Yes', 'Required'],
    ['Report Type', payload.template.reportType, 'Yes', 'Use allowed values'],
    ['Active', booleanToSpreadsheet(payload.template.active), 'Yes', 'TRUE or FALSE'],
    ['Schedule Enabled', booleanToSpreadsheet(schedule.scheduleEnabled), 'Yes', 'TRUE or FALSE'],
    ['Schedule Type', schedule.scheduleType, 'Yes', 'Optional recurrence'],
    ['Schedule Time', schedule.scheduleTime, 'Yes', 'HH:mm'],
    ['Schedule Days', schedule.scheduleDays, 'Yes', 'Comma-separated days'],
    [
      'Schedule Assigned Role',
      schedule.scheduleAssignedRole,
      'Yes',
      'Optional assigned role',
    ],
  ];
}

function buildItemsRows(items: ExportedChecklistItem[]): string[][] {
  const rows: string[][] = [ITEM_HEADERS.slice()];
  for (const item of items) {
    rows.push([
      `item-${item.sortOrder + 1}`,
      item.sourceItemId ?? '',
      item.section,
      item.title,
      item.requirement,
      item.proofType,
      booleanToSpreadsheet(item.required),
      item.assignedRole,
      item.approverRoles.join(','),
      String(item.weight),
      item.failureCategory,
      String(item.sortOrder),
    ]);
  }
  return rows;
}

function buildStoresRows(allStores: Store[], assignedCodes: Set<string>): string[][] {
  const rows: string[][] = [STORE_HEADERS.slice()];
  const sorted = [...allStores].sort((a, b) => a.code.localeCompare(b.code));
  for (const store of sorted) {
    rows.push([
      store.code,
      store.name,
      booleanToSpreadsheet(assignedCodes.has(store.code.trim())),
    ]);
  }
  return rows;
}

function buildAllowedValuesRows(reportTypes: string[]): string[][] {
  const rows: string[][] = [['Category', 'Value']];
  for (const p of PROOF_TYPES) rows.push(['Proof Type', p]);
  for (const r of ROLES) rows.push(['Role', r]);
  rows.push(['Boolean', 'TRUE']);
  rows.push(['Boolean', 'FALSE']);
  for (const rt of reportTypes) rows.push(['Report Type', rt]);
  for (const fc of FAILURE_CATEGORIES) rows.push(['Failure Category', fc]);
  rows.push(['Day', 'Monday']);
  rows.push(['Day', 'Tuesday']);
  rows.push(['Day', 'Wednesday']);
  rows.push(['Day', 'Thursday']);
  rows.push(['Day', 'Friday']);
  rows.push(['Day', 'Saturday']);
  rows.push(['Day', 'Sunday']);
  return rows;
}

function buildMetadataRows(payload: ChecklistTemplateExport): string[][] {
  return [
    ['Field', 'Value'],
    ['schema', payload.schema],
    ['version', String(payload.version)],
    ['exportedAt', payload.exportedAt],
    ['sourceTemplateId', payload.source?.templateId ?? ''],
    ['format', 'excel'],
  ];
}

function sheetFromRows(rows: string[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

export function exportTemplateAsExcel(template: Template, allStores: Store[]): { filename: string } {
  const payload = buildExportPayload(template);
  const assignedCodes = new Set(payload.storeCodes.map((c) => c.trim()));

  const reportTypes = Array.from(
    new Set([template.reportType, 'Daily Hygiene'].filter(Boolean)),
  );

  const wb = XLSX.utils.book_new();

  const readmeWs = sheetFromRows(buildReadmeRows(payload));
  setColWidths(readmeWs, [80]);
  XLSX.utils.book_append_sheet(wb, readmeWs, SHEET_README);

  const templateWs = sheetFromRows(buildTemplateRows(payload));
  setColWidths(templateWs, [24, 36, 10, 28]);
  XLSX.utils.book_append_sheet(wb, templateWs, SHEET_TEMPLATE);

  const itemsWs = sheetFromRows(buildItemsRows(payload.items));
  setColWidths(itemsWs, [10, 28, 14, 24, 40, 14, 10, 14, 24, 8, 16, 10]);
  freezeTopRow(itemsWs);
  XLSX.utils.book_append_sheet(wb, itemsWs, SHEET_ITEMS);

  const storesWs = sheetFromRows(buildStoresRows(allStores, assignedCodes));
  setColWidths(storesWs, [14, 28, 10]);
  freezeTopRow(storesWs);
  XLSX.utils.book_append_sheet(wb, storesWs, SHEET_STORES);

  const allowedWs = sheetFromRows(buildAllowedValuesRows(reportTypes));
  setColWidths(allowedWs, [18, 24]);
  XLSX.utils.book_append_sheet(wb, allowedWs, SHEET_ALLOWED);

  const metadataWs = sheetFromRows(buildMetadataRows(payload));
  setColWidths(metadataWs, [18, 40]);
  XLSX.utils.book_append_sheet(wb, metadataWs, SHEET_METADATA);

  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Sheets) wb.Workbook.Sheets = [];
  for (const name of wb.SheetNames) {
    const hidden = name === SHEET_METADATA ? 1 : 0;
    const existing = wb.Workbook.Sheets.find((s) => s.name === name);
    if (existing) existing.Hidden = hidden;
    else wb.Workbook.Sheets.push({ name, Hidden: hidden });
  }

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array;
  const filename = generateExcelFilename(template.name);
  downloadXlsxFile(filename, buffer);
  return { filename };
}

function readSheetRows(wb: XLSX.WorkBook, name: string): string[][] {
  const sheet = wb.Sheets[name];
  if (!sheet) {
    throw new ExcelParseError(`Missing required worksheet "${name}".`);
  }
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as string[][];
  return rows.map((row) => row.map((cell) => String(cell ?? '').trim()));
}

function readKeyValueSheet(rows: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.length < 2) continue;
    const key = row[0]?.trim();
    const value = row[1]?.trim() ?? '';
    if (key) map.set(key, value);
  }
  return map;
}

function assertHeaders(
  headerRow: string[],
  expected: readonly string[],
  sheet: string,
  errors: string[],
) {
  for (let i = 0; i < expected.length; i++) {
    if ((headerRow[i] ?? '') !== expected[i]) {
      errors.push(
        `${sheet}: expected column ${i + 1} "${expected[i]}", found "${headerRow[i] ?? ''}".`,
      );
    }
  }
}

function parseInteger(
  raw: string,
  sheet: string,
  row: number,
  column: string,
  errors: string[],
): number | null {
  if (!raw.trim()) {
    errors.push(`${sheet} row ${row}: "${column}" is required.`);
    return null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    errors.push(`${sheet} row ${row}: "${column}" must be a whole number.`);
    return null;
  }
  if (num < 0) {
    errors.push(`${sheet} row ${row}: "${column}" cannot be negative.`);
    return null;
  }
  return num;
}

function buildImportRootFromPayload(payload: ChecklistTemplateExport): ParsedImportRoot {
  return payload as unknown as ParsedImportRoot;
}

export function parseExcelTemplateImport(buffer: ArrayBuffer): ParsedImportRoot {
  const errors: string[] = [];

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  } catch {
    throw new ExcelParseError('Could not read the Excel workbook.');
  }

  for (const required of [SHEET_TEMPLATE, SHEET_ITEMS, SHEET_STORES, SHEET_METADATA]) {
    if (!wb.SheetNames.includes(required)) {
      errors.push(`Missing required worksheet "${required}".`);
    }
  }
  if (errors.length) throw new ExcelParseError('Invalid workbook.', errors);

  const metadataRows = readSheetRows(wb, SHEET_METADATA);
  const metadata = readKeyValueSheet(metadataRows);

  const schema = metadata.get('schema') ?? '';
  const versionRaw = metadata.get('version') ?? '';
  const version = Number(versionRaw);

  if (schema !== TEMPLATE_SCHEMA) {
    errors.push(`Expected schema "${TEMPLATE_SCHEMA}", found "${schema || '(empty)'}".`);
  }
  if (!Number.isFinite(version) || version !== TEMPLATE_VERSION) {
    errors.push(
      versionRaw
        ? `Unsupported version ${versionRaw}. Only version ${TEMPLATE_VERSION} is supported.`
        : 'Metadata version is required.',
    );
  }

  const templateRows = readSheetRows(wb, SHEET_TEMPLATE);
  const templateMap = readKeyValueSheet(templateRows);

  const name = templateMap.get('Template Name') ?? '';
  const reportType = templateMap.get('Report Type') ?? '';
  if (!name.trim()) errors.push('Template: Template Name is required.');
  if (!reportType.trim()) errors.push('Template: Report Type is required.');

  const activeResult = normalizeSpreadsheetBoolean(templateMap.get('Active') ?? '', 'Active');
  if (!activeResult.ok) errors.push(`Template: ${activeResult.error}`);

  const scheduleEnabledResult = normalizeSpreadsheetBoolean(
    templateMap.get('Schedule Enabled') ?? 'FALSE',
    'Schedule Enabled',
  );
  if (!scheduleEnabledResult.ok) errors.push(`Template: ${scheduleEnabledResult.error}`);

  const scheduleFields: SpreadsheetScheduleFields = {
    scheduleEnabled: scheduleEnabledResult.ok ? scheduleEnabledResult.value : false,
    scheduleType: templateMap.get('Schedule Type') ?? '',
    scheduleTime: templateMap.get('Schedule Time') ?? '',
    scheduleDays: templateMap.get('Schedule Days') ?? '',
    scheduleAssignedRole: templateMap.get('Schedule Assigned Role') ?? '',
  };

  for (const schedErr of validateSpreadsheetSchedule(scheduleFields)) {
    errors.push(`Template: ${schedErr.message}`);
  }

  const itemsRows = readSheetRows(wb, SHEET_ITEMS);
  if (!itemsRows.length) {
    errors.push(`${SHEET_ITEMS}: worksheet is empty.`);
  } else {
    assertHeaders(itemsRows[0], ITEM_HEADERS, SHEET_ITEMS, errors);
  }

  const parsedItems: ExportedChecklistItem[] = [];
  const seenItemKeys = new Set<string>();

  for (let r = 1; r < itemsRows.length; r++) {
    const row = itemsRows[r];
    const rowNum = r + 1;
    if (!row.some((cell) => cell.trim())) continue;

    const title = row[3] ?? '';
    if (!title.trim()) continue;

    const itemKey = row[0] ?? '';
    if (itemKey.trim()) {
      if (seenItemKeys.has(itemKey.trim())) {
        errors.push(`${SHEET_ITEMS} row ${rowNum}: duplicate Item Key "${itemKey}".`);
      }
      seenItemKeys.add(itemKey.trim());
    }

    const section = row[2] ?? '';
    const requirement = row[4] ?? '';
    if (!section.trim()) errors.push(`${SHEET_ITEMS} row ${rowNum}: Section is required.`);
    if (!requirement.trim()) errors.push(`${SHEET_ITEMS} row ${rowNum}: Requirement is required.`);

    const requiredResult = normalizeSpreadsheetBoolean(row[6] ?? '', 'Required');
    if (!requiredResult.ok) errors.push(`${SHEET_ITEMS} row ${rowNum}: ${requiredResult.error}`);

    const weight = parseInteger(row[9] ?? '', SHEET_ITEMS, rowNum, 'Weight', errors);
    const sortOrder = parseInteger(row[11] ?? '', SHEET_ITEMS, rowNum, 'Sort Order', errors);

    const approverRoles = (row[8] ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);

    const sourceItemId = (row[1] ?? '').trim() || undefined;

    if (section.trim() && title.trim() && requirement.trim() && requiredResult.ok && weight !== null && sortOrder !== null) {
      parsedItems.push({
        sourceItemId,
        section: section.trim(),
        title: title.trim(),
        requirement: requirement.trim(),
        proofType: row[5] ?? '',
        required: requiredResult.value,
        assignedRole: row[7] ?? '',
        approverRoles,
        weight,
        failureCategory: row[10] ?? '',
        sortOrder,
      });
    }
  }

  if (!parsedItems.length) {
    errors.push(`${SHEET_ITEMS}: at least one checklist item is required.`);
  }

  const storesRows = readSheetRows(wb, SHEET_STORES);
  if (!storesRows.length) {
    errors.push(`${SHEET_STORES}: worksheet is empty.`);
  } else {
    assertHeaders(storesRows[0], STORE_HEADERS, SHEET_STORES, errors);
  }

  const storeCodes: string[] = [];
  const seenStoreCodes = new Set<string>();

  for (let r = 1; r < storesRows.length; r++) {
    const row = storesRows[r];
    const rowNum = r + 1;
    const code = row[0] ?? '';
    if (!code.trim()) continue;

    const key = code.trim().toLowerCase();
    if (seenStoreCodes.has(key)) {
      errors.push(`${SHEET_STORES} row ${rowNum}: duplicate Store Code "${code}".`);
      continue;
    }
    seenStoreCodes.add(key);

    const includedResult = normalizeSpreadsheetBoolean(row[2] ?? 'FALSE', 'Included');
    if (!includedResult.ok) {
      errors.push(`${SHEET_STORES} row ${rowNum}: ${includedResult.error}`);
      continue;
    }
    if (includedResult.value) storeCodes.push(code.trim());
  }

  if (errors.length) {
    throw new ExcelParseError('Workbook validation failed.', errors);
  }

  parsedItems.sort((a, b) => a.sortOrder - b.sortOrder);
  const items = parsedItems.map((item, index) => ({ ...item, sortOrder: index }));

  const payload: ChecklistTemplateExport = {
    schema: TEMPLATE_SCHEMA,
    version: TEMPLATE_VERSION,
    exportedAt: metadata.get('exportedAt') || new Date().toISOString(),
    source: metadata.get('sourceTemplateId')
      ? { templateId: metadata.get('sourceTemplateId') }
      : undefined,
    template: {
      name: name.trim(),
      reportType: reportType.trim(),
      scheduleJson: scheduleJsonFromSpreadsheet(scheduleFields),
      active: activeResult.ok ? activeResult.value : false,
    },
    storeCodes,
    items,
  };

  return buildImportRootFromPayload(payload);
}
