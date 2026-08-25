/**
 * Per-user notification unread counter helpers (badge + mark-read deltas).
 * Create-path bumps use Admin API; client mark-read decrements own row.
 */

import { id } from '@instantdb/react';
import { db } from '../db';
import { nowIso } from './utils';

export type UnreadCountRow = {
  id: string;
  userId: string;
  unreadCount: number;
  updatedAt?: string;
};

export const NOTIFICATION_PAGE_SIZE = 15;

export function tallyRecipientDeltas(recipientUserIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const uid of recipientUserIds) {
    const key = String(uid ?? '').trim();
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function nextUnreadCount(current: number | undefined | null, delta: number): number {
  const base = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  const d = typeof delta === 'number' && Number.isFinite(delta) ? delta : 0;
  return Math.max(0, base + d);
}

type TxFactory = {
  notificationUnreadCounts: Record<
    string,
    { update: (attrs: Record<string, unknown>) => unknown }
  >;
};

/**
 * Build a single counter upsert/delta tx. Pass existingRow when known so the
 * count is current+delta; missing row creates with unreadCount = max(0, delta).
 * Existing-row updates omit userId (perms: only unreadCount + updatedAt).
 */
export function buildUnreadCountDeltaTx(
  userId: string,
  delta: number,
  existingRow?: UnreadCountRow | null,
  opts?: {
    now?: string;
    rowId?: string;
    tx?: TxFactory;
  },
): unknown | null {
  const uid = String(userId ?? '').trim();
  if (!uid || !delta) return null;
  const now = opts?.now ?? nowIso();
  const next = nextUnreadCount(existingRow?.unreadCount, delta);
  const rowId = existingRow?.id || opts?.rowId || id();
  const txRoot = opts?.tx ?? (db.tx as unknown as TxFactory);
  if (existingRow?.id) {
    return txRoot.notificationUnreadCounts[rowId].update({
      unreadCount: next,
      updatedAt: now,
    });
  }
  return txRoot.notificationUnreadCounts[rowId].update({
    userId: uid,
    unreadCount: next,
    updatedAt: now,
  });
}

export function buildUnreadCountDeltaTxs(
  deltas: Map<string, number> | Record<string, number>,
  existingByUserId: Map<string, UnreadCountRow>,
  opts?: { now?: string; tx?: TxFactory },
): unknown[] {
  const entries =
    deltas instanceof Map ? [...deltas.entries()] : Object.entries(deltas);
  const txs: unknown[] = [];
  for (const [userId, delta] of entries) {
    const tx = buildUnreadCountDeltaTx(userId, delta, existingByUserId.get(userId) ?? null, opts);
    if (tx) txs.push(tx);
  }
  return txs;
}

export function buildUnreadCountSetTx(
  userId: string,
  unreadCount: number,
  existingRow?: UnreadCountRow | null,
  opts?: { now?: string; rowId?: string; tx?: TxFactory },
): unknown | null {
  const uid = String(userId ?? '').trim();
  if (!uid) return null;
  const now = opts?.now ?? nowIso();
  const next = Math.max(0, Math.floor(unreadCount));
  const rowId = existingRow?.id || opts?.rowId || id();
  const txRoot = opts?.tx ?? (db.tx as unknown as TxFactory);
  if (existingRow?.id) {
    return txRoot.notificationUnreadCounts[rowId].update({
      unreadCount: next,
      updatedAt: now,
    });
  }
  return txRoot.notificationUnreadCounts[rowId].update({
    userId: uid,
    unreadCount: next,
    updatedAt: now,
  });
}

/** Extract recipientUserId from notification create txs (attrs include recipientUserId). */
export function extractNotificationRecipientIdsFromTxs(txs: unknown[]): string[] {
  const ids: string[] = [];
  for (const chunk of txs) {
    if (!chunk || typeof chunk !== 'object') continue;
    const ops = (chunk as { __ops?: unknown }).__ops;
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      if (!Array.isArray(op) || op.length < 4) continue;
      const [cmd, etype, , attrs] = op;
      if (
        (cmd === 'update' || cmd === 'merge' || cmd === 'create') &&
        etype === 'notifications' &&
        attrs &&
        typeof attrs === 'object' &&
        'recipientUserId' in (attrs as object)
      ) {
        const uid = String((attrs as { recipientUserId?: string }).recipientUserId ?? '').trim();
        if (uid) ids.push(uid);
      }
    }
  }
  return ids;
}

export async function queryUnreadCountRows(
  userIds: string[],
): Promise<Map<string, UnreadCountRow>> {
  const unique = [...new Set(userIds.map((u) => String(u ?? '').trim()).filter(Boolean))];
  const map = new Map<string, UnreadCountRow>();
  if (!unique.length) return map;
  const { data } = await db.queryOnce({
    notificationUnreadCounts: {
      $: { where: { userId: { $in: unique } } },
    },
  });
  for (const row of (data?.notificationUnreadCounts ?? []) as UnreadCountRow[]) {
    if (row?.userId) map.set(row.userId, row);
  }
  return map;
}

/** Client mark-read: decrement own counter (floor 0). No-op if delta >= 0 or no userId. */
export async function buildOwnUnreadDecrementTxs(
  userId: string,
  markedCount: number,
  existingRow?: UnreadCountRow | null,
): Promise<unknown[]> {
  if (!userId || markedCount <= 0) return [];
  let row = existingRow ?? null;
  if (!row) {
    const map = await queryUnreadCountRows([userId]);
    row = map.get(userId) ?? null;
  }
  if (!row) {
    // No counter yet — create at 0 so badge stays coherent after mark-read.
    const tx = buildUnreadCountSetTx(userId, 0, null);
    return tx ? [tx] : [];
  }
  const tx = buildUnreadCountDeltaTx(userId, -markedCount, row);
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

/** Fire-and-forget Admin bump after client notification creates. */
export function scheduleUnreadCountBump(recipientUserIds: string[]): void {
  const deltas = tallyRecipientDeltas(recipientUserIds);
  if (!deltas.size) return;
  const body: Record<string, number> = {};
  for (const [uid, n] of deltas) body[uid] = n;
  void (async () => {
    try {
      const headers = await authHeaders();
      await fetch('/api/notifications?action=bump-unread', {
        method: 'POST',
        headers,
        body: JSON.stringify({ deltas: body }),
      });
    } catch {
      /* badge drift fixed by reconcile */
    }
  })();
}

export function scheduleUnreadCountBumpFromTxs(txs: unknown[]): void {
  scheduleUnreadCountBump(extractNotificationRecipientIdsFromTxs(txs));
}

export async function reconcileOwnUnreadCount(): Promise<number | null> {
  try {
    const headers = await authHeaders();
    const resp = await fetch('/api/notifications?action=reconcile-unread-count', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { unreadCount?: number };
    return typeof json.unreadCount === 'number' ? json.unreadCount : null;
  } catch {
    return null;
  }
}

export async function markAllNotificationsReadViaApi(): Promise<number> {
  const headers = await authHeaders();
  const resp = await fetch('/api/notifications?action=mark-all-read', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(
      typeof (err as { error?: string }).error === 'string'
        ? (err as { error: string }).error
        : `Mark all failed (${resp.status})`,
    );
  }
  const json = (await resp.json()) as { marked?: number };
  return typeof json.marked === 'number' ? json.marked : 0;
}
