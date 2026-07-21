import { useEffect, useRef, useState } from 'react';
import type { LayoutOrientation, WatermarkDirection } from '../lib/cameraMediaTransform';

export type TiltSource = 'viewport' | 'sensor' | 'portrait-default';

export interface DeviceLayoutOrientation {
  /** UI chrome only — always follows the real viewport (never fakes landscape chrome). */
  layoutOrientation: LayoutOrientation;
  tiltSource: TiltSource;
  sensorAvailable: boolean;
  /** Screen orientation angle when available (0/90/180/270). */
  screenAngle: number | null;
  /**
   * Rotation applied to the watermark only when the phone is held sideways
   * while the viewport stays portrait (system auto-rotate OFF).
   * 0 when upright or when the OS already rotated the page to landscape.
   */
  watermarkTiltRotation: WatermarkDirection;
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

export function orientationFromScreenAngle(angle: number): LayoutOrientation | null {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  if (a <= LANDSCAPE_ANGLE_TOLERANCE || a >= 360 - LANDSCAPE_ANGLE_TOLERANCE) return 'portrait';
  if (Math.abs(a - 180) <= LANDSCAPE_ANGLE_TOLERANCE) return 'portrait';
  if (Math.abs(a - 90) <= LANDSCAPE_ANGLE_TOLERANCE || Math.abs(a - 270) <= LANDSCAPE_ANGLE_TOLERANCE) {
    return 'landscape';
  }
  return null;
}

export function orientationFromDeviceMotion(
  beta: number | null | undefined,
  gamma: number | null | undefined,
): LayoutOrientation | null {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return null;
  }
  const absG = Math.abs(gamma);
  const absB = Math.abs(beta);
  if (absG > 45 && absG > absB - 10) return 'landscape';
  if (absB > 35 && absG < 40) return 'portrait';
  return null;
}

/** Watermark-only tilt when viewport is still portrait. */
export function watermarkTiltFromSensor(
  gamma: number | null | undefined,
  screenAngle: number | null,
): WatermarkDirection {
  if (screenAngle != null) {
    const a = ((Math.round(screenAngle) % 360) + 360) % 360;
    if (Math.abs(a - 90) <= LANDSCAPE_ANGLE_TOLERANCE) return 90;
    if (Math.abs(a - 270) <= LANDSCAPE_ANGLE_TOLERANCE) return 270;
  }
  if (gamma != null && Number.isFinite(gamma)) {
    if (gamma < -45) return 90;
    if (gamma > 45) return 270;
  }
  return 90;
}

/** @deprecated Use watermarkTiltFromSensor */
export const gravityRotationFromSensor = watermarkTiltFromSensor;

export function readScreenAngle(): number | null {
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
 * Viewport drives camera chrome (fullscreen portrait vs true landscape).
 * Sensor tilt only rotates the watermark when auto-rotate is OFF.
 */
export function useDeviceLayoutOrientation(enabled = true): DeviceLayoutOrientation {
  const [layoutOrientation, setLayoutOrientation] = useState<LayoutOrientation>(() =>
    enabled ? readViewportOrientation() : 'portrait',
  );
  const [tiltSource, setTiltSource] = useState<TiltSource>('viewport');
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [watermarkTiltRotation, setWatermarkTiltRotation] = useState<WatermarkDirection>(0);
  const [screenAngle, setScreenAngle] = useState<number | null>(() =>
    enabled ? readScreenAngle() : null,
  );
  const pendingTiltRef = useRef<{ next: WatermarkDirection; at: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGammaRef = useRef<number | null>(null);
  const tiltRef = useRef(watermarkTiltRotation);

  useEffect(() => {
    tiltRef.current = watermarkTiltRotation;
  }, [watermarkTiltRotation]);

  useEffect(() => {
    if (!enabled) {
      setLayoutOrientation('portrait');
      setTiltSource('portrait-default');
      setSensorAvailable(false);
      setWatermarkTiltRotation(0);
      setScreenAngle(null);
      return;
    }

    const commitTilt = (next: WatermarkDirection) => {
      if (next === tiltRef.current) return;
      const now = Date.now();
      const pending = pendingTiltRef.current;
      if (!pending || pending.next !== next) {
        pendingTiltRef.current = { next, at: now };
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          const p = pendingTiltRef.current;
          if (p && p.next === next) {
            setWatermarkTiltRotation(next);
            pendingTiltRef.current = null;
          }
        }, HYSTERESIS_MS);
        return;
      }
      if (now - pending.at < HYSTERESIS_MS) return;
      pendingTiltRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setWatermarkTiltRotation(next);
    };

    const recompute = (sensorHint: LayoutOrientation | null = null) => {
      const viewport = readViewportOrientation();
      setLayoutOrientation(viewport);
      setTiltSource(viewport === 'landscape' ? 'viewport' : 'viewport');
      setScreenAngle(readScreenAngle());

      // OS landscape: page is already upright — no extra watermark spin.
      if (viewport === 'landscape') {
        commitTilt(0);
        return;
      }

      const screenAngle = readScreenAngle();
      const fromAngle = screenAngle != null ? orientationFromScreenAngle(screenAngle) : null;
      const hold = sensorHint ?? fromAngle;
      if (hold === 'landscape') {
        setTiltSource('sensor');
        commitTilt(watermarkTiltFromSensor(lastGammaRef.current, screenAngle));
        return;
      }
      commitTilt(0);
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
        setSensorAvailable(false);
        return;
      }
      setSensorAvailable(true);
      orientationHandler = (e: DeviceOrientationEvent) => {
        if (e.gamma != null && Number.isFinite(e.gamma)) lastGammaRef.current = e.gamma;
        recompute(orientationFromDeviceMotion(e.beta, e.gamma));
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
      if (orientationHandler) window.removeEventListener('deviceorientation', orientationHandler);
    };
  }, [enabled]);

  return {
    layoutOrientation,
    tiltSource,
    sensorAvailable,
    screenAngle,
    watermarkTiltRotation,
  };
}
