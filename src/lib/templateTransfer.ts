import type { Store, Template, TemplateItem } from '../types';

export const TEMPLATE_SCHEMA = 'hey-pelo.checklist-template' as const;
export const TEMPLATE_VERSION = 1 as const;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export interface ChecklistTemplateExport {
  schema: typeof TEMPLATE_SCHEMA;
  version: typeof TEMPLATE_VERSION;
  exportedAt: string;
  source?: { templateId?: string };
  template: {
    name: string;
    reportType: string;
    scheduleJson: string;
    active: boolean;
  };
  storeCodes: string[];
  items: ExportedChecklistItem[];
}

export interface ExportedChecklistItem {
  sourceItemId?: string;
  section: string;
  title: string;
  requirement: string;
  proofType: string;
  required: boolean;
  assignedRole: string;
  approverRoles: string[];
  weight: number;
  failureCategory: string;
  sortOrder: number;
}

const DEFAULT_APPROVER_ROLES = ['leader', 'subleader', 'manager'];

function parseApproverRolesArray(json: string | undefined): string[] {
  if (!json?.trim()) return [...DEFAULT_APPROVER_ROLES];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_APPROVER_ROLES];
  } catch {
    return [...DEFAULT_APPROVER_ROLES];
  }
}

export function slugifyTemplateName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'template';
}

export function generateExportFilename(templateName: string, date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10);
  return `checklist-template_${slugifyTemplateName(templateName)}_${ymd}.json`;
}

export function buildExportPayload(template: Template): ChecklistTemplateExport {
  const templateItems = [...((template.items ?? []) as TemplateItem[])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  const storeCodes = (template.stores ?? [])
    .map((s: Store) => s.code?.trim())
    .filter((code): code is string => Boolean(code));

  return {
    schema: TEMPLATE_SCHEMA,
    version: TEMPLATE_VERSION,
    exportedAt: new Date().toISOString(),
    source: { templateId: template.id },
    template: {
      name: template.name,
      reportType: template.reportType,
      scheduleJson: template.scheduleJson,
      active: template.active,
    },
    storeCodes,
    items: templateItems.map((item) => ({
      sourceItemId: item.id,
      section: item.section,
      title: item.title,
      requirement: item.requirement,
      proofType: item.proofType,
      required: item.required,
      assignedRole: item.assignedRole,
      approverRoles: parseApproverRolesArray(item.approverRolesJson),
      weight: item.weight,
      failureCategory: item.failureCategory,
      sortOrder: item.sortOrder ?? 0,
    })),
  };
}

export function serializeExportPayload(payload: ChecklistTemplateExport): string {
  return JSON.stringify(payload, null, 2);
}

export function downloadJsonFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
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

export function exportTemplateToFile(template: Template): { filename: string } {
  const payload = buildExportPayload(template);
  const filename = generateExportFilename(template.name);
  downloadJsonFile(filename, serializeExportPayload(payload));
  return { filename };
}

export type ParsedImportRoot = Record<string, unknown>;

export function parseImportJsonText(text: string): ParsedImportRoot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Import file must be a JSON object.');
  }
  return parsed as ParsedImportRoot;
}
