/**
 * Admin helpers for notificationUnreadCounts (create-path bumps, mark-all, reconcile).
 */

import { id } from '@instantdb/admin';

const PAGE = 100;

export function tallyRecipientDeltas(recipientUserIds) {
  const map = new Map();
  for (const uid of recipientUserIds || []) {
    const key = String(uid ?? '').trim();
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function nextUnreadCount(current, delta) {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  const d = typeof delta === 'number' && Number.isFinite(delta) ? delta : 0;
  return Math.max(0, base + d);
}

export function extractNotificationRecipientIdsFromTxs(txs) {
  const ids = [];
  for (const chunk of txs || []) {
    if (!chunk || typeof chunk !== 'object') continue;
    const ops = chunk.__ops;
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      if (!Array.isArray(op) || op.length < 4) continue;
      const [cmd, etype, , attrs] = op;
      if (
        (cmd === 'update' || cmd === 'merge' || cmd === 'create') &&
        etype === 'notifications' &&
        attrs &&
        typeof attrs === 'object' &&
        Object.prototype.hasOwnProperty.call(attrs, 'recipientUserId')
      ) {
        const uid = String(attrs.recipientUserId ?? '').trim();
        if (uid) ids.push(uid);
      }
    }
  }
  return ids;
}

export async function loadUnreadCountRows(adminDb, userIds) {
  const unique = [...new Set((userIds || []).map((u) => String(u ?? '').trim()).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const result = await adminDb.query({
    notificationUnreadCounts: {
      $: { where: { userId: { $in: unique } } },
    },
  });
  for (const row of result.notificationUnreadCounts || []) {
    if (row?.userId) map.set(row.userId, row);
  }
  return map;
}

export function buildUnreadCountDeltaTx(adminDb, userId, delta, existingRow, now = new Date().toISOString()) {
  const uid = String(userId ?? '').trim();
  if (!uid || !delta) return null;
  const next = nextUnreadCount(existingRow?.unreadCount, delta);
  const rowId = existingRow?.id || id();
  if (existingRow?.id) {
    return adminDb.tx.notificationUnreadCounts[rowId].update({
      unreadCount: next,
      updatedAt: now,
    });
  }
  return adminDb.tx.notificationUnreadCounts[rowId].update({
    userId: uid,
    unreadCount: next,
    updatedAt: now,
  });
}

export function buildUnreadCountSetTx(adminDb, userId, unreadCount, existingRow, now = new Date().toISOString()) {
  const uid = String(userId ?? '').trim();
  if (!uid) return null;
  const next = Math.max(0, Math.floor(Number(unreadCount) || 0));
  const rowId = existingRow?.id || id();
  if (existingRow?.id) {
    return adminDb.tx.notificationUnreadCounts[rowId].update({
      unreadCount: next,
      updatedAt: now,
    });
  }
  return adminDb.tx.notificationUnreadCounts[rowId].update({
    userId: uid,
    unreadCount: next,
    updatedAt: now,
  });
}

/** Append counter increment txs for notification create txs (same Admin transact). */
export async function appendUnreadCountIncrementTxs(adminDb, notificationTxs) {
  const recipients = extractNotificationRecipientIdsFromTxs(notificationTxs);
  const deltas = tallyRecipientDeltas(recipients);
  if (!deltas.size) return [];
  const existing = await loadUnreadCountRows(adminDb, [...deltas.keys()]);
  const now = new Date().toISOString();
  const txs = [];
  for (const [userId, delta] of deltas) {
    const tx = buildUnreadCountDeltaTx(adminDb, userId, delta, existing.get(userId) || null, now);
    if (tx) txs.push(tx);
  }
  return txs;
}

export async function applyUnreadCountDeltas(adminDb, deltasInput) {
  const deltas =
    deltasInput instanceof Map
      ? deltasInput
      : tallyRecipientDeltas(
          Object.entries(deltasInput || {}).flatMap(([uid, n]) =>
            Array(Math.max(0, Math.floor(Number(n) || 0))).fill(uid),
          ),
        );
  // Prefer numeric map when caller passed Record<userId, number>
  let map;
  if (deltasInput && typeof deltasInput === 'object' && !(deltasInput instanceof Map)) {
    map = new Map();
    for (const [uid, n] of Object.entries(deltasInput)) {
      const key = String(uid ?? '').trim();
      const delta = Math.floor(Number(n) || 0);
      if (!key || !delta) continue;
      map.set(key, (map.get(key) ?? 0) + delta);
    }
  } else {
    map = deltas;
  }
  if (!map.size) return { bumped: 0 };
  const existing = await loadUnreadCountRows(adminDb, [...map.keys()]);
  const now = new Date().toISOString();
  const txs = [];
  for (const [userId, delta] of map) {
    const tx = buildUnreadCountDeltaTx(adminDb, userId, delta, existing.get(userId) || null, now);
    if (tx) txs.push(tx);
  }
  if (txs.length) await adminDb.transact(txs);
  return { bumped: txs.length };
}

/**
 * Page unread notifications for a recipient (Admin). Yields batches newest-first.
 * Uses createdAt cursor ($lt) so reconcile can count without mutating.
 */
export async function pageUnreadNotifications(adminDb, recipientUserId, limit = PAGE) {
  const batches = [];
  let beforeCreatedAt = null;
  for (;;) {
    const where = beforeCreatedAt
      ? {
          and: [
            { recipientUserId },
            { readAt: '' },
            { createdAt: { $lt: beforeCreatedAt } },
          ],
        }
      : { recipientUserId, readAt: '' };
    const result = await adminDb.query({
      notifications: {
        $: {
          where,
          order: { createdAt: 'desc' },
          limit,
        },
      },
    });
    const rows = result.notifications || [];
    if (!rows.length) break;
    batches.push(rows);
    if (rows.length < limit) break;
    const last = rows[rows.length - 1];
    const nextCursor = last?.createdAt;
    if (!nextCursor || nextCursor === beforeCreatedAt) break;
    beforeCreatedAt = nextCursor;
  }
  return batches;
}

export async function countUnreadNotifications(adminDb, recipientUserId) {
  const batches = await pageUnreadNotifications(adminDb, recipientUserId, PAGE);
  return batches.reduce((sum, b) => sum + b.length, 0);
}

/**
 * Mark all unread for recipient: query unread → update readAt → repeat until empty.
 * Avoids relying on client downloading all unread ids.
 */
export async function markAllUnreadRead(adminDb, recipientUserId, batchSize = 50) {
  const readAt = new Date().toISOString();
  let marked = 0;
  for (;;) {
    const result = await adminDb.query({
      notifications: {
        $: {
          where: { recipientUserId, readAt: '' },
          order: { createdAt: 'desc' },
          limit: PAGE,
        },
      },
    });
    const rows = result.notifications || [];
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const txs = slice.map((n) =>
        adminDb.tx.notifications[n.id].update({ readAt }),
      );
      if (txs.length) {
        await adminDb.transact(txs);
        marked += txs.length;
      }
    }
  }
  const existing = await loadUnreadCountRows(adminDb, [recipientUserId]);
  const setTx = buildUnreadCountSetTx(
    adminDb,
    recipientUserId,
    0,
    existing.get(recipientUserId) || null,
  );
  if (setTx) await adminDb.transact([setTx]);
  return { marked };
}

export async function reconcileUnreadCount(adminDb, userId) {
  const unreadCount = await countUnreadNotifications(adminDb, userId);
  const existing = await loadUnreadCountRows(adminDb, [userId]);
  const setTx = buildUnreadCountSetTx(
    adminDb,
    userId,
    unreadCount,
    existing.get(userId) || null,
  );
  if (setTx) await adminDb.transact([setTx]);
  return { unreadCount };
}
