import { useEffect, useRef, useState } from 'react';
import type { LayoutOrientation } from '../lib/cameraMediaTransform';

export type TiltSource = 'viewport' | 'sensor' | 'portrait-default';

export interface DeviceLayoutOrientation {
  layoutOrientation: LayoutOrientation;
  tiltSource: TiltSource;
  sensorAvailable: boolean;
  /** True when viewport is portrait but sensor reports landscape hold. */
  sensorDriven: boolean;
  /** Narrow viewport while layout is landscape (portrait-locked OS). */
  compactLandscape: boolean;
}

const LANDSCAPE_ANGLE_TOLERANCE = 25;
const HYSTERESIS_MS = 280;

type DeviceOrientationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

function readViewportOrientation(): LayoutOrientation {
  if (typeof window === 'undefined') return 'portrait';
  try {
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(orientation: landscape)').matches) return 'landscape';
      if (window.matchMedia('(orientation: portrait)').matches) return 'portrait';
    }
  } catch {
    /* ignore */
  }
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

/** Map screen.orientation.angle or beta/gamma-derived angle to layout. */
export function orientationFromScreenAngle(angle: number): LayoutOrientation | null {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  if (a <= LANDSCAPE_ANGLE_TOLERANCE || a >= 360 - LANDSCAPE_ANGLE_TOLERANCE) return 'portrait';
  if (Math.abs(a - 180) <= LANDSCAPE_ANGLE_TOLERANCE) return 'portrait';
  if (Math.abs(a - 90) <= LANDSCAPE_ANGLE_TOLERANCE || Math.abs(a - 270) <= LANDSCAPE_ANGLE_TOLERANCE) {
    return 'landscape';
  }
  return null;
}

/**
 * Infer hold orientation from DeviceOrientationEvent.
 * Uses beta (front-back) and gamma (left-right) when absolute/screen angle unavailable.
 */
export function orientationFromDeviceMotion(
  beta: number | null | undefined,
  gamma: number | null | undefined,
): LayoutOrientation | null {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return null;
  }
  const absG = Math.abs(gamma);
  const absB = Math.abs(beta);
  // Phone on side: gamma near ±90
  if (absG > 45 && absG > absB - 10) return 'landscape';
  // Phone upright / flat-ish portrait
  if (absB > 35 && absG < 40) return 'portrait';
  return null;
}

function readScreenAngle(): number | null {
  const so = typeof window !== 'undefined' ? window.screen?.orientation : undefined;
  if (so && typeof so.angle === 'number' && Number.isFinite(so.angle)) return so.angle;
  const legacy = (window as Window & { orientation?: number }).orientation;
  if (typeof legacy === 'number' && Number.isFinite(legacy)) {
    return ((legacy % 360) + 360) % 360;
  }
  return null;
}

async function ensureOrientationPermission(): Promise<DeviceOrientationPermission> {
  const DOE = typeof window !== 'undefined'
    ? (window as Window & {
        DeviceOrientationEvent?: {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        };
      }).DeviceOrientationEvent
    : undefined;

  if (!DOE) return 'unsupported';
  if (typeof DOE.requestPermission !== 'function') return 'granted';
  try {
    const result = await DOE.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Hybrid tilt: viewport first; DeviceOrientation / screen angle when viewport stays portrait
 * (e.g. system auto-rotate OFF). Does not call screen.orientation.lock().
 */
export function useDeviceLayoutOrientation(enabled = true): DeviceLayoutOrientation {
  const [layoutOrientation, setLayoutOrientation] = useState<LayoutOrientation>(() =>
    enabled ? readViewportOrientation() : 'portrait',
  );
  const [tiltSource, setTiltSource] = useState<TiltSource>('viewport');
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const pendingRef = useRef<{ next: LayoutOrientation; source: TiltSource; at: number } | null>(
    null,
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRef = useRef(layoutOrientation);

  useEffect(() => {
    currentRef.current = layoutOrientation;
  }, [layoutOrientation]);

  useEffect(() => {
    if (!enabled) {
      setLayoutOrientation('portrait');
      setTiltSource('portrait-default');
      setSensorAvailable(false);
      return;
    }

    const commit = (next: LayoutOrientation, source: TiltSource) => {
      if (next === currentRef.current && source === tiltSource) return;
      // Hysteresis when switching via sensor
      if (source === 'sensor' && next !== currentRef.current) {
        const now = Date.now();
        const pending = pendingRef.current;
        if (!pending || pending.next !== next) {
          pendingRef.current = { next, source, at: now };
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            const p = pendingRef.current;
            if (p && p.next === next) {
              setLayoutOrientation(next);
              setTiltSource(source);
              pendingRef.current = null;
            }
          }, HYSTERESIS_MS);
          return;
        }
        if (now - pending.at < HYSTERESIS_MS) return;
      }
      pendingRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setLayoutOrientation(next);
      setTiltSource(source);
    };

    const recompute = (sensorHint: LayoutOrientation | null = null) => {
      const viewport = readViewportOrientation();
      if (viewport === 'landscape') {
        commit('landscape', 'viewport');
        return;
      }
      // Viewport portrait — allow sensor / screen angle to promote landscape
      const screenAngle = readScreenAngle();
      const fromAngle = screenAngle != null ? orientationFromScreenAngle(screenAngle) : null;
      const sensorOrAngle = sensorHint ?? fromAngle;
      if (sensorOrAngle === 'landscape') {
        commit('landscape', 'sensor');
        return;
      }
      commit('portrait', viewport === 'portrait' ? 'viewport' : 'portrait-default');
    };

    recompute();

    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(orientation: landscape)')
        : null;

    const onViewport = () => recompute();

    if (mql) {
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onViewport);
      else (mql as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(onViewport);
    }
    window.addEventListener('resize', onViewport);
    window.visualViewport?.addEventListener('resize', onViewport);
    window.screen?.orientation?.addEventListener?.('change', onViewport);

    let orientationHandler: ((e: DeviceOrientationEvent) => void) | null = null;
    let cancelled = false;

    void (async () => {
      const permission = await ensureOrientationPermission();
      if (cancelled) return;
      if (permission === 'denied' || permission === 'unsupported') {
        setSensorAvailable(permission === 'unsupported' ? false : false);
        return;
      }
      setSensorAvailable(true);
      orientationHandler = (e: DeviceOrientationEvent) => {
        const hint = orientationFromDeviceMotion(e.beta, e.gamma);
        recompute(hint);
      };
      window.addEventListener('deviceorientation', orientationHandler, { passive: true });
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (mql) {
        if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onViewport);
        else
          (mql as MediaQueryList & { removeListener: (cb: () => void) => void }).removeListener(
            onViewport,
          );
      }
      window.removeEventListener('resize', onViewport);
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.screen?.orientation?.removeEventListener?.('change', onViewport);
      if (orientationHandler) {
        window.removeEventListener('deviceorientation', orientationHandler);
      }
    };
    // tiltSource intentionally omitted from deps — only used for equality inside commit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const sensorDriven = tiltSource === 'sensor' && layoutOrientation === 'landscape';
  const compactLandscape =
    layoutOrientation === 'landscape' &&
    typeof window !== 'undefined' &&
    window.innerWidth < 500;

  return {
    layoutOrientation,
    tiltSource,
    sensorAvailable,
    sensorDriven,
    compactLandscape,
  };
}
