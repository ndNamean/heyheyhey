/**
 * Vercel Serverless — notification counter + mark-all (single function for Hobby).
 *
 * Actions via ?action= or body.action:
 *   mark-all-read | reconcile-unread-count | bump-unread
 *
 * Path aliases (vercel.json):
 *   /api/notifications/mark-all-read → mark-all-read
 */

import {
  getAdminDb,
  parseBody,
} from './_lib/export/instant-admin.js';
import {
  loadProfileContext,
  verifyRequestUser,
} from './_lib/export/auth.js';
import {
  applyUnreadCountDeltas,
  markAllUnreadRead,
  reconcileUnreadCount,
} from './_lib/notifications/unread-count.js';

function actionFromReq(req, body) {
  const q = req.query?.action;
  if (typeof q === 'string' && q.trim()) return q.trim();
  if (Array.isArray(q) && q[0]) return String(q[0]).trim();
  if (body && typeof body.action === 'string' && body.action.trim()) {
    return body.action.trim();
  }
  // Nested path rewrite fallback: /api/notifications/mark-all-read
  const url = String(req.url || '');
  if (url.includes('mark-all-read')) return 'mark-all-read';
  if (url.includes('reconcile-unread-count')) return 'reconcile-unread-count';
  if (url.includes('bump-unread')) return 'bump-unread';
  return '';
}

async function requireApproved(req) {
  const { userId } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  return ctx;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = parseBody(req.body) || {};
    const action = actionFromReq(req, body);
    const ctx = await requireApproved(req);
    const adminDb = getAdminDb();

    if (action === 'mark-all-read') {
      const result = await markAllUnreadRead(adminDb, ctx.userId);
      res.status(200).json({ ok: true, marked: result.marked });
      return;
    }

    if (action === 'reconcile-unread-count') {
      const result = await reconcileUnreadCount(adminDb, ctx.userId);
      res.status(200).json({ ok: true, unreadCount: result.unreadCount });
      return;
    }

    if (action === 'bump-unread') {
      const deltas = body.deltas && typeof body.deltas === 'object' ? body.deltas : null;
      const recipientUserIds = Array.isArray(body.recipientUserIds)
        ? body.recipientUserIds
        : null;
      if (!deltas && !recipientUserIds) {
        res.status(400).json({ error: 'deltas or recipientUserIds required' });
        return;
      }
      const result = deltas
        ? await applyUnreadCountDeltas(adminDb, deltas)
        : await applyUnreadCountDeltas(
            adminDb,
            Object.fromEntries(
              [...recipientUserIds].reduce((m, uid) => {
                const k = String(uid ?? '').trim();
                if (!k) return m;
                m.set(k, (m.get(k) ?? 0) + 1);
                return m;
              }, new Map()),
            ),
          );
      res.status(200).json({ ok: true, bumped: result.bumped });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Internal error' });
  }
}
