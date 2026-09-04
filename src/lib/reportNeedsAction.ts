/**
 * My Reports "Needs action" flag + per-user counter helpers.
 * Flag: report status is need_correction/rejected OR any store-work response
 * (rejected / need_correction / required not_started).
 */

import { id } from '@instantdb/react';
import { db } from '../db';
import { hasStoreWorkResponses, type StoreWorkResponseLike } from './reportStoreWork';
import { nowIso } from './utils';
import type { ReportNeedsActionCount, ReportStatus, ResponseStatus } from '../types';

export const MY_REPORTS_PAGE_SIZE = 15;

export type ReportNeedsActionCountRow = ReportNeedsActionCount;

export function computeSubmitterNeedsAction(
  reportStatus: ReportStatus | string | undefined | null,
  responses: Array<
    { status?: ResponseStatus | string | null; required?: boolean | null } | StoreWorkResponseLike
  >,
): boolean {
  const status = String(reportStatus ?? '');
  if (status === 'need_correction' || status === 'rejected') return true;
  return hasStoreWorkResponses(responses);
}

/** Prefer denormalized flag; fall back to compute for legacy rows missing the field. */
export function readSubmitterNeedsAction(
  report: {
    status?: ReportStatus | string | null;
    submitterNeedsAction?: boolean | null;
    responses?: Array<{ status?: ResponseStatus | string | null }>;
  },
): boolean {
  if (typeof report.submitterNeedsAction === 'boolean') {
    return report.submitterNeedsAction;
  }
  return computeSubmitterNeedsAction(report.status, report.responses ?? []);
}

export function needsActionCountDelta(prevFlag: boolean, nextFlag: boolean): number {
  if (prevFlag === nextFlag) return 0;
  return nextFlag ? 1 : -1;
}

export function nextNeedsActionCount(current: number | undefined | null, delta: number): number {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  const d = typeof delta === 'number' && Number.isFinite(delta) ? delta : 0;
  return Math.max(0, base + d);
}

type TxFactory = {
  reportNeedsActionCounts: Record<
    string,
    { update: (attrs: Record<string, unknown>) => unknown }
  >;
};

/**
 * Build a single counter upsert/delta tx. Existing-row updates omit userId
 * (perms: only needsActionCount + updatedAt).
 */
export function buildNeedsActionCountDeltaTx(
  userId: string,
  delta: number,
  existingRow?: ReportNeedsActionCountRow | null,
  opts?: {
    now?: string;
    rowId?: string;
    tx?: TxFactory;
  },
): unknown | null {
  const uid = String(userId ?? '').trim();
  if (!uid || !delta) return null;
  const now = opts?.now ?? nowIso();
  const next = nextNeedsActionCount(existingRow?.needsActionCount, delta);
  const rowId = existingRow?.id || opts?.rowId || id();
  const txRoot = opts?.tx ?? (db.tx as unknown as TxFactory);
  if (existingRow?.id) {
    return txRoot.reportNeedsActionCounts[rowId].update({
      needsActionCount: next,
      updatedAt: now,
    });
  }
  return txRoot.reportNeedsActionCounts[rowId].update({
    userId: uid,
    needsActionCount: next,
    updatedAt: now,
  });
}

export function buildNeedsActionCountSetTx(
  userId: string,
  needsActionCount: number,
  existingRow?: ReportNeedsActionCountRow | null,
  opts?: { now?: string; rowId?: string; tx?: TxFactory },
): unknown | null {
  const uid = String(userId ?? '').trim();
  if (!uid) return null;
  const now = opts?.now ?? nowIso();
  const next = Math.max(0, Math.floor(needsActionCount));
  const rowId = existingRow?.id || opts?.rowId || id();
  const txRoot = opts?.tx ?? (db.tx as unknown as TxFactory);
  if (existingRow?.id) {
    return txRoot.reportNeedsActionCounts[rowId].update({
      needsActionCount: next,
      updatedAt: now,
    });
  }
  return txRoot.reportNeedsActionCounts[rowId].update({
    userId: uid,
    needsActionCount: next,
    updatedAt: now,
  });
}

export async function queryNeedsActionCountRows(
  userIds: string[],
): Promise<Map<string, ReportNeedsActionCountRow>> {
  const unique = [...new Set(userIds.map((u) => String(u ?? '').trim()).filter(Boolean))];
  const map = new Map<string, ReportNeedsActionCountRow>();
  if (!unique.length) return map;
  const { data } = await db.queryOnce({
    reportNeedsActionCounts: {
      $: { where: { userId: { $in: unique } } },
    },
  });
  for (const row of (data?.reportNeedsActionCounts ?? []) as ReportNeedsActionCountRow[]) {
    if (row?.userId) map.set(row.userId, row);
  }
  return map;
}

/**
 * Counter txs for a false→true / true→false edge on the submitter's badge.
 * No-op when the flag did not change.
 */
export async function buildSubmitterNeedsActionEdgeTxs(
  submitterUserId: string,
  prevFlag: boolean,
  nextFlag: boolean,
  existingRow?: ReportNeedsActionCountRow | null,
  opts?: { now?: string },
): Promise<unknown[]> {
  const delta = needsActionCountDelta(prevFlag, nextFlag);
  if (!delta) return [];
  let row = existingRow ?? null;
  if (!row) {
    const map = await queryNeedsActionCountRows([submitterUserId]);
    row = map.get(submitterUserId) ?? null;
  }
  const tx = buildNeedsActionCountDeltaTx(submitterUserId, delta, row, opts);
  return tx ? [tx] : [];
}

async function authHeaders(): Promise<HeadersInit> {
  const user = await db.getAuth();
  const token = (user as { refresh_token?: string } | null)?.refresh_token;
  if (!token) throw new Error('Not signed in');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Admin reconcile when counter row is missing (FeedbackInbox pattern). */
export async function reconcileOwnReportNeedsActionCount(): Promise<number | null> {
  try {
    const headers = await authHeaders();
    const resp = await fetch('/api/logbook-notify?action=reconcile-report-needs-action', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'reconcile-report-needs-action' }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { needsActionCount?: number };
    return typeof json.needsActionCount === 'number' ? json.needsActionCount : null;
  } catch {
    return null;
  }
}
