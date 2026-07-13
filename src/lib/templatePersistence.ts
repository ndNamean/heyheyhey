import { id } from '@instantdb/react';
import { db } from '../db';
import { nowIso } from './utils';
import type { TemplateItem } from '../types';

export interface TemplateItemDraft {
  id: string;
  section: string;
  title: string;
  requirement: string;
  proofType: string;
  required: boolean;
  assignedRole: string;
  approverRoles: string[];
  weight: number;
  failureCategory: string;
}

const DEFAULT_APPROVER_ROLES = ['leader', 'subleader', 'manager'];

export function parseApproverRoles(json: string | undefined): string[] {
  if (!json?.trim()) return [...DEFAULT_APPROVER_ROLES];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_APPROVER_ROLES];
  } catch {
    return [...DEFAULT_APPROVER_ROLES];
  }
}

export function templateItemToDraft(item: TemplateItem): TemplateItemDraft {
  return {
    id: item.id,
    section: item.section,
    title: item.title,
    requirement: item.requirement,
    proofType: item.proofType,
    required: item.required,
    assignedRole: item.assignedRole,
    approverRoles: parseApproverRoles(item.approverRolesJson),
    weight: item.weight,
    failureCategory: item.failureCategory,
  };
}

export function itemPayload(item: TemplateItemDraft, sortOrder: number) {
  return {
    section: item.section,
    title: item.title,
    requirement: item.requirement,
    proofType: item.proofType,
    required: item.required,
    assignedRole: item.assignedRole,
    approverRolesJson: JSON.stringify(item.approverRoles),
    weight: item.weight,
    failureCategory: item.failureCategory,
    sortOrder,
  };
}

export interface CreateTemplateParams {
  profileUserId: string;
  name: string;
  reportType: string;
  scheduleJson: string;
  active: boolean;
  storeIds: string[];
  items: TemplateItemDraft[];
}

export interface UpdateTemplateParams {
  templateId: string;
  name: string;
  reportType: string;
  scheduleJson?: string;
  active?: boolean;
  storeIds: string[];
  prevStoreIds: string[];
  items: TemplateItemDraft[];
  originalItemIds: Set<string>;
}

export async function createTemplate(params: CreateTemplateParams): Promise<string> {
  const templateId = id();

  const templateTx = db.tx.templates[templateId].update({
    name: params.name.trim(),
    reportType: params.reportType,
    scheduleJson: params.scheduleJson,
    active: params.active,
    createdByUserId: params.profileUserId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const storeLinkTxs = params.storeIds.map((sid) =>
    db.tx.templates[templateId].link({ stores: sid }),
  );

  const itemTxs = params.items.map((item, i) => {
    const itemId = id();
    return db.tx.templateItems[itemId]
      .update(itemPayload(item, i))
      .link({ template: templateId });
  });

  await db.transact([templateTx, ...storeLinkTxs, ...itemTxs]);
  return templateId;
}

export async function updateTemplate(params: UpdateTemplateParams): Promise<void> {
  const updateFields: Record<string, unknown> = {
    name: params.name.trim(),
    reportType: params.reportType,
    updatedAt: nowIso(),
  };
  if (params.scheduleJson !== undefined) updateFields.scheduleJson = params.scheduleJson;
  if (params.active !== undefined) updateFields.active = params.active;

  const templateTx = db.tx.templates[params.templateId].update(updateFields);

  const storeIdSet = new Set(params.storeIds);
  const prevSet = new Set(params.prevStoreIds);
  const storeLinkTxs = params.storeIds
    .filter((sid) => !prevSet.has(sid))
    .map((sid) => db.tx.templates[params.templateId].link({ stores: sid }));
  const storeUnlinkTxs = params.prevStoreIds
    .filter((sid) => !storeIdSet.has(sid))
    .map((sid) => db.tx.templates[params.templateId].unlink({ stores: sid }));

  const draftIds = new Set(params.items.map((i) => i.id));
  const removedItemIds = [...params.originalItemIds].filter((oid) => !draftIds.has(oid));

  const itemUpdateTxs = params.items.map((item, i) => {
    if (params.originalItemIds.has(item.id)) {
      return db.tx.templateItems[item.id].update(itemPayload(item, i));
    }
    const newItemId = id();
    return db.tx.templateItems[newItemId]
      .update(itemPayload(item, i))
      .link({ template: params.templateId });
  });

  const itemDeleteTxs = removedItemIds.map((removedId) =>
    db.tx.templateItems[removedId].delete(),
  );

  await db.transact([
    templateTx,
    ...storeLinkTxs,
    ...storeUnlinkTxs,
    ...itemUpdateTxs,
    ...itemDeleteTxs,
  ]);
}
