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
/** Start fading ornaments after idle walk-in is essentially done. */
export const IDLE_VANISH_START = 0.98;
/** Vanish-out only — 4× slower than idle-in until ornaments are gone. */
export const IDLE_VANISH_LERP_UP = IDLE_LERP_UP / 4;
export const IDLE_CHIP_SCALE = 1.12;
export const ORNAMENT_SCROLL_REACTION_SCALE = 2.5;
export const ORNAMENT_SCROLL_TEXT_SCALE = 1.4;

export type GalleryIdleInput = {
  now: number;
  lastNow: number;
  stillMs: number;
  idleAmount: number;
  vanishAmount: number;
  velocity: number;
  scrollTarget: number;
  scrollCurrent: number;
  reducedMotion: boolean;
};

export type GalleryIdleState = {
  lastNow: number;
  stillMs: number;
  idleAmount: number;
  vanishAmount: number;
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
    return { lastNow: now, stillMs: 0, idleAmount: 0, vanishAmount: 0 };
  }

  let stillMs = Number.isFinite(input.stillMs) ? Math.max(0, input.stillMs) : 0;
  let idleAmount = clamp(Number.isFinite(input.idleAmount) ? input.idleAmount : 0, 0, 1);
  let vanishAmount = clamp(Number.isFinite(input.vanishAmount) ? input.vanishAmount : 0, 0, 1);
  const still = isGalleryScrollStill(input.velocity, input.scrollTarget, input.scrollCurrent);

  if (still) {
    stillMs += dt;
    if (stillMs >= IDLE_DWELL_MS) {
      idleAmount = lerp(idleAmount, 1, IDLE_LERP_UP);
    }
  } else {
    stillMs = 0;
    idleAmount = lerp(idleAmount, 0, IDLE_LERP_DOWN);
  }

  if (still && idleAmount >= IDLE_VANISH_START) {
    vanishAmount = lerp(vanishAmount, 1, IDLE_VANISH_LERP_UP);
  } else if (!still) {
    vanishAmount = lerp(vanishAmount, 0, IDLE_LERP_DOWN);
  }

  return {
    lastNow: now,
    stillMs,
    idleAmount: clamp(idleAmount, 0, 1),
    vanishAmount: clamp(vanishAmount, 0, 1),
  };
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

/**
 * Contain-fit the photo inside the stack box (letterbox).
 * S = stackW/stackH, I = imageW/imageH.
 * Unknown or non-positive sizes → full stack (0, 0, stackW, stackH).
 */
export function containRectForStack(
  stackW: number,
  stackH: number,
  imageW: number,
  imageH: number,
): { left: number; top: number; width: number; height: number } {
  const full = { left: 0, top: 0, width: stackW, height: stackH };
  if (!(stackW > 0 && stackH > 0 && imageW > 0 && imageH > 0)) return full;
  const S = stackW / stackH;
  const I = imageW / imageH;
  if (!(S > 0 && I > 0) || !Number.isFinite(S) || !Number.isFinite(I)) return full;
  if (I >= S) {
    const width = stackW;
    const height = stackW / I;
    return { left: 0, top: (stackH - height) / 2, width, height };
  }
  const height = stackH;
  const width = stackH * I;
  return { left: (stackW - width) / 2, top: 0, width, height };
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

/**
 * First-contact scale from the visual stack card to the overlay.
 * visualW/H = stack size × visualScale (portrait stack transform).
 * Unknown or non-positive sizes → 1. Never shrinks below 1.
 */
export function frameExpandScaleForOverlay(
  stackW: number,
  stackH: number,
  overlayW: number,
  overlayH: number,
  visualScale: number,
): number {
  const visualW = stackW * visualScale;
  const visualH = stackH * visualScale;
  if (
    !(
      stackW > 0 &&
      stackH > 0 &&
      overlayW > 0 &&
      overlayH > 0 &&
      visualScale > 0 &&
      visualW > 0 &&
      visualH > 0 &&
      Number.isFinite(visualW) &&
      Number.isFinite(visualH) &&
      Number.isFinite(overlayW) &&
      Number.isFinite(overlayH)
    )
  ) {
    return 1;
  }
  return Math.max(1, Math.min(overlayW / visualW, overlayH / visualH));
}

/** lerp(1, frameExpand, idleAmount) */
export function composeIdleFrameScale(frameExpand: number, idleAmount: number): number {
  const expand = Number.isFinite(frameExpand) && frameExpand > 0 ? frameExpand : 1;
  return lerp(1, expand, clamp(idleAmount, 0, 1));
}

/** lerp(scroll, inward, idleAmount) — CSS uses the same numbers via --idle. */
export function composeOrnamentScale(scroll: number, inward: number, idleAmount: number): number {
  return lerp(scroll, inward, clamp(idleAmount, 0, 1));
}
