/**
 * POST /api/push/subscribe
 * Upsert Web Push subscription for deviceId (may run before activate).
 */

import { getAdminDb, parseBody } from '../_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import {
  parseSubscriptionPayload,
  upsertPushSubscription,
} from '../_lib/push/subscriptions.js';

function userAgentFromReq(req) {
  const raw = req.headers?.['user-agent'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value || '').slice(0, 500);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = await verifyRequestUser(req);
    await loadProfileContext(userId);
    const adminDb = getAdminDb();
    const body = parseBody(req.body) || {};
    const deviceId = String(body.deviceId || '').trim();
    const subscription = parseSubscriptionPayload(body.subscription);

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    if (!subscription) {
      return res.status(400).json({ error: 'Valid push subscription is required' });
    }

    const { subscriptionId, created } = await upsertPushSubscription(adminDb, {
      userId,
      deviceId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      userAgent: userAgentFromReq(req),
    });

    return res.status(200).json({ ok: true, subscriptionId, created });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[push/subscribe]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Subscribe failed',
    });
  }
}
