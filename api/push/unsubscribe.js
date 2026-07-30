/**
 * POST /api/push/unsubscribe
 * Revoke subscription for deviceId; deactivate related sessions.
 */

import { getAdminDb, parseBody } from '../_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import {
  findSubscriptionForDevice,
  revokePushSubscription,
  deactivateSessions,
} from '../_lib/push/subscriptions.js';

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

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const subscription = await findSubscriptionForDevice(adminDb, userId, deviceId);
    if (subscription) {
      await revokePushSubscription(adminDb, subscription);
    }

    const sessionsResult = await adminDb.query({
      notificationActivationSessions: {
        $: { where: { userId, deviceId } },
      },
    });
    const deactivated = await deactivateSessions(
      adminDb,
      sessionsResult.notificationActivationSessions ?? [],
      'subscription_removed',
    );

    return res.status(200).json({
      ok: true,
      revoked: Boolean(subscription),
      deactivated,
    });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[push/unsubscribe]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Unsubscribe failed',
    });
  }
}
