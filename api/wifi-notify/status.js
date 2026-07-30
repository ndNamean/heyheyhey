/**
 * POST /api/wifi-notify/status
 * Match trusted header IP to store Wi-Fi + access + overlapping shift.
 * Does not create a session. Observed IP only returned for canEditMaster.
 */

import { getAdminDb } from '../_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import { parseBody } from '../_lib/export/instant-admin.js';
import { roleCanEditMaster } from '../_lib/wifi-notify/access.js';
import {
  recognizeStoreWifi,
  loadActiveSessions,
} from '../_lib/wifi-notify/recognize.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = await verifyRequestUser(req);
    const ctx = await loadProfileContext(userId);
    const adminDb = getAdminDb();
    const body = parseBody(req.body) || {};
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

    const sessionActive = Boolean(activeSession);
    const payload = {
      recognized: recognition.recognized,
      reason: recognition.reason,
      storeId: recognition.store?.id ?? activeSession?.storeId ?? null,
      storeCode: recognition.store?.code ?? activeSession?.storeCode ?? null,
      shiftId: recognition.shift?.id ?? null,
      // Prefer active session expiry for UI; fall back to recognized shift end.
      expiresAt: activeSession?.expiresAt ?? recognition.expiresAt,
      sessionActive,
      activeSession,
    };

    if (canSeeIp) {
      payload.matchedPublicIp = recognition.publicIp;
    }

    return res.status(200).json(payload);
  } catch (e) {
    const status = e?.status || 500;
    console.error('[wifi-notify/status]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Status check failed',
    });
  }
}
