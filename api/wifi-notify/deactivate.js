/**
 * POST /api/wifi-notify/deactivate
 * Body: { deviceId, reason? } — mark sessions deactivated (e.g. logout).
 */

import { getAdminDb, parseBody } from '../_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import { deactivateSessions } from '../_lib/push/subscriptions.js';

const ALLOWED_REASONS = new Set([
  'logout',
  'shift_end',
  'auth_expired',
  'store_access_removed',
  'store_deactivated',
  'wifi_ip_deactivated',
  'subscription_removed',
  'replaced',
]);

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
    let reason = String(body.reason || 'logout').trim();
    if (!ALLOWED_REASONS.has(reason)) reason = 'logout';

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
  } catch (e) {
    const status = e?.status || 500;
    console.error('[wifi-notify/deactivate]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Deactivate failed',
    });
  }
}
