import { id } from '@instantdb/react';
import { db } from '../db';
import { normalizeFailureCategory } from './roles';
import {
  effectiveFromIso,
  parseTemplateSchedule,
  schedulesEqual,
  serializeTemplateSchedule,
  type TemplateSchedule,
} from './templateSchedule';
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
    failureCategory: normalizeFailureCategory(item.failureCategory),
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
  profileUserId: string;
  name: string;
  reportType: string;
  scheduleJson?: string;
  prevScheduleJson?: string;
  /** Open schedule version id (effectiveTo === ''), if any */
  openScheduleVersionId?: string | null;
  active?: boolean;
  storeIds: string[];
  prevStoreIds: string[];
  items: TemplateItemDraft[];
  originalItemIds: Set<string>;
}

function remapItemDueTimes(
  schedule: TemplateSchedule,
  itemIdMap: Map<string, string>,
): TemplateSchedule {
  if (!schedule.itemDueTimes) return schedule;
  const remapped: Record<string, string> = {};
  for (const [draftId, time] of Object.entries(schedule.itemDueTimes)) {
    const persistedId = itemIdMap.get(draftId) ?? draftId;
    remapped[persistedId] = time;
  }
  return { ...schedule, itemDueTimes: remapped };
}

function buildScheduleVersionTxs(opts: {
  templateId: string;
  profileUserId: string;
  schedule: TemplateSchedule;
  prevScheduleJson?: string;
  openScheduleVersionId?: string | null;
  scheduleChanged: boolean;
}): unknown[] {
  const { templateId, profileUserId, schedule, openScheduleVersionId, scheduleChanged } = opts;
  if (!scheduleChanged) return [];

  const txs: unknown[] = [];
  const now = nowIso();
  const effectiveFrom =
    schedule.effectiveFrom?.trim() ||
    effectiveFromIso(now.slice(0, 10));

  if (openScheduleVersionId) {
    txs.push(
      db.tx.templateScheduleVersions[openScheduleVersionId].update({
        effectiveTo: effectiveFrom,
      }),
    );
  }

  // Seed a version whenever schedule content changes (including first enable / disable).
  const versionId = id();
  const versionSchedule = serializeTemplateSchedule({
    ...schedule,
    effectiveFrom,
  });
  txs.push(
    db.tx.templateScheduleVersions[versionId]
      .update({
        templateId,
        scheduleJson: versionSchedule,
        effectiveFrom,
        effectiveTo: '',
        createdAt: now,
        createdByUserId: profileUserId,
      })
      .link({ template: templateId }),
  );

  return txs;
}

export async function createTemplate(params: CreateTemplateParams): Promise<string> {
  const templateId = id();
  const parsed = parseTemplateSchedule(params.scheduleJson);

  // Preserve draft UUIDs as InstantDB ids so itemDueTimes keys stay stable.
  const itemIdMap = new Map<string, string>();
  const itemTxs = params.items.map((item, i) => {
    const itemId = item.id || id();
    itemIdMap.set(item.id, itemId);
    return db.tx.templateItems[itemId]
      .update(itemPayload({ ...item, id: itemId }, i))
      .link({ template: templateId });
  });

  const schedule = remapItemDueTimes(parsed, itemIdMap);
  const scheduleJson = serializeTemplateSchedule(schedule);

  const templateTx = db.tx.templates[templateId].update({
    name: params.name.trim(),
    reportType: params.reportType,
    scheduleJson,
    active: params.active,
    createdByUserId: params.profileUserId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const storeLinkTxs = params.storeIds.map((sid) =>
    db.tx.templates[templateId].link({ stores: sid }),
  );

  const versionTxs = schedule.enabled
    ? buildScheduleVersionTxs({
        templateId,
        profileUserId: params.profileUserId,
        schedule,
        scheduleChanged: true,
        openScheduleVersionId: null,
      })
    : [];

  // Instant tx chunks are loosely typed; cast once at the boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transact([templateTx, ...storeLinkTxs, ...itemTxs, ...versionTxs] as any[]);

  return templateId;
}

export async function updateTemplate(params: UpdateTemplateParams): Promise<void> {
  const draftIds = new Set(params.items.map((i) => i.id));
  const removedItemIds = [...params.originalItemIds].filter((oid) => !draftIds.has(oid));

  const itemIdMap = new Map<string, string>();
  const itemUpdateTxs = params.items.map((item, i) => {
    if (params.originalItemIds.has(item.id)) {
      itemIdMap.set(item.id, item.id);
      return db.tx.templateItems[item.id].update(itemPayload(item, i));
    }
    // Keep the draft UUID so schedule itemDueTimes remain keyed correctly.
    const newItemId = item.id || id();
    itemIdMap.set(item.id, newItemId);
    return db.tx.templateItems[newItemId]
      .update(itemPayload({ ...item, id: newItemId }, i))
      .link({ template: params.templateId });
  });

  const itemDeleteTxs = removedItemIds.map((removedId) =>
    db.tx.templateItems[removedId].delete(),
  );

  const updateFields: Record<string, unknown> = {
    name: params.name.trim(),
    reportType: params.reportType,
    updatedAt: nowIso(),
  };

  let versionTxs: unknown[] = [];

  if (params.scheduleJson !== undefined) {
    const next = remapItemDueTimes(parseTemplateSchedule(params.scheduleJson), itemIdMap);
    // Drop due times for removed items
    if (next.itemDueTimes) {
      const cleaned: Record<string, string> = {};
      for (const [itemId, time] of Object.entries(next.itemDueTimes)) {
        if (draftIds.has(itemId) || [...itemIdMap.values()].includes(itemId)) {
          cleaned[itemId] = time;
        }
      }
      next.itemDueTimes = Object.keys(cleaned).length ? cleaned : undefined;
    }

    const serialized = serializeTemplateSchedule(next);
    updateFields.scheduleJson = serialized;

    const prev = parseTemplateSchedule(params.prevScheduleJson);
    const scheduleChanged = !schedulesEqual(prev, next);

    if (scheduleChanged) {
      versionTxs = buildScheduleVersionTxs({
        templateId: params.templateId,
        profileUserId: params.profileUserId,
        schedule: next,
        prevScheduleJson: params.prevScheduleJson,
        openScheduleVersionId: params.openScheduleVersionId,
        scheduleChanged: true,
      });
    }
  }

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transact([
    templateTx,
    ...storeLinkTxs,
    ...storeUnlinkTxs,
    ...itemUpdateTxs,
    ...itemDeleteTxs,
    ...versionTxs,
  ] as any[]);
}
