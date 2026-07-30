const STORAGE_KEY = 'heyPelo.wifiNotifyDeviceId';

/**
 * Get or create a stable per-browser device id for Wi-Fi push activation.
 * Stored in localStorage under `heyPelo.wifiNotifyDeviceId`.
 */
export function getOrCreateWifiNotifyDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Private mode / SSR — ephemeral id for this call only
    return crypto.randomUUID();
  }
}

/** Alias used by wifi-notify / push client code. */
export const getOrCreateDeviceId = getOrCreateWifiNotifyDeviceId;

export function getWifiNotifyDeviceIdStorageKey(): string {
  return STORAGE_KEY;
}
