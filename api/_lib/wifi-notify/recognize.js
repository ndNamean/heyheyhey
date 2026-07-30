/**
 * Shared recognition: trusted IP → active wifi IP → store access → overlapping shift.
 */

import { getClientPublicIp } from './request-ip.js';
import { findMatchingActiveWifiIp } from './match.js';
import { parseShiftWindow, shiftOverlapsNow } from './shift-overlap.js';
import { userHasStoreAccess } from './access.js';

function isSchedulableShiftStatus(status) {
  const s = String(status ?? 'scheduled').trim();
  return s === '' || s === 'scheduled' || s === 'swap_requested';
}

/**
 * Pick the overlapping scheduled shift for employee at store (earliest end wins if multiple).
 * @returns {{ shift: object, expiresAt: string } | null}
 */
export function findOverlappingScheduledShift(shifts, storeId, employeeUserId, now = new Date()) {
  const candidates = [];
  for (const shift of shifts ?? []) {
    if (!shift) continue;
    if (shift.storeId !== storeId) continue;
    if (shift.employeeUserId !== employeeUserId) continue;
    if (!isSchedulableShiftStatus(shift.status)) continue;
    if (!shiftOverlapsNow(shift, now)) continue;
    const window = parseShiftWindow(shift.date, shift.startTime, shift.endTime);
    if (!window) continue;
    candidates.push({ shift, expiresAt: window.end.toISOString() });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  return candidates[0];
}

/**
 * Load wifi + stores + overlapping shifts and evaluate recognition for the request IP.
 */
export async function recognizeStoreWifi(req, adminDb, ctx, now = new Date()) {
  const publicIp = getClientPublicIp(req);
  if (!publicIp) {
    return {
      recognized: false,
      reason: 'no_public_ip',
      publicIp: null,
      wifiIp: null,
      store: null,
      shift: null,
      expiresAt: null,
    };
  }

  const data = await adminDb.query({
    storeWifiIps: {
      $: { where: { active: true } },
    },
    stores: {},
  });

  const wifiIps = data.storeWifiIps ?? [];
  const storesById = new Map((data.stores ?? []).map((s) => [s.id, s]));
  const match = findMatchingActiveWifiIp(publicIp, wifiIps, storesById);

  if (!match) {
    return {
      recognized: false,
      reason: 'ip_unrecognized',
      publicIp,
      wifiIp: null,
      store: null,
      shift: null,
      expiresAt: null,
    };
  }

  const store = match.store ?? storesById.get(match.wifiIp.storeId) ?? null;
  if (!store || store.active === false) {
    return {
      recognized: false,
      reason: 'store_inactive',
      publicIp,
      wifiIp: match.wifiIp,
      store,
      shift: null,
      expiresAt: null,
    };
  }

  if (!userHasStoreAccess(ctx, store.id)) {
    return {
      recognized: false,
      reason: 'no_store_access',
      publicIp,
      wifiIp: match.wifiIp,
      store,
      shift: null,
      expiresAt: null,
    };
  }

  const shiftResult = await adminDb.query({
    shifts: {
      $: {
        where: {
          employeeUserId: ctx.userId,
          storeId: store.id,
        },
      },
    },
  });

  const overlap = findOverlappingScheduledShift(
    shiftResult.shifts ?? [],
    store.id,
    ctx.userId,
    now,
  );

  if (!overlap) {
    return {
      recognized: false,
      reason: 'no_overlapping_shift',
      publicIp,
      wifiIp: match.wifiIp,
      store,
      shift: null,
      expiresAt: null,
    };
  }

  return {
    recognized: true,
    reason: null,
    publicIp,
    wifiIp: match.wifiIp,
    store,
    shift: overlap.shift,
    expiresAt: overlap.expiresAt,
  };
}

/**
 * Load active (non-deactivated, non-expired) activation sessions for a user+device.
 */
export async function loadActiveSessions(adminDb, userId, deviceId, now = new Date()) {
  const result = await adminDb.query({
    notificationActivationSessions: {
      $: {
        where: {
          userId,
          deviceId,
        },
      },
    },
  });
  const nowMs = now.getTime();
  return (result.notificationActivationSessions ?? []).filter((s) => {
    if (!s) return false;
    if (String(s.deactivatedAt || '') !== '') return false;
    const exp = Date.parse(s.expiresAt);
    if (!Number.isFinite(exp) || exp <= nowMs) return false;
    return true;
  });
}
