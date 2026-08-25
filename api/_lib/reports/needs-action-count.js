/**
 * Admin helpers for reportNeedsActionCounts + reports.submitterNeedsAction reconcile.
 */

import { id } from '@instantdb/admin';

const PAGE = 100;

export function computeSubmitterNeedsAction(reportStatus, responses) {
  const status = String(reportStatus ?? '');
  if (status === 'need_correction' || status === 'rejected') return true;
  return (responses || []).some((resp) => {
    const s = String(resp?.status ?? '');
    return s === 'rejected' || s === 'need_correction';
  });
}

export function nextNeedsActionCount(current, delta) {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  const d = typeof delta === 'number' && Number.isFinite(delta) ? delta : 0;
  return Math.max(0, base + d);
}

export async function loadNeedsActionCountRows(adminDb, userIds) {
  const unique = [...new Set((userIds || []).map((u) => String(u ?? '').trim()).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const result = await adminDb.query({
    reportNeedsActionCounts: {
      $: { where: { userId: { $in: unique } } },
    },
  });
  for (const row of result.reportNeedsActionCounts || []) {
    if (row?.userId) map.set(row.userId, row);
  }
  return map;
}

export function buildNeedsActionCountSetTx(
  adminDb,
  userId,
  needsActionCount,
  existingRow,
  now = new Date().toISOString(),
) {
  const uid = String(userId ?? '').trim();
  if (!uid) return null;
  const next = Math.max(0, Math.floor(Number(needsActionCount) || 0));
  const rowId = existingRow?.id || id();
  if (existingRow?.id) {
    return adminDb.tx.reportNeedsActionCounts[rowId].update({
      needsActionCount: next,
      updatedAt: now,
    });
  }
  return adminDb.tx.reportNeedsActionCounts[rowId].update({
    userId: uid,
    needsActionCount: next,
    updatedAt: now,
  });
}

/**
 * Page owner's reports (newest submittedAt first) with nested responses.
 */
export async function pageOwnerReportsWithResponses(adminDb, submittedByUserId, limit = PAGE) {
  const batches = [];
  let beforeSubmittedAt = null;
  for (;;) {
    const where = beforeSubmittedAt
      ? {
          and: [
            { submittedByUserId },
            { submittedAt: { $lt: beforeSubmittedAt } },
          ],
        }
      : { submittedByUserId };
    const result = await adminDb.query({
      reports: {
        $: {
          where,
          order: { submittedAt: 'desc' },
          limit,
        },
        responses: {},
      },
    });
    const rows = result.reports || [];
    if (!rows.length) break;
    batches.push(rows);
    if (rows.length < limit) break;
    const last = rows[rows.length - 1];
    const nextCursor = last?.submittedAt;
    if (!nextCursor || nextCursor === beforeSubmittedAt) break;
    beforeSubmittedAt = nextCursor;
  }
  return batches.flat();
}

/**
 * Recompute every owned report's submitterNeedsAction and set the exact counter.
 * Used when the counter row is missing or on explicit reconcile.
 */
export async function reconcileReportNeedsActionCount(adminDb, userId) {
  const uid = String(userId ?? '').trim();
  if (!uid) return { needsActionCount: 0, reportsUpdated: 0 };

  const reports = await pageOwnerReportsWithResponses(adminDb, uid, PAGE);
  const now = new Date().toISOString();
  const flagTxs = [];
  let needsActionCount = 0;

  for (const report of reports) {
    const nextFlag = computeSubmitterNeedsAction(report.status, report.responses || []);
    if (nextFlag) needsActionCount += 1;
    const prev =
      typeof report.submitterNeedsAction === 'boolean' ? report.submitterNeedsAction : null;
    if (prev !== nextFlag) {
      flagTxs.push(
        adminDb.tx.reports[report.id].update({
          submitterNeedsAction: nextFlag,
        }),
      );
    }
  }

  // Chunk flag updates to avoid oversized transacts.
  const CHUNK = 40;
  for (let i = 0; i < flagTxs.length; i += CHUNK) {
    await adminDb.transact(flagTxs.slice(i, i + CHUNK));
  }

  const existing = await loadNeedsActionCountRows(adminDb, [uid]);
  const setTx = buildNeedsActionCountSetTx(
    adminDb,
    uid,
    needsActionCount,
    existing.get(uid) || null,
    now,
  );
  if (setTx) await adminDb.transact([setTx]);

  return { needsActionCount, reportsUpdated: flagTxs.length };
}
