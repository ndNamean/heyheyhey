import { PROOF_TYPES, ROLES } from './roles';
import type { Store, Template, TemplateItem } from '../types';
import {
  TEMPLATE_SCHEMA,
  TEMPLATE_VERSION,
  type ExportedChecklistItem,
  type ParsedImportRoot,
} from './templateTransfer';
import type { TemplateItemDraft } from './templatePersistence';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  path: string;
  itemIndex?: number;
  message: string;
  severity: ValidationSeverity;
}

export interface NormalizedImportItem {
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

export interface NormalizedImport {
  name: string;
  reportType: string;
  scheduleJson: string;
  active: boolean;
  storeIds: string[];
  storeCodes: string[];
  matchedStoreCodes: string[];
  unknownStoreCodes: string[];
  items: NormalizedImportItem[];
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  normalized: NormalizedImport | null;
  fileSchema: string | null;
  fileVersion: number | null;
}

export interface ValidateImportOptions {
  excludeUnknownStores?: boolean;
  existingTemplateNames?: string[];
  createNameOverride?: string;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PROOF_TYPE_SET = new Set<string>(PROOF_TYPES);
const ROLE_SET = new Set<string>(ROLES);

function pushIssue(
  issues: ValidationIssue[],
  path: string,
  message: string,
  severity: ValidationSeverity,
  itemIndex?: number,
) {
  issues.push({ path, message, severity, itemIndex });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationIssue[],
  required = true,
): string | null {
  if (DANGEROUS_KEYS.has(key)) return null;
  if (!(key in obj)) {
    if (required) pushIssue(errors, path, `${path} is required.`, 'error');
    return null;
  }
  const value = obj[key];
  if (typeof value !== 'string') {
    pushIssue(errors, path, `${path} must be a string.`, 'error');
    return null;
  }
  return value;
}

function validateScheduleJson(
  scheduleJson: string,
  path: string,
  errors: ValidationIssue[],
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(scheduleJson);
  } catch {
    pushIssue(errors, path, 'scheduleJson must contain valid JSON.', 'error');
    return null;
  }
  if (!isPlainObject(parsed)) {
    pushIssue(errors, path, 'scheduleJson must be a JSON object.', 'error');
    return null;
  }
  if ('enabled' in parsed && typeof parsed.enabled !== 'boolean') {
    pushIssue(errors, path, 'scheduleJson.enabled must be a boolean when present.', 'error');
    return null;
  }
  return scheduleJson;
}

function normalizeStoreCodes(
  raw: unknown,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  stores: Store[],
  excludeUnknownStores: boolean,
): { storeIds: string[]; storeCodes: string[]; matched: string[]; unknown: string[] } {
  if (!Array.isArray(raw)) {
    pushIssue(errors, 'storeCodes', 'storeCodes must be an array.', 'error');
    return { storeIds: [], storeCodes: [], matched: [], unknown: [] };
  }

  const codeToId = new Map(stores.map((s) => [s.code.trim().toLowerCase(), s.id]));
  const seen = new Set<string>();
  const storeCodes: string[] = [];
  const matched: string[] = [];
  const unknown: string[] = [];
  const storeIds: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== 'string') {
      pushIssue(errors, `storeCodes[${i}]`, 'Each store code must be a string.', 'error');
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      pushIssue(errors, `storeCodes[${i}]`, 'Store codes cannot be empty.', 'error');
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    storeCodes.push(trimmed);

    const storeId = codeToId.get(key);
    if (storeId) {
      matched.push(trimmed);
      storeIds.push(storeId);
    } else {
      unknown.push(trimmed);
    }
  }

  if (unknown.length > 0) {
    const msg = `Unknown store codes: ${unknown.join(', ')}`;
    if (excludeUnknownStores) {
      pushIssue(warnings, 'storeCodes', `${msg} They will be excluded.`, 'warning');
    } else {
      pushIssue(errors, 'storeCodes', msg, 'error');
    }
  }

  return { storeIds, storeCodes, matched, unknown };
}

function validateItem(
  raw: unknown,
  index: number,
  errors: ValidationIssue[],
): NormalizedImportItem | null {
  if (!isPlainObject(raw)) {
    pushIssue(errors, `items[${index}]`, 'Each item must be an object.', 'error', index);
    return null;
  }

  for (const key of Object.keys(raw)) {
    if (DANGEROUS_KEYS.has(key)) {
      pushIssue(errors, `items[${index}].${key}`, 'Invalid property name.', 'error', index);
      return null;
    }
  }

  const section = readString(raw, 'section', `items[${index}].section`, errors);
  const title = readString(raw, 'title', `items[${index}].title`, errors);
  const requirement = readString(raw, 'requirement', `items[${index}].requirement`, errors);

  if (!section?.trim() || !title?.trim() || !requirement?.trim()) {
    if (section !== null && !section.trim()) {
      pushIssue(errors, `items[${index}].section`, 'Section cannot be empty.', 'error', index);
    }
    if (title !== null && !title.trim()) {
      pushIssue(errors, `items[${index}].title`, 'Title cannot be empty.', 'error', index);
    }
    if (requirement !== null && !requirement.trim()) {
      pushIssue(errors, `items[${index}].requirement`, 'Requirement cannot be empty.', 'error', index);
    }
    return null;
  }

  const proofType = readString(raw, 'proofType', `items[${index}].proofType`, errors);
  if (proofType && !PROOF_TYPE_SET.has(proofType)) {
    pushIssue(
      errors,
      `items[${index}].proofType`,
      `Invalid proof type "${proofType}".`,
      'error',
      index,
    );
    return null;
  }

  const assignedRole = readString(raw, 'assignedRole', `items[${index}].assignedRole`, errors);
  if (assignedRole && !ROLE_SET.has(assignedRole)) {
    pushIssue(
      errors,
      `items[${index}].assignedRole`,
      `Invalid assigned role "${assignedRole}".`,
      'error',
      index,
    );
    return null;
  }

  if (typeof raw.required !== 'boolean') {
    pushIssue(errors, `items[${index}].required`, 'required must be a boolean.', 'error', index);
    return null;
  }

  let weight = 1;
  if ('weight' in raw) {
    if (typeof raw.weight !== 'number' || !Number.isFinite(raw.weight)) {
      pushIssue(errors, `items[${index}].weight`, 'weight must be a finite number.', 'error', index);
      return null;
    }
    weight = raw.weight;
  }

  const failureCategory =
    typeof raw.failureCategory === 'string' ? raw.failureCategory.trim() : '';

  let sortOrder = index;
  if ('sortOrder' in raw) {
    if (typeof raw.sortOrder !== 'number' || !Number.isFinite(raw.sortOrder)) {
      pushIssue(errors, `items[${index}].sortOrder`, 'sortOrder must be a finite number.', 'error', index);
      return null;
    }
    sortOrder = raw.sortOrder;
  }

  let approverRoles: string[] = [];
  if (!('approverRoles' in raw)) {
    pushIssue(errors, `items[${index}].approverRoles`, 'approverRoles is required.', 'error', index);
    return null;
  }
  if (!Array.isArray(raw.approverRoles)) {
    pushIssue(errors, `items[${index}].approverRoles`, 'approverRoles must be an array.', 'error', index);
    return null;
  }
  const seenRoles = new Set<string>();
  for (let r = 0; r < raw.approverRoles.length; r++) {
    const role = raw.approverRoles[r];
    if (typeof role !== 'string' || !ROLE_SET.has(role)) {
      pushIssue(
        errors,
        `items[${index}].approverRoles[${r}]`,
        `Invalid approver role "${String(role)}".`,
        'error',
        index,
      );
      return null;
    }
    if (!seenRoles.has(role)) {
      seenRoles.add(role);
      approverRoles.push(role);
    }
  }
  if (!approverRoles.length) {
    pushIssue(errors, `items[${index}].approverRoles`, 'At least one approver role is required.', 'error', index);
    return null;
  }

  let sourceItemId: string | undefined;
  if ('sourceItemId' in raw && raw.sourceItemId !== undefined && raw.sourceItemId !== null) {
    if (typeof raw.sourceItemId !== 'string' || !raw.sourceItemId.trim()) {
      pushIssue(errors, `items[${index}].sourceItemId`, 'sourceItemId must be a non-empty string.', 'error', index);
      return null;
    }
    sourceItemId = raw.sourceItemId.trim();
  }

  if (!section || !title || !requirement || !proofType || !assignedRole) return null;

  return {
    sourceItemId,
    section: section.trim(),
    title: title.trim(),
    requirement: requirement.trim(),
    proofType,
    required: raw.required,
    assignedRole,
    approverRoles,
    weight,
    failureCategory,
    sortOrder,
  };
}

export function validateImportFile(
  root: ParsedImportRoot,
  stores: Store[],
  options: ValidateImportOptions = {},
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const excludeUnknownStores = options.excludeUnknownStores ?? false;

  const schema = typeof root.schema === 'string' ? root.schema : null;
  const version = typeof root.version === 'number' ? root.version : null;

  if (schema !== TEMPLATE_SCHEMA) {
    pushIssue(errors, 'schema', `Expected schema "${TEMPLATE_SCHEMA}".`, 'error');
  }
  if (version !== TEMPLATE_VERSION) {
    pushIssue(
      errors,
      'version',
      version === null
        ? 'version is required.'
        : `Unsupported version ${version}. Only version ${TEMPLATE_VERSION} is supported.`,
      'error',
    );
  }

  if (!isPlainObject(root.template)) {
    pushIssue(errors, 'template', 'template must be an object.', 'error');
    return { ok: false, errors, warnings, normalized: null, fileSchema: schema, fileVersion: version };
  }

  const templateObj = root.template;
  const nameRaw = readString(templateObj, 'name', 'template.name', errors);
  const reportTypeRaw = readString(templateObj, 'reportType', 'template.reportType', errors);
  const scheduleJsonRaw = readString(templateObj, 'scheduleJson', 'template.scheduleJson', errors);

  if (typeof templateObj.active !== 'boolean') {
    pushIssue(errors, 'template.active', 'active must be a boolean.', 'error');
  }

  const name = (options.createNameOverride ?? nameRaw)?.trim() ?? '';
  const reportType = reportTypeRaw?.trim() ?? '';

  if (nameRaw !== null && !nameRaw.trim()) {
    pushIssue(errors, 'template.name', 'Template name cannot be empty.', 'error');
  }
  if (reportTypeRaw !== null && !reportTypeRaw.trim()) {
    pushIssue(errors, 'template.reportType', 'Report type cannot be empty.', 'error');
  }

  const scheduleJson =
    scheduleJsonRaw !== null ? validateScheduleJson(scheduleJsonRaw, 'template.scheduleJson', errors) : null;

  if (!Array.isArray(root.items)) {
    pushIssue(errors, 'items', 'items must be an array.', 'error');
    return { ok: false, errors, warnings, normalized: null, fileSchema: schema, fileVersion: version };
  }

  if (root.items.length === 0) {
    pushIssue(errors, 'items', 'At least one checklist item is required.', 'error');
  }

  const storeResult = normalizeStoreCodes(
    root.storeCodes,
    errors,
    warnings,
    stores,
    excludeUnknownStores,
  );

  const parsedItems: NormalizedImportItem[] = [];
  for (let i = 0; i < root.items.length; i++) {
    const item = validateItem(root.items[i], i, errors);
    if (item) parsedItems.push(item);
  }

  parsedItems.sort((a, b) => a.sortOrder - b.sortOrder);
  const items = parsedItems.map((item, index) => ({ ...item, sortOrder: index }));

  const active = templateObj.active === true;

  if (options.existingTemplateNames && name) {
    const normalized = name.toLowerCase();
    const duplicate = options.existingTemplateNames.some((n) => n.trim().toLowerCase() === normalized);
    if (duplicate) {
      pushIssue(
        warnings,
        'template.name',
        `A template named "${name}" already exists.`,
        'warning',
      );
    }
  }

  const hasErrors = errors.length > 0;
  const normalized: NormalizedImport | null = hasErrors
    ? null
    : {
        name,
        reportType,
        scheduleJson: scheduleJson!,
        active,
        storeIds: storeResult.storeIds,
        storeCodes: storeResult.storeCodes,
        matchedStoreCodes: storeResult.matched,
        unknownStoreCodes: storeResult.unknown,
        items,
      };

  return {
    ok: !hasErrors,
    errors,
    warnings,
    normalized,
    fileSchema: schema,
    fileVersion: version,
  };
}

export function normalizedItemToDraft(item: NormalizedImportItem, draftId: string): TemplateItemDraft {
  return {
    id: draftId,
    section: item.section,
    title: item.title,
    requirement: item.requirement,
    proofType: item.proofType,
    required: item.required,
    assignedRole: item.assignedRole,
    approverRoles: [...item.approverRoles],
    weight: item.weight,
    failureCategory: item.failureCategory,
  };
}

export function buildCreateImportDrafts(items: NormalizedImportItem[]): TemplateItemDraft[] {
  return items.map((item) => normalizedItemToDraft(item, crypto.randomUUID()));
}

export function buildUpdateImportDrafts(
  items: NormalizedImportItem[],
  targetItemIds: Set<string>,
): TemplateItemDraft[] {
  return items.map((item) => {
    const matchedId =
      item.sourceItemId && targetItemIds.has(item.sourceItemId) ? item.sourceItemId : crypto.randomUUID();
    return normalizedItemToDraft(item, matchedId);
  });
}

export interface UpdateDiff {
  templateFieldChanges: string[];
  storesToAdd: string[];
  storesToRemove: string[];
  itemsToUpdate: number;
  itemsToCreate: number;
  itemsToRemove: number;
  removedItemTitles: string[];
  activeWillChange: boolean;
  scheduleWillChange: boolean;
}

export function buildUpdateDiff(
  normalized: NormalizedImport,
  target: Template,
  stores: Store[],
): UpdateDiff {
  const storeCodeById = new Map(stores.map((s) => [s.id, s.code]));
  const currentStoreIds = new Set((target.stores ?? []).map((s: Store) => s.id));
  const importStoreIds = new Set(normalized.storeIds);

  const storesToAdd = [...importStoreIds].filter((id) => !currentStoreIds.has(id));
  const storesToRemove = [...currentStoreIds].filter((id) => !importStoreIds.has(id));

  const targetItems = [...((target.items ?? []) as TemplateItem[])];
  const targetItemIdSet = new Set(targetItems.map((i) => i.id));
  const drafts = buildUpdateImportDrafts(normalized.items, targetItemIdSet);
  const draftIdSet = new Set(drafts.map((d) => d.id));

  const itemsToUpdate = drafts.filter((d) => targetItemIdSet.has(d.id)).length;
  const itemsToCreate = drafts.filter((d) => !targetItemIdSet.has(d.id)).length;
  const removedItems = targetItems.filter((i) => !draftIdSet.has(i.id));
  const itemsToRemove = removedItems.length;

  const templateFieldChanges: string[] = [];
  if (target.name.trim() !== normalized.name) templateFieldChanges.push('name');
  if (target.reportType.trim() !== normalized.reportType) templateFieldChanges.push('reportType');
  if (target.scheduleJson !== normalized.scheduleJson) templateFieldChanges.push('scheduleJson');

  return {
    templateFieldChanges,
    storesToAdd: storesToAdd.map((id) => storeCodeById.get(id) ?? id),
    storesToRemove: storesToRemove.map((id) => storeCodeById.get(id) ?? id),
    itemsToUpdate,
    itemsToCreate,
    itemsToRemove,
    removedItemTitles: removedItems.map((i) => i.title),
    activeWillChange: target.active !== normalized.active,
    scheduleWillChange: target.scheduleJson !== normalized.scheduleJson,
  };
}

export function buildImportConfirmMessage(params: {
  editWarning: string;
  activeEditWarning: string;
  removeItemWarning: string;
  targetActive: boolean;
  hasRemovedItems: boolean;
  mode: 'create' | 'update';
  createSuccessLabel?: string;
}): string {
  if (params.mode === 'create') {
    return params.createSuccessLabel ?? 'Import this template as a new checklist?';
  }
  const parts = [params.editWarning];
  if (params.targetActive) parts.push(params.activeEditWarning);
  if (params.hasRemovedItems) parts.push(params.removeItemWarning);
  return parts.join('\n\n');
}

export type { ExportedChecklistItem };
