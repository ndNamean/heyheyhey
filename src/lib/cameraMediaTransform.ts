import { computeLetterboxLayout, type LetterboxLayout } from './proofOverlayLetterbox';
import {
  drawProofOverlay,
  loadImageForCanvas,
  type ProofSnapshot,
} from './proofWatermarkDraw';
import { ensureProofFontsLoaded } from './proofFonts';

export type LayoutOrientation = 'portrait' | 'landscape';
/** @deprecated Use WatermarkDirection — same 0|90|180|270 values. */
export type ManualMediaRotation = 0 | 90 | 180 | 270;
export type WatermarkDirection = 0 | 90 | 180 | 270;

/** Current product policy: never mirror front-camera preview or saved media. */
export const MIRROR_CAPTURE = false;

export interface ContainedMediaRect {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Display width in viewfinder CSS pixels (after rotation). */
  displayW: number;
  /** Display height in viewfinder CSS pixels (after rotation). */
  displayH: number;
  /** Effective media width used for contain (source dims with 90/270 swap). */
  effectiveW: number;
  /** Effective media height used for contain (source dims with 90/270 swap). */
  effectiveH: number;
  sourceW: number;
  sourceH: number;
  rotationDeg: WatermarkDirection;
}

export interface MediaTransformSnapshot {
  sourceVideoW: number;
  sourceVideoH: number;
  layoutOrientation: LayoutOrientation;
  /** Live-preview stamp tilt only (0 when upright / OS landscape). */
  watermarkDirection: WatermarkDirection;
  /** Rotation baked into saved photo/video pixels (upright stamp). */
  frameRotation: WatermarkDirection;
  /** @deprecated Alias of watermarkDirection */
  manualMediaRotation: WatermarkDirection;
  facingMode: 'environment' | 'user';
  mirrorCapture: boolean;
  viewfinderW: number;
  viewfinderH: number;
  contained: ContainedMediaRect;
}

export function normalizeManualRotation(deg: number): WatermarkDirection {
  const n = ((Math.round(deg) % 360) + 360) % 360;
  if (n === 90 || n === 180 || n === 270) return n;
  return 0;
}

export const normalizeWatermarkDirection = normalizeManualRotation;

export function nextManualRotation(current: WatermarkDirection): WatermarkDirection {
  return normalizeManualRotation(current + 90);
}

export function getEffectiveDimensions(
  sourceW: number,
  sourceH: number,
  rotationDeg: WatermarkDirection,
): { w: number; h: number } {
  if (rotationDeg === 90 || rotationDeg === 270) {
    return { w: sourceH, h: sourceW };
  }
  return { w: sourceW, h: sourceH };
}

const LANDSCAPE_ANGLE_TOLERANCE = 25;

/** Output rotation for saved media: landscape JPEG when phone held sideways. */
export function resolveCaptureFrameRotation(opts: {
  layoutOrientation: LayoutOrientation;
  watermarkTilt: WatermarkDirection;
  sourceW: number;
  sourceH: number;
  screenAngle?: number | null;
}): WatermarkDirection {
  const { layoutOrientation, watermarkTilt, sourceW, sourceH, screenAngle } = opts;
  // CSS tilt is clockwise; canvas drawOrientedFrame is CCW — invert 90↔270.
  if (watermarkTilt === 90) return 270;
  if (watermarkTilt === 270) return 90;
  if (layoutOrientation === 'landscape' && sourceH > sourceW) {
    if (screenAngle != null && Number.isFinite(screenAngle)) {
      const a = ((Math.round(screenAngle) % 360) + 360) % 360;
      if (Math.abs(a - 270) <= LANDSCAPE_ANGLE_TOLERANCE) return 90;
      if (Math.abs(a - 90) <= LANDSCAPE_ANGLE_TOLERANCE) return 270;
    }
    return 270;
  }
  return 0;
}

export interface LiveCaptureMatchedOverlay {
  /** Viewfinder-absolute CSS position (px). */
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
  transformOrigin: string;
  /** Logical landscape frame for ProofReviewOverlay (matches capture canvas). */
  frameWidth: number;
  frameHeight: number;
  scale: number;
}

/**
 * Live stamp that previews capture: upright on the gravity-bottom edge of the
 * letterboxed stage (same landscape frame as the saved JPEG).
 */
export function liveCaptureMatchedOverlayStyle(opts: {
  tilt: WatermarkDirection;
  frameRotation: WatermarkDirection;
  sourceW: number;
  sourceH: number;
  stageOffsetX: number;
  stageOffsetY: number;
  stageW: number;
  stageH: number;
  insetPx?: number;
}): LiveCaptureMatchedOverlay | null {
  const {
    tilt,
    frameRotation,
    sourceW,
    sourceH,
    stageOffsetX,
    stageOffsetY,
    stageW,
    stageH,
    insetPx = 10,
  } = opts;
  if (tilt !== 90 && tilt !== 270) return null;
  if (sourceW <= 0 || sourceH <= 0 || stageW <= 0 || stageH <= 0) return null;

  const { w: outW, h: outH } = getEffectiveDimensions(sourceW, sourceH, frameRotation);
  if (outW <= 0 || outH <= 0) return null;

  const maxAlong = Math.max(80, stageH - insetPx * 2);
  const maxInto = Math.max(64, stageW * 0.42);
  const scale = Math.min(maxAlong / outW, maxInto / outH);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;

  const into = outH * scale;
  // Layout box is capture-sized; CSS scale+rotate maps it onto the stage edge.
  const top = stageOffsetY + stageH - insetPx - outH;
  const transform = `scale(${scale}) rotate(90deg)`;
  const transformOrigin = 'bottom left';

  if (tilt === 90) {
    // Gravity-bottom = stage left. Pivot inset by `into` so CW 90 keeps stamp on-stage.
    return {
      left: stageOffsetX + insetPx + into,
      top,
      width: outW,
      height: outH,
      transform,
      transformOrigin,
      frameWidth: outW,
      frameHeight: outH,
      scale,
    };
  }

  // Gravity-bottom = stage right.
  return {
    left: stageOffsetX + stageW - insetPx,
    top,
    width: outW,
    height: outH,
    transform,
    transformOrigin,
    frameWidth: outW,
    frameHeight: outH,
    scale,
  };
}

/** Axis-aligned bounds of the live tilt stamp after scale+CW90 around bottom-left. */
export function liveCaptureMatchedOverlayBounds(overlay: LiveCaptureMatchedOverlay): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const along = overlay.frameWidth * overlay.scale;
  const into = overlay.frameHeight * overlay.scale;
  const pivotX = overlay.left;
  const pivotY = overlay.top + overlay.height;
  // CW 90 from bottom-left: +x → up, +y-up (into box) → left.
  return {
    left: pivotX - into,
    top: pivotY - along,
    right: pivotX,
    bottom: pivotY,
  };
}

/** @deprecated Use liveCaptureMatchedOverlayStyle for tilt; letterbox scale for upright. */
export function liveTiltViewfinderOverlayStyle(
  tilt: WatermarkDirection,
  viewfinderW: number,
  viewfinderH: number,
  insetPx = 10,
): LiveCaptureMatchedOverlay | null {
  return liveCaptureMatchedOverlayStyle({
    tilt,
    frameRotation: tilt === 90 ? 270 : tilt === 270 ? 90 : 0,
    sourceW: Math.max(1, viewfinderH),
    sourceH: Math.max(1, viewfinderW),
    stageOffsetX: 0,
    stageOffsetY: 0,
    stageW: viewfinderW,
    stageH: viewfinderH,
    insetPx,
  });
}

/** @deprecated Prefer letterbox scale for tilt 0; use liveCaptureMatchedOverlayStyle when tilted. */
export function liveWatermarkOverlayStyle(
  scale: number,
  tilt: WatermarkDirection,
): {
  left: number | 'auto';
  right: number | 'auto';
  bottom: number;
  transform: string;
  transformOrigin: string;
} {
  if (tilt === 90 || tilt === 270) {
    return {
      left: 0,
      right: 'auto',
      bottom: 0,
      transformOrigin: 'bottom left',
      transform: `scale(${scale}) rotate(90deg)`,
    };
  }
  return {
    left: 0,
    right: 'auto',
    bottom: 0,
    transformOrigin: 'bottom left',
    transform: `scale(${scale})`,
  };
}

export function computeContainedMediaRect(
  viewfinderW: number,
  viewfinderH: number,
  sourceW: number,
  sourceH: number,
  rotationDeg: WatermarkDirection = 0,
): ContainedMediaRect | null {
  if (viewfinderW <= 0 || viewfinderH <= 0 || sourceW <= 0 || sourceH <= 0) return null;
  const { w: effectiveW, h: effectiveH } = getEffectiveDimensions(sourceW, sourceH, rotationDeg);
  const layout = computeLetterboxLayout(viewfinderW, viewfinderH, effectiveW, effectiveH);
  if (!layout) return null;
  return {
    scale: layout.scale,
    offsetX: layout.offsetX,
    offsetY: layout.offsetY,
    displayW: effectiveW * layout.scale,
    displayH: effectiveH * layout.scale,
    effectiveW,
    effectiveH,
    sourceW,
    sourceH,
    rotationDeg,
  };
}

/** Convert ContainedMediaRect into the letterbox layout shape used by existing overlay CSS. */
export function containedToLetterboxLayout(rect: ContainedMediaRect): LetterboxLayout {
  return {
    scale: rect.scale,
    offsetX: rect.offsetX,
    offsetY: rect.offsetY,
    videoW: rect.effectiveW,
    videoH: rect.effectiveH,
  };
}

/**
 * Draw a video/image frame onto a canvas sized to the oriented output,
 * applying manual rotation and optional mirror (currently always false).
 */
export function drawOrientedFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  rotationDeg: ManualMediaRotation,
  mirrorCapture: boolean = MIRROR_CAPTURE,
): { outW: number; outH: number } {
  const { w: outW, h: outH } = getEffectiveDimensions(sourceW, sourceH, rotationDeg);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, outW, outH);

  // Map source into oriented output space.
  switch (rotationDeg) {
    case 90:
      ctx.translate(outW, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 180:
      ctx.translate(outW, outH);
      ctx.rotate(Math.PI);
      break;
    case 270:
      ctx.translate(0, outH);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }

  if (mirrorCapture) {
    ctx.translate(sourceW, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(source, 0, 0, sourceW, sourceH);
  ctx.restore();
  return { outW, outH };
}

export function buildMediaTransformSnapshot(opts: {
  sourceVideoW: number;
  sourceVideoH: number;
  layoutOrientation: LayoutOrientation;
  watermarkDirection?: WatermarkDirection;
  /** @deprecated Prefer watermarkDirection */
  manualMediaRotation?: WatermarkDirection;
  facingMode: 'environment' | 'user';
  viewfinderW: number;
  viewfinderH: number;
  mirrorCapture?: boolean;
  screenAngle?: number | null;
}): MediaTransformSnapshot | null {
  const direction = normalizeWatermarkDirection(
    opts.watermarkDirection ?? opts.manualMediaRotation ?? 0,
  );
  const frameRotation = resolveCaptureFrameRotation({
    layoutOrientation: opts.layoutOrientation,
    watermarkTilt: direction,
    sourceW: opts.sourceVideoW,
    sourceH: opts.sourceVideoH,
    screenAngle: opts.screenAngle,
  });
  // Contain uses unrotated video; watermarkDirection is stamp tilt only.
  const contained = computeContainedMediaRect(
    opts.viewfinderW,
    opts.viewfinderH,
    opts.sourceVideoW,
    opts.sourceVideoH,
    0,
  );
  if (!contained) return null;
  return {
    sourceVideoW: opts.sourceVideoW,
    sourceVideoH: opts.sourceVideoH,
    layoutOrientation: opts.layoutOrientation,
    watermarkDirection: direction,
    frameRotation,
    manualMediaRotation: direction,
    facingMode: opts.facingMode,
    mirrorCapture: opts.mirrorCapture ?? MIRROR_CAPTURE,
    viewfinderW: opts.viewfinderW,
    viewfinderH: opts.viewfinderH,
    contained,
  };
}

export async function composeOrientedFrameBlob(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  rotationDeg: ManualMediaRotation,
  mirrorCapture: boolean = MIRROR_CAPTURE,
  quality = 0.92,
): Promise<{ blob: Blob; outW: number; outH: number }> {
  const { w: outW, h: outH } = getEffectiveDimensions(sourceW, sourceH, rotationDeg);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  drawOrientedFrame(ctx, source, sourceW, sourceH, rotationDeg, mirrorCapture);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
  });
  return { blob, outW, outH };
}

export async function composeWatermarkedOrientedPhoto(opts: {
  source: CanvasImageSource;
  sourceW: number;
  sourceH: number;
  /** Media/frame rotation (keep 0 for watermark-only tilt product). */
  rotationDeg?: WatermarkDirection;
  /** Rotate stamp only around bottom-left (matches live CSS). */
  watermarkTiltRotation?: WatermarkDirection;
  mirrorCapture?: boolean;
  proof: ProofSnapshot;
  logoImg?: HTMLImageElement | null;
  quality?: number;
}): Promise<{ blob: Blob; outW: number; outH: number }> {
  const mirror = opts.mirrorCapture ?? MIRROR_CAPTURE;
  const mediaRot = opts.rotationDeg ?? 0;
  const stampTilt = opts.watermarkTiltRotation ?? 0;
  const { w: outW, h: outH } = getEffectiveDimensions(opts.sourceW, opts.sourceH, mediaRot);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  drawOrientedFrame(ctx, opts.source, opts.sourceW, opts.sourceH, mediaRot, mirror);

  let logoImg = opts.logoImg ?? null;
  const hasLogo =
    opts.proof.cameraOptionsSnapshot.logoEnabled && opts.proof.proofLogoUrl.trim().length > 0;
  if (hasLogo && !logoImg) {
    logoImg = await loadImageForCanvas(opts.proof.proofLogoUrl);
  }

  const fontSize = Math.max(14, Math.round(outW * 0.035));
  await ensureProofFontsLoaded(fontSize);
  drawProofOverlayWithTilt(ctx, canvas, opts.proof, logoImg, stampTilt);

  const quality = opts.quality ?? 0.85;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality);
  });
  return { blob, outW, outH };
}

/** Draw watermark upright in frame, optionally tilted around bottom-left. */
export function drawProofOverlayWithTilt(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
  watermarkTiltRotation: WatermarkDirection = 0,
): void {
  if (!watermarkTiltRotation) {
    drawProofOverlay(ctx, canvas, proof, logoImg);
    return;
  }

  const rad = (watermarkTiltRotation * Math.PI) / 180;
  // Match CSS transform-origin: bottom left — draw stamp in-place, not full-canvas rotate.
  ctx.save();
  ctx.translate(0, canvas.height);
  ctx.rotate(rad);
  ctx.translate(0, -canvas.height);
  drawProofOverlay(ctx, canvas, proof, logoImg);
  ctx.restore();
}

export async function composeWatermarkedFromRawBlob(opts: {
  rawBlob: Blob;
  sourceW: number;
  sourceH: number;
  rotationDeg?: ManualMediaRotation;
  watermarkTiltRotation?: WatermarkDirection;
  mirrorCapture?: boolean;
  proof: ProofSnapshot;
  logoImg?: HTMLImageElement | null;
  quality?: number;
}): Promise<{ blob: Blob; outW: number; outH: number }> {
  const bitmap = await createImageBitmap(opts.rawBlob);
  try {
    // Raw blob is stored in source (unrotated) pixel space for regeneration.
    return await composeWatermarkedOrientedPhoto({
      source: bitmap,
      sourceW: opts.sourceW,
      sourceH: opts.sourceH,
      rotationDeg: opts.rotationDeg ?? 0,
      watermarkTiltRotation: opts.watermarkTiltRotation,
      mirrorCapture: opts.mirrorCapture,
      proof: opts.proof,
      logoImg: opts.logoImg,
      quality: opts.quality,
    });
  } finally {
    bitmap.close?.();
  }
}

/** Draw one composited frame: oriented video + upright watermark. */
export function drawRecordingCompositorFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  snapshot: MediaTransformSnapshot,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
): void {
  const { sourceVideoW: sw, sourceVideoH: sh, frameRotation, mirrorCapture } = snapshot;
  void canvas;
  drawOrientedFrame(ctx, video, sw, sh, frameRotation, mirrorCapture);
  drawProofOverlayWithTilt(ctx, canvas, proof, logoImg, 0);
}
