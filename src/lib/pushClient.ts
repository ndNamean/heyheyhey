/**
 * Client helpers for Web Push + wifi-notify activation APIs.
 */

import { db } from '../db';
import type { NotificationActivationMethod } from '../types';
import { getOrCreateWifiNotifyDeviceId } from './deviceId';

export type PushPermissionState = NotificationPermission | 'unsupported';

/** Optional body fields for wifi-push status / activate (geofence fallback). */
export type WifiNotifyLocationPayload = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type WifiNotifyStatusResponse = {
  recognized: boolean;
  reason?: string | null;
  method?: NotificationActivationMethod | null;
  storeId?: string | null;
  storeCode?: string | null;
  shiftId?: string | null;
  expiresAt?: string | null;
  sessionActive?: boolean;
  matchedPublicIp?: string | null;
  distanceM?: number | null;
  accuracyM?: number | null;
  geofenceRadiusM?: number | null;
  presenceVerifiedAt?: string | null;
  activeSession?: {
    id: string;
    storeId: string;
    storeCode: string;
    expiresAt: string;
    activationMethod?: NotificationActivationMethod | '' | null;
  } | null;
};

export type ActivateWifiNotifyResult = {
  ok: boolean;
  storeId?: string;
  storeCode?: string;
  expiresAt?: string;
  shiftId?: string;
  subscriptionId?: string;
  sessionId?: string;
  method?: NotificationActivationMethod;
  error?: string;
  reason?: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJson(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(resp.ok ? 'Invalid server response' : `Request failed (${resp.status})`);
    }
  }
  if (!resp.ok) {
    throw Object.assign(new Error(String(data.error || `Request failed (${resp.status})`)), {
      status: resp.status,
      data,
    });
  }
  return data;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function parseActivationMethod(value: unknown): NotificationActivationMethod | null {
  const s = String(value ?? '').trim();
  if (s === 'wifi_ip' || s === 'geofence') return s;
  return null;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function locationBodyFields(
  location?: WifiNotifyLocationPayload | null,
): Partial<WifiNotifyLocationPayload> {
  if (!location) return {};
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy);
  if (![latitude, longitude, accuracy].every(Number.isFinite)) return {};
  return { latitude, longitude, accuracy };
}

function subscriptionToJson(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint || '',
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
    },
  };
}

export function getPushPermissionState(): PushPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/** @deprecated prefer getPushPermissionState */
export function getPushPermission(): PushPermissionState {
  return getPushPermissionState();
}

const PUSH_SERVICE_UNAVAILABLE_KEY = 'heyhey-push-service-unavailable';

export function isPushServiceUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /push service not available/i.test(msg);
}

/** Cursor/VS Code/Electron expose PushManager but have no FCM/push service. */
export function lacksBrowserPushService(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Electron\/|Cursor\//i.test(navigator.userAgent);
}

function rememberPushServiceUnavailable() {
  try {
    sessionStorage.setItem(PUSH_SERVICE_UNAVAILABLE_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export function isPushSupported(): boolean {
  if (lacksBrowserPushService()) return false;
  try {
    if (sessionStorage.getItem(PUSH_SERVICE_UNAVAILABLE_KEY) === '1') return false;
  } catch {
    /* ignore */
  }
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getVapidPublicKey(): Promise<string> {
  const headers = await authHeaders();
  const resp = await fetch('/api/wifi-push?action=vapid-public-key', {
    method: 'GET',
    headers,
  });
  const data = await parseJson(resp);
  return String(data.publicKey || '');
}

export async function subscribePush(deviceId?: string): Promise<{
  deviceId: string;
  subscriptionId?: string;
}> {
  if (!isPushSupported()) {
    throw new Error('Web Push is not supported in this browser');
  }
  const id = (deviceId || getOrCreateWifiNotifyDeviceId()).trim();
  if (!id) throw new Error('deviceId is required');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw Object.assign(new Error('Notification permission not granted'), {
      reason: 'permission_denied',
      permission,
    });
  }

  const publicKey = await getVapidPublicKey();
  if (!publicKey) throw new Error('Missing VAPID public key');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const headers = await authHeaders();
  const resp = await fetch('/api/wifi-push?action=subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      deviceId: id,
      subscription: subscriptionToJson(subscription),
    }),
  });
  const data = await parseJson(resp);
  return {
    deviceId: id,
    subscriptionId: data.subscriptionId ? String(data.subscriptionId) : undefined,
  };
}

export async function unsubscribePush(deviceId?: string): Promise<void> {
  const id = (deviceId || getOrCreateWifiNotifyDeviceId()).trim();
  const headers = await authHeaders();
  const resp = await fetch('/api/wifi-push?action=unsubscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceId: id }),
  });
  await parseJson(resp);

  if (isPushSupported()) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch {
      // Best-effort local unsubscribe
    }
  }
}

export async function requestPushDelivery(notificationIds: string[]): Promise<void> {
  const ids = (notificationIds || []).map(String).filter(Boolean);
  if (!ids.length) return;
  try {
    const headers = await authHeaders();
    const resp = await fetch('/api/wifi-push?action=deliver', {
      method: 'POST',
      headers,
      body: JSON.stringify({ notificationIds: ids }),
    });
    if (resp.status === 401 || resp.status === 403) {
      await parseJson(resp);
      return;
    }
    if (!resp.ok) {
      console.warn('[pushClient] deliver failed', resp.status);
    }
  } catch (e) {
    console.warn('[pushClient] deliver error', e);
  }
}

export async function sendTestPush(
  deviceId?: string,
): Promise<{ ok: boolean; message?: string }> {
  const id = (deviceId || getOrCreateWifiNotifyDeviceId()).trim();
  try {
    const headers = await authHeaders();
    const resp = await fetch('/api/wifi-push?action=test', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: id }),
    });
    const text = await resp.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { ok: false, message: `Request failed (${resp.status})` };
      }
    }
    const message = String(data.note || data.message || data.error || '');
    if (!resp.ok) {
      return { ok: false, message: message || `Request failed (${resp.status})` };
    }
    return { ok: true, message: message || undefined };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Test push failed',
    };
  }
}

/** Activate store Wi-Fi notifications: subscribe + create activation session. */
export async function activateWifiNotify(
  deviceId?: string,
  location?: WifiNotifyLocationPayload | null,
): Promise<ActivateWifiNotifyResult> {
  try {
    if (!isPushSupported()) {
      return { ok: false, error: 'Web Push is not supported in this browser', reason: 'unsupported' };
    }
    const id = (deviceId || getOrCreateWifiNotifyDeviceId()).trim();

    // Silent path: skip prompt when already granted (still never auto-prompt from UI)
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        ok: false,
        error: 'Notification permission not granted',
        reason: 'permission_denied',
      };
    }

    const publicKey = await getVapidPublicKey();
    if (!publicKey) {
      return { ok: false, error: 'Missing VAPID public key', reason: 'unsupported' };
    }
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      } catch (subErr) {
        if (isPushServiceUnavailableError(subErr)) {
          rememberPushServiceUnavailable();
          return { ok: false, error: 'Web Push is not supported in this browser', reason: 'unsupported' };
        }
        throw subErr;
      }
    }

    const headers = await authHeaders();
    const resp = await fetch('/api/wifi-push?action=activate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        deviceId: id,
        subscription: subscriptionToJson(subscription),
        ...locationBodyFields(location),
      }),
    });

    const text = await resp.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { ok: false, error: `Request failed (${resp.status})` };
      }
    }

    if (!resp.ok) {
      return {
        ok: false,
        error: String(data.error || `Request failed (${resp.status})`),
        reason: data.reason ? String(data.reason) : undefined,
      };
    }

    return {
      ok: true,
      storeId: data.storeId ? String(data.storeId) : undefined,
      storeCode: data.storeCode ? String(data.storeCode) : undefined,
      expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
      shiftId: data.shiftId ? String(data.shiftId) : undefined,
      subscriptionId: data.subscriptionId ? String(data.subscriptionId) : undefined,
      sessionId: data.sessionId ? String(data.sessionId) : undefined,
      method: parseActivationMethod(data.method) ?? undefined,
    };
  } catch (e) {
    if (isPushServiceUnavailableError(e)) {
      rememberPushServiceUnavailable();
      return { ok: false, error: 'Web Push is not supported in this browser', reason: 'unsupported' };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Activation failed',
    };
  }
}

export async function deactivateWifiNotify(
  deviceId?: string,
  reason = 'logout',
): Promise<void> {
  const id = (deviceId || getOrCreateWifiNotifyDeviceId()).trim();
  try {
    const headers = await authHeaders();
    const resp = await fetch('/api/wifi-push?action=deactivate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId: id, reason }),
    });
    if (!resp.ok && resp.status !== 401) {
      console.warn('[pushClient] deactivate failed', resp.status);
    }
  } catch (e) {
    console.warn('[pushClient] deactivate error', e);
  }
}

export async function fetchWifiNotifyStatus(
  deviceId?: string,
  location?: WifiNotifyLocationPayload | null,
): Promise<WifiNotifyStatusResponse> {
  const id = (deviceId || getOrCreateWifiNotifyDeviceId()).trim();
  const headers = await authHeaders();
  const resp = await fetch('/api/wifi-push?action=status', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      deviceId: id,
      ...locationBodyFields(location),
    }),
  });
  const data = await parseJson(resp);
  const diagnostics =
    data.diagnostics && typeof data.diagnostics === 'object'
      ? (data.diagnostics as Record<string, unknown>)
      : data;
  const rawSession =
    data.activeSession && typeof data.activeSession === 'object'
      ? (data.activeSession as Record<string, unknown>)
      : null;
  const activeSession = rawSession
    ? {
        id: String(rawSession.id || ''),
        storeId: String(rawSession.storeId || ''),
        storeCode: String(rawSession.storeCode || ''),
        expiresAt: String(rawSession.expiresAt || ''),
        activationMethod: parseActivationMethod(rawSession.activationMethod) ?? '',
      }
    : null;

  const sessionActive = Boolean(
    data.sessionActive === true || activeSession,
  );

  return {
    recognized: Boolean(data.recognized),
    reason: data.reason != null ? String(data.reason) : null,
    method:
      parseActivationMethod(data.method) ??
      parseActivationMethod(activeSession?.activationMethod) ??
      null,
    storeId: data.storeId != null ? String(data.storeId) : null,
    storeCode:
      (data.storeCode != null ? String(data.storeCode) : null) ||
      activeSession?.storeCode ||
      null,
    shiftId: data.shiftId != null ? String(data.shiftId) : null,
    expiresAt:
      (data.expiresAt != null ? String(data.expiresAt) : null) ||
      activeSession?.expiresAt ||
      null,
    sessionActive,
    matchedPublicIp:
      data.matchedPublicIp != null ? String(data.matchedPublicIp) : null,
    distanceM: parseOptionalNumber(data.distanceM ?? diagnostics.distanceM),
    accuracyM: parseOptionalNumber(data.accuracyM ?? diagnostics.accuracyM),
    geofenceRadiusM: parseOptionalNumber(
      data.geofenceRadiusM ?? diagnostics.geofenceRadiusM,
    ),
    presenceVerifiedAt:
      parseOptionalString(data.presenceVerifiedAt ?? diagnostics.presenceVerifiedAt),
    activeSession,
  };
}

export async function fetchClientPublicIp(): Promise<string | null> {
  const headers = await authHeaders();
  const resp = await fetch('/api/wifi-push?action=client-ip', {
    method: 'GET',
    headers,
  });
  const data = await parseJson(resp);
  const ip = data.publicIp;
  return typeof ip === 'string' && ip ? ip : null;
}
