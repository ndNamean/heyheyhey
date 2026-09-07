/**
 * Virtual depth planes for the Community gallery.
 * One depthBlend (camera Z + sample offset) drives image opacity and mood.
 */

export const PLANE_GAP = 5;
export const PLANE_FADE_SMOOTHING = 0.14;
/** Atmosphere leads the visible plane by one gap — same offset as plane fade. */
export const MOOD_SAMPLE_OFFSET = 1;
export const PLANE_FADE_SAMPLE_OFFSET = 1;
export const DEPTH_SAMPLE_OFFSET = 1;
const MIN_PLANE_GAP = 0.0001;

export type DepthRange = {
  nearestZ: number;
  deepestZ: number;
};

export type DepthBlendData = {
  currentPlaneIndex: number;
  nextPlaneIndex: number;
  /** Fractional 0..1 between current and next. Shared by images and mood. */
  depthBlend: number;
  normalizedDepth: number;
};

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getPlaneZ(index: number, planeGap: number = PLANE_GAP): number {
  // `0 - n` keeps plane 0 at +0 (not -0 from `-index * gap`).
  return 0 - index * planeGap;
}

export function getDepthRange(planeCount: number, planeGap: number = PLANE_GAP): DepthRange {
  if (planeCount <= 0) {
    return { nearestZ: 0, deepestZ: 0 };
  }
  return {
    nearestZ: getPlaneZ(0, planeGap),
    deepestZ: getPlaneZ(planeCount - 1, planeGap),
  };
}

export function getDepthProgress(
  cameraZ: number,
  planeCount: number,
  planeGap: number = PLANE_GAP,
): number {
  const { nearestZ, deepestZ } = getDepthRange(planeCount, planeGap);
  const depthSpan = nearestZ - deepestZ;
  if (depthSpan <= 0) return 0;
  return clamp((nearestZ - cameraZ) / depthSpan, 0, 1);
}

/**
 * Shared current/next/blend from virtual camera Z.
 * sampleOffset=1 matches Gallery.js moodSampleOffset and planeFadeSampleOffset.
 */
export function computeDepthBlend(
  cameraZ: number,
  planeCount: number,
  sampleOffset: number = DEPTH_SAMPLE_OFFSET,
  planeGap: number = PLANE_GAP,
): DepthBlendData {
  const empty: DepthBlendData = {
    currentPlaneIndex: -1,
    nextPlaneIndex: -1,
    depthBlend: 0,
    normalizedDepth: 0,
  };
  if (planeCount <= 0) return empty;

  const lastPlaneIndex = planeCount - 1;
  const firstPlaneZ = getPlaneZ(0, planeGap);
  const safeCameraZ = Number.isFinite(cameraZ) ? cameraZ : firstPlaneZ;

  if (lastPlaneIndex === 0 || planeGap <= 0) {
    return {
      currentPlaneIndex: 0,
      nextPlaneIndex: 0,
      depthBlend: 0,
      normalizedDepth: 0,
    };
  }

  const gap = Math.max(planeGap, MIN_PLANE_GAP);
  const sampledCameraZ = safeCameraZ - gap * sampleOffset;
  const normalizedDepth = clamp((firstPlaneZ - sampledCameraZ) / gap, 0, lastPlaneIndex);
  const currentPlaneIndex = Math.floor(normalizedDepth);
  const nextPlaneIndex = Math.min(currentPlaneIndex + 1, lastPlaneIndex);
  const depthBlend = normalizedDepth - currentPlaneIndex;

  return {
    currentPlaneIndex,
    nextPlaneIndex,
    depthBlend,
    normalizedDepth,
  };
}

export function opacityTargets(planeCount: number, blend: DepthBlendData): number[] {
  const targets = new Array<number>(Math.max(0, planeCount)).fill(0);
  if (planeCount <= 0 || blend.currentPlaneIndex < 0) return targets;

  const { currentPlaneIndex, nextPlaneIndex, depthBlend } = blend;
  for (let index = 0; index < planeCount; index++) {
    let target = 0;
    if (index === currentPlaneIndex) {
      target = 1 - depthBlend;
    }
    if (index === nextPlaneIndex) {
      target = Math.max(target, depthBlend);
    }
    targets[index] = target;
  }
  return targets;
}

export function smoothOpacities(
  current: number[],
  targets: number[],
  smoothing: number = PLANE_FADE_SMOOTHING,
): number[] {
  const next = current.slice();
  const count = Math.min(current.length, targets.length);
  for (let i = 0; i < count; i++) {
    const from = Number.isFinite(current[i]) ? current[i] : 0;
    next[i] = lerp(from, targets[i], smoothing);
  }
  return next;
}

export class GalleryLayers {
  planeCount: number;
  opacities: number[];
  planeGap = PLANE_GAP;
  moodSampleOffset = MOOD_SAMPLE_OFFSET;
  planeFadeSampleOffset = PLANE_FADE_SAMPLE_OFFSET;
  planeFadeSmoothing = PLANE_FADE_SMOOTHING;

  constructor(planeCount = 0) {
    this.planeCount = 0;
    this.opacities = [];
    this.setPlaneCount(planeCount);
  }

  setPlaneCount(planeCount: number): void {
    const nextCount = Math.max(0, Math.floor(planeCount));
    this.planeCount = nextCount;
    this.opacities = Array.from({ length: nextCount }, (_, index) => (index === 0 ? 1 : 0));
  }

  getDepthRange(): DepthRange {
    return getDepthRange(this.planeCount, this.planeGap);
  }

  /** Same helper for image fade and mood — one depthBlend. */
  getDepthBlend(cameraZ: number, sampleOffset: number = this.moodSampleOffset): DepthBlendData {
    return computeDepthBlend(cameraZ, this.planeCount, sampleOffset, this.planeGap);
  }

  getPlaneBlendData(cameraZ: number): DepthBlendData {
    return this.getDepthBlend(cameraZ, this.planeFadeSampleOffset);
  }

  getMoodBlendData(cameraZ: number): DepthBlendData {
    return this.getDepthBlend(cameraZ, this.moodSampleOffset);
  }

  opacityTargets(cameraZ: number): number[] {
    return opacityTargets(this.planeCount, this.getPlaneBlendData(cameraZ));
  }

  updateOpacities(cameraZ: number): number[] {
    const targets = this.opacityTargets(cameraZ);
    this.opacities = smoothOpacities(this.opacities, targets, this.planeFadeSmoothing);
    return this.opacities;
  }
}
