/**
 * Vercel Serverless — Store Wi-Fi notify + Web Push (single function for Hobby limit).
 *
 * Actions via ?action= or body.action:
 *   client-ip | status | activate | deactivate
 *   vapid-public-key | subscribe | unsubscribe | test | deliver
 */

import { id } from '@instantdb/admin';
import {
  getAdminDb,
  parseBody,
} from './_lib/export/instant-admin.js';
import {
  loadProfileContext,
  verifyRequestUser,
} from './_lib/export/auth.js';
import { getClientPublicIp } from './_lib/wifi-notify/request-ip.js';
import { roleCanEditMaster } from './_lib/wifi-notify/access.js';
import {
  recognizeStoreWifi,
  loadActiveSessions,
} from './_lib/wifi-notify/recognize.js';
import {
  parseSubscriptionPayload,
  upsertPushSubscription,
  deactivateSessions,
  findSubscriptionForDevice,
  revokePushSubscription,
} from './_lib/push/subscriptions.js';
import { getVapidConfig, sendWebPush } from './_lib/push/web-push-send.js';
import { deliverPushForNotificationIds } from './_lib/push/deliver-notifications.js';

const ALLOWED_DEACTIVATE_REASONS = new Set([
  'logout',
  'shift_end',
  'auth_expired',
  'store_access_removed',
  'store_deactivated',
  'wifi_ip_deactivated',
  'subscription_removed',
  'replaced',
]);

function userAgentFromReq(req) {
  const raw = req.headers?.['user-agent'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value || '').slice(0, 500);
}

function resolveAction(req, body) {
  const fromQuery = req.query?.action;
  const q = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (q && String(q).trim()) return String(q).trim();
  if (body?.action && String(body.action).trim()) return String(body.action).trim();
  return '';
}

async function handleClientIp(req, res) {
  const { userId } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  if (!roleCanEditMaster(ctx.role, ctx.roleDefinition, ctx.roleDefinitions)) {
    return res.status(403).json({ error: 'Forbidden: canEditMaster required' });
  }
  getAdminDb();
  return res.status(200).json({ publicIp: getClientPublicIp(req) });
}

async function handleStatus(req, res, body) {
  const { userId } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  const adminDb = getAdminDb();
  const deviceId = String(body.deviceId || '').trim();

  const recognition = await recognizeStoreWifi(req, adminDb, ctx);
  const canSeeIp = roleCanEditMaster(
    ctx.role,
    ctx.roleDefinition,
    ctx.roleDefinitions,
  );

  let activeSession = null;
  if (deviceId) {
    const sessions = await loadActiveSessions(adminDb, userId, deviceId);
    const preferred =
      sessions.find((s) => recognition.store && s.storeId === recognition.store.id) ||
      sessions[0] ||
      null;
    if (preferred) {
      activeSession = {
        id: preferred.id,
        storeId: preferred.storeId,
        storeCode: preferred.storeCode || '',
        expiresAt: preferred.expiresAt,
      };
    }
  }

  const payload = {
    recognized: recognition.recognized,
    reason: recognition.reason,
    storeId: recognition.store?.id ?? activeSession?.storeId ?? null,
    storeCode: recognition.store?.code ?? activeSession?.storeCode ?? null,
    shiftId: null,
    expiresAt: activeSession?.expiresAt ?? recognition.expiresAt ?? '',
    sessionActive: Boolean(activeSession),
    activeSession,
  };
  if (canSeeIp) payload.matchedPublicIp = recognition.publicIp;
  return res.status(200).json(payload);
}

async function handleActivate(req, res, body) {
  const { userId } = await verifyRequestUser(req);
  const ctx = await loadProfileContext(userId);
  const adminDb = getAdminDb();
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
      shiftId: '',
      subscriptionId,
      matchedPublicIp: recognition.publicIp || '',
      storeCode,
      activatedAt: now.toISOString(),
      // '' = no time expiry; ends on logout / access / IP / store / subscription.
      expiresAt: '',
      deactivatedAt: '',
      deactivateReason: '',
    }),
  );

  return res.status(200).json({
    ok: true,
    sessionId,
    storeId: recognition.store.id,
    storeCode,
    expiresAt: '',
    shiftId: '',
    subscriptionId,
  });
}

async function handleDeactivate(req, res, body) {
  const { userId } = await verifyRequestUser(req);
  await loadProfileContext(userId);
  const adminDb = getAdminDb();
  const deviceId = String(body.deviceId || '').trim();
  let reason = String(body.reason || 'logout').trim();
  if (!ALLOWED_DEACTIVATE_REASONS.has(reason)) reason = 'logout';

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  const result = await adminDb.query({
    notificationActivationSessions: {
      $: { where: { userId, deviceId } },
    },
  });

  const count = await deactivateSessions(
    adminDb,
    result.notificationActivationSessions ?? [],
    reason,
  );
  return res.status(200).json({ ok: true, deactivated: count });
}

async function handleVapidPublicKey(req, res) {
  const { userId } = await verifyRequestUser(req);
  await loadProfileContext(userId);
  const { publicKey } = getVapidConfig();
  return res.status(200).json({ publicKey });
}

async function handleSubscribe(req, res, body) {
  const { userId } = await verifyRequestUser(req);
  await loadProfileContext(userId);
  const adminDb = getAdminDb();
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
}

async function handleUnsubscribe(req, res, body) {
  const { userId } = await verifyRequestUser(req);
  await loadProfileContext(userId);
  const adminDb = getAdminDb();
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
}

async function handleTest(req, res, body) {
  const { userId } = await verifyRequestUser(req);
  await loadProfileContext(userId);
  const adminDb = getAdminDb();
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
}

async function handleDeliver(req, res, body) {
  const { userId } = await verifyRequestUser(req);
  await loadProfileContext(userId);

  const raw = body.notificationIds;
  const notificationIds = Array.isArray(raw)
    ? raw.filter((nid) => typeof nid === 'string' && nid.trim())
    : [];

  if (!notificationIds.length) {
    return res.status(400).json({ error: 'notificationIds required' });
  }

  const { results } = await deliverPushForNotificationIds(notificationIds);
  return res.status(200).json({ ok: true, results });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req.body) || {};
  const action = resolveAction(req, body);

  try {
    switch (action) {
      case 'client-ip':
        return await handleClientIp(req, res);
      case 'status':
        return await handleStatus(req, res, body);
      case 'activate':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleActivate(req, res, body);
      case 'deactivate':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleDeactivate(req, res, body);
      case 'vapid-public-key':
        return await handleVapidPublicKey(req, res);
      case 'subscribe':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleSubscribe(req, res, body);
      case 'unsubscribe':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleUnsubscribe(req, res, body);
      case 'test':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleTest(req, res, body);
      case 'deliver':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleDeliver(req, res, body);
      default:
        return res.status(400).json({
          error: 'Unknown or missing action',
          actions: [
            'client-ip',
            'status',
            'activate',
            'deactivate',
            'vapid-public-key',
            'subscribe',
            'unsubscribe',
            'test',
            'deliver',
          ],
        });
    }
  } catch (e) {
    const status = e?.status || 500;
    console.error('[wifi-push]', action, e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Request failed',
    });
  }
}
