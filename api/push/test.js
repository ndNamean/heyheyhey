/**
 * POST /api/push/test
 * Send one test notification to this device's subscription.
 * Sound/vibration/permission are OS-controlled.
 */

import { getAdminDb, parseBody } from '../_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import { findSubscriptionForDevice } from '../_lib/push/subscriptions.js';
import { sendWebPush } from '../_lib/push/web-push-send.js';
import {
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
    if (!subscription) {
      return res.status(400).json({
        error: 'No active push subscription for this device',
        reason: 'subscription_missing',
      });
    }

    const result = await sendWebPush(subscription, {
      title: 'Store notifications test',
      body: 'If you see this, Web Push is working on this device. Sound and vibration are controlled by your OS / Focus / DND settings.',
      url: '/',
      tag: 'wifi-notify-test',
    });

    if (result.gone) {
      await revokePushSubscription(adminDb, subscription);
      const sessionsResult = await adminDb.query({
        notificationActivationSessions: {
          $: { where: { userId, deviceId } },
        },
      });
      await deactivateSessions(
        adminDb,
        sessionsResult.notificationActivationSessions ?? [],
        'subscription_removed',
      );
      return res.status(410).json({
        error: 'Push subscription expired; please re-enable store notifications',
        reason: 'subscription_gone',
      });
    }

    if (!result.ok) {
      return res.status(502).json({
        error: result.error || 'Push send failed',
        reason: 'push_send_failed',
        note:
          'Permission, sound, and vibration are controlled by the operating system and may be suppressed under Silent / Focus / DND modes.',
      });
    }

    return res.status(200).json({
      ok: true,
      note:
        'Test notification sent. Permission, sound, and vibration are OS-controlled and may be suppressed under Silent / Focus / DND modes.',
    });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[push/test]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Test push failed',
    });
  }
}
