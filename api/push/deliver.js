/**
 * POST /api/push/deliver
 * Body: { notificationIds: string[] }
 * Triggers gated Web Push for inbox notification rows (never mutates inbox).
 */

import {
  loadProfileContext,
  verifyRequestUser,
} from '../_lib/export/auth.js';
import { parseBody } from '../_lib/export/instant-admin.js';
import { deliverPushForNotificationIds } from '../_lib/push/deliver-notifications.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = await verifyRequestUser(req);
    await loadProfileContext(userId);

    const body = parseBody(req.body) || {};
    const raw = body.notificationIds;
    const notificationIds = Array.isArray(raw)
      ? raw.filter((id) => typeof id === 'string' && id.trim())
      : [];

    if (!notificationIds.length) {
      return res.status(400).json({ error: 'notificationIds required' });
    }

    const { results } = await deliverPushForNotificationIds(notificationIds);
    return res.status(200).json({ ok: true, results });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Deliver failed',
    });
  }
}
