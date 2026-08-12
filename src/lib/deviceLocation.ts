/**
 * One-shot device geolocation for store presence (wifi-notify geofence fallback).
 * Notifications must not depend on camera; TimemarkCamera / Shifts can adopt later.
 */

const LOCATION_DENIED_STORAGE_KEY = 'heyPelo.wifiNotifyLocationDenied';

export type DeviceLocationSuccess = {
  ok: true;
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
};

export type DeviceLocationFailureReason =
  | 'location_denied'
  | 'location_unavailable'
  | 'location_timeout'
  | 'location_unsupported';

export type DeviceLocationFailure = {
  ok: false;
  reason: DeviceLocationFailureReason;
};

export type DeviceLocationResult = DeviceLocationSuccess | DeviceLocationFailure;

export type DeviceLocationPermission =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unsupported'
  | 'unknown';

export function getLocationDeniedStorageKey(): string {
  return LOCATION_DENIED_STORAGE_KEY;
}

export function hasRememberedLocationDenial(): boolean {
  try {
    return localStorage.getItem(LOCATION_DENIED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberLocationDenial(): void {
  try {
    localStorage.setItem(LOCATION_DENIED_STORAGE_KEY, '1');
  } catch {
    // private mode / SSR
  }
}

export function clearRememberedLocationDenial(): void {
  try {
    localStorage.removeItem(LOCATION_DENIED_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function getDeviceLocationPermissionState(): Promise<DeviceLocationPermission> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'unsupported';
  }
  const permissions = navigator.permissions;
  if (!permissions?.query) return 'unknown';
  try {
    const status = await permissions.query({ name: 'geolocation' });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function getCurrentDeviceLocation(options?: {
  timeoutMs?: number;
  maximumAgeMs?: number;
  enableHighAccuracy?: boolean;
}): Promise<DeviceLocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { ok: false, reason: 'location_unsupported' };
  }

  const timeoutMs = options?.timeoutMs ?? 15_000;
  const maximumAgeMs = options?.maximumAgeMs ?? 0;
  const enableHighAccuracy = options?.enableHighAccuracy ?? true;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        if (![lat, lng, accuracy].every((n) => Number.isFinite(n))) {
          resolve({ ok: false, reason: 'location_unavailable' });
          return;
        }
        clearRememberedLocationDenial();
        resolve({
          ok: true,
          lat,
          lng,
          accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      (err) => {
        const code = err?.code;
        if (code === 1) {
          rememberLocationDenial();
          resolve({ ok: false, reason: 'location_denied' });
          return;
        }
        if (code === 3) {
          resolve({ ok: false, reason: 'location_timeout' });
          return;
        }
        resolve({ ok: false, reason: 'location_unavailable' });
      },
      {
        enableHighAccuracy,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      },
    );
  });
}
