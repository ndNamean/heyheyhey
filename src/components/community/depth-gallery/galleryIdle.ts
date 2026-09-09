/**
 * Idle zoom for the Community gallery — contain → cover the stack card.
 * Driven only from existing ScrollController state inside the gallery rAF.
 * Does not feed cameraZ, depthBlend, or mood.
 */

import { clamp, lerp } from './galleryLayers';

/** Wider than VELOCITY_STOP_THRESHOLD so tiny residual motion still counts as still. */
export const IDLE_VELOCITY_THRESHOLD = 0.02;
export const IDLE_TARGET_GAP_THRESHOLD = 0.25;
export const IDLE_DWELL_MS = 220;
/** Similar to scroll smoothing (0.08). */
export const IDLE_LERP_UP = 0.07;
/** Faster return to swipe layout. */
export const IDLE_LERP_DOWN = 0.18;
export const IDLE_CHIP_SCALE = 1.12;

export type GalleryIdleInput = {
  now: number;
  lastNow: number;
  stillMs: number;
  idleAmount: number;
  velocity: number;
  scrollTarget: number;
  scrollCurrent: number;
  reducedMotion: boolean;
};

export type GalleryIdleState = {
  lastNow: number;
  stillMs: number;
  idleAmount: number;
};

export function isGalleryScrollStill(
  velocity: number,
  scrollTarget: number,
  scrollCurrent: number,
): boolean {
  return (
    Math.abs(velocity) < IDLE_VELOCITY_THRESHOLD &&
    Math.abs(scrollTarget - scrollCurrent) < IDLE_TARGET_GAP_THRESHOLD
  );
}

export function stepGalleryIdle(input: GalleryIdleInput): GalleryIdleState {
  const now = Number.isFinite(input.now) ? input.now : 0;
  const lastNow = Number.isFinite(input.lastNow) ? input.lastNow : 0;
  const dt = lastNow > 0 ? Math.max(0, now - lastNow) : 0;

  if (input.reducedMotion) {
    return { lastNow: now, stillMs: 0, idleAmount: 0 };
  }

  let stillMs = Number.isFinite(input.stillMs) ? Math.max(0, input.stillMs) : 0;
  let idleAmount = clamp(Number.isFinite(input.idleAmount) ? input.idleAmount : 0, 0, 1);

  if (isGalleryScrollStill(input.velocity, input.scrollTarget, input.scrollCurrent)) {
    stillMs += dt;
    if (stillMs >= IDLE_DWELL_MS) {
      idleAmount = lerp(idleAmount, 1, IDLE_LERP_UP);
    }
  } else {
    stillMs = 0;
    idleAmount = lerp(idleAmount, 0, IDLE_LERP_DOWN);
  }

  return { lastNow: now, stillMs, idleAmount: clamp(idleAmount, 0, 1) };
}

/**
 * Scale from object-fit contain to cover the stack box.
 * S = stackW/stackH, I = imageW/imageH, coverScale = max(S/I, I/S).
 * Unknown or non-positive sizes → 1.
 */
export function coverScaleForStack(
  stackWidth: number,
  stackHeight: number,
  imageWidth: number,
  imageHeight: number,
): number {
  if (!(stackWidth > 0 && stackHeight > 0 && imageWidth > 0 && imageHeight > 0)) return 1;
  const S = stackWidth / stackHeight;
  const I = imageWidth / imageHeight;
  if (!(S > 0 && I > 0) || !Number.isFinite(S) || !Number.isFinite(I)) return 1;
  return Math.max(S / I, I / S);
}

export function resolveIdleImageSize(
  img: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight'> | null | undefined,
  fallbackWidth?: number,
  fallbackHeight?: number,
): { width: number; height: number } {
  const naturalW = img?.naturalWidth ?? 0;
  const naturalH = img?.naturalHeight ?? 0;
  if (naturalW > 0 && naturalH > 0) return { width: naturalW, height: naturalH };
  const width = Number.isFinite(fallbackWidth) && (fallbackWidth ?? 0) > 0 ? (fallbackWidth as number) : 0;
  const height = Number.isFinite(fallbackHeight) && (fallbackHeight ?? 0) > 0 ? (fallbackHeight as number) : 0;
  return { width, height };
}

/** (1 + breath + velScale) * lerp(1, coverScale, idleAmount) */
export function composeIdleImageScale(
  garnishScale: number,
  coverScale: number,
  idleAmount: number,
): number {
  const garnish = Number.isFinite(garnishScale) ? garnishScale : 1;
  const cover = Number.isFinite(coverScale) && coverScale > 0 ? coverScale : 1;
  return garnish * lerp(1, cover, clamp(idleAmount, 0, 1));
}
