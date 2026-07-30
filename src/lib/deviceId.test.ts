/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOrCreateWifiNotifyDeviceId,
  getWifiNotifyDeviceIdStorageKey,
} from './deviceId';

describe('getOrCreateWifiNotifyDeviceId', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('creates and reuses a UUID under heyPelo.wifiNotifyDeviceId', () => {
    const first = getOrCreateWifiNotifyDeviceId();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(localStorage.getItem(getWifiNotifyDeviceIdStorageKey())).toBe(first);
    expect(getOrCreateWifiNotifyDeviceId()).toBe(first);
  });

  it('returns an ephemeral id when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const id = getOrCreateWifiNotifyDeviceId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
