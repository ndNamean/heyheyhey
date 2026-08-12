/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRememberedLocationDenial,
  getCurrentDeviceLocation,
  getDeviceLocationPermissionState,
  getLocationDeniedStorageKey,
  hasRememberedLocationDenial,
  rememberLocationDenial,
} from './deviceLocation';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('location denial memory', () => {
  it('uses a stable storage key and remember/clear cycle', () => {
    expect(getLocationDeniedStorageKey()).toBe('heyPelo.wifiNotifyLocationDenied');
    expect(hasRememberedLocationDenial()).toBe(false);
    rememberLocationDenial();
    expect(localStorage.getItem(getLocationDeniedStorageKey())).toBe('1');
    expect(hasRememberedLocationDenial()).toBe(true);
    clearRememberedLocationDenial();
    expect(hasRememberedLocationDenial()).toBe(false);
  });
});

describe('getDeviceLocationPermissionState', () => {
  it('returns unsupported without geolocation', async () => {
    vi.stubGlobal('navigator', {});
    expect(await getDeviceLocationPermissionState()).toBe('unsupported');
  });

  it('returns permissions.query state when available', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {},
      permissions: { query: async () => ({ state: 'denied' }) },
    });
    expect(await getDeviceLocationPermissionState()).toBe('denied');
  });
});

describe('getCurrentDeviceLocation', () => {
  it('returns location_unsupported when geolocation is missing', async () => {
    vi.stubGlobal('navigator', {});
    expect(await getCurrentDeviceLocation()).toEqual({
      ok: false,
      reason: 'location_unsupported',
    });
  });

  it('returns coords and clears remembered denial on success', async () => {
    rememberLocationDenial();
    const getCurrentPosition = vi.fn((ok: (pos: GeolocationPosition) => void) => {
      ok({
        coords: { latitude: 10.5, longitude: 106.7, accuracy: 8 },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition },
    });

    const out = await getCurrentDeviceLocation();
    expect(out).toMatchObject({
      ok: true,
      lat: 10.5,
      lng: 106.7,
      accuracy: 8,
    });
    expect(hasRememberedLocationDenial()).toBe(false);
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      }),
    );
  });

  it('remembers denial when permission is denied', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (
          _ok: unknown,
          err: (error: GeolocationPositionError) => void,
        ) => {
          err({
            code: 1,
            message: 'denied',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      },
    });
    expect(await getCurrentDeviceLocation()).toEqual({
      ok: false,
      reason: 'location_denied',
    });
    expect(hasRememberedLocationDenial()).toBe(true);
  });

  it('maps timeout and unavailable without remembering denial', async () => {
    const stubErr = (code: number) => {
      vi.stubGlobal('navigator', {
        geolocation: {
          getCurrentPosition: (
            _ok: unknown,
            err: (error: GeolocationPositionError) => void,
          ) => {
            err({
              code,
              message: 'x',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            } as GeolocationPositionError);
          },
        },
      });
    };

    stubErr(3);
    expect(await getCurrentDeviceLocation()).toEqual({
      ok: false,
      reason: 'location_timeout',
    });
    expect(hasRememberedLocationDenial()).toBe(false);

    stubErr(2);
    expect(await getCurrentDeviceLocation()).toEqual({
      ok: false,
      reason: 'location_unavailable',
    });
    expect(hasRememberedLocationDenial()).toBe(false);
  });
});
