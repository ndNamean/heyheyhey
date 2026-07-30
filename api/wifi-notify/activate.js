/**
 * POST /api/wifi-notify/activate
 * Body: { deviceId, subscription: { endpoint, keys } }
 * Re-validates IP/access/shift; upserts subscription; creates device-scoped session.
 */

import { id } from '@instantdb/admin';
import { getAdminDb, parseBody } from '../_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import { recognizeStoreWifi, loadActiveSessions } from '../_lib/wifi-notify/recognize.js';
import {
  parseSubscriptionPayload,
  upsertPushSubscription,
  deactivateSessions,
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
    const ctx = await loadProfileContext(userId);
    const adminDb = getAdminDb();
    const body = parseBody(req.body) || {};
    const deviceId = String(body.deviceId || '').trim();
    const subscription = parseSubscriptionPayload(body.subscription);

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required', reason: 'invalid_device' });
    }
    if (!subscription) {
      return res.status(400).json({
        error: 'Valid push subscription is required',
        reason: 'invalid_subscription',
      });
    }

    const recognition = await recognizeStoreWifi(req, adminDb, ctx);
    if (!recognition.recognized) {
      return res.status(400).json({
        error: 'Cannot activate store notifications on this network',
        reason: recognition.reason || 'unrecognized',
      });
    }

    const { subscriptionId } = await upsertPushSubscription(adminDb, {
      userId,
      deviceId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      userAgent: userAgentFromReq(req),
    });

    const prior = await loadActiveSessions(adminDb, userId, deviceId);
    await deactivateSessions(adminDb, prior, 'replaced');

    const now = new Date();
    const sessionId = id();
    const storeCode = recognition.store?.code || '';
    await adminDb.transact(
      adminDb.tx.notificationActivationSessions[sessionId].update({
        userId,
        deviceId,
        storeId: recognition.store.id,
        wifiIpId: recognition.wifiIp.id,
        shiftId: recognition.shift.id,
        subscriptionId,
        matchedPublicIp: recognition.publicIp || '',
        storeCode,
        activatedAt: now.toISOString(),
        expiresAt: recognition.expiresAt,
        deactivatedAt: '',
        deactivateReason: '',
      }),
    );

    return res.status(200).json({
      ok: true,
      sessionId,
      storeId: recognition.store.id,
      storeCode,
      expiresAt: recognition.expiresAt,
      shiftId: recognition.shift.id,
      subscriptionId,
    });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[wifi-notify/activate]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Activation failed',
    });
  }
}
