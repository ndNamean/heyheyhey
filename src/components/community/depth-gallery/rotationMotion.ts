/**
 * Scroll-scrubbed 3D rotation derived from existing depthBlend.
 * Pure math — no listeners, rAF, or React. Visual translateZ never feeds cameraZ.
 */

import { hashPostId } from './communityGalleryMoods';

export const ROT_X_MIN = 70;
export const ROT_X_MAX = 100;
export const ROT_Y_MAX = 15;
export const ROT_Z_MAX = 12;
export const MAX_TRANSITION_DEPTH_PX = 40;
export const PERSPECTIVE_PX = 1200;
export const DESKTOP_MOTION_MULTIPLIER = 1;
export const MOBILE_ROTATION_MULTIPLIER = 0.7;
export const MOBILE_TRANSLATE_Z_MULTIPLIER = 0.7;
export const PORTRAIT_STACK_SCALE = 0.65;
export const DESKTOP_MAX_H_RATIO = 1.08;
export const DESKTOP_MAX_V_RATIO = 0.14;
export const PORTRAIT_MAX_H_RATIO = 1.08;
export const PORTRAIT_MAX_V_RATIO = 0.1;
export const PORTRAIT_VIEWPORT_H_CAP = 0.6;

export type Orientation = {
  rotateX: number;
  rotateY: number;
  rotateZ: number;
};

export type LayerMotion = {
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  translateX: number;
  translateY: number;
  translateZ: number;
};

export const IDENTITY_LAYER_MOTION: LayerMotion = {
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  translateX: 0,
  translateY: 0,
  translateZ: 0,
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashUnit01(hash: number): number {
  return (hash >>> 0) / 0xffffffff;
}

function mixHash(hash: number, salt: number): number {
  return Math.imul(hash ^ salt, 0x85ebca6b) >>> 0;
}

/** Stable per postId — never call Math.random() in the animation frame. */
export function getStableOrientation(postId: string): Orientation {
  const h = hashPostId(postId);
  const xT = hashUnit01(h);
  const yT = hashUnit01(mixHash(h, 0x9e3779b9));
  const zT = hashUnit01(mixHash(h, 0xc2b2ae35));
  return {
    rotateX: ROT_X_MIN + xT * (ROT_X_MAX - ROT_X_MIN),
    rotateY: -ROT_Y_MAX + yT * (2 * ROT_Y_MAX),
    rotateZ: -ROT_Z_MAX + zT * (2 * ROT_Z_MAX),
  };
}

export function visualZOffset(
  depthBlend: number,
  maxDepth = MAX_TRANSITION_DEPTH_PX,
  multiplier = DESKTOP_MOTION_MULTIPLIER,
): number {
  return -maxDepth * multiplier * Math.sin(Math.PI * clamp01(depthBlend));
}

export function motionMultipliers(isPortrait: boolean): { rotation: number; translateZ: number } {
  if (!isPortrait) {
    return { rotation: DESKTOP_MOTION_MULTIPLIER, translateZ: DESKTOP_MOTION_MULTIPLIER };
  }
  return {
    rotation: MOBILE_ROTATION_MULTIPLIER,
    translateZ: MOBILE_TRANSLATE_Z_MULTIPLIER,
  };
}

/** Hermite smoothstep. smoothstep(t) + smoothstep(1 - t) === 1. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Forward scroll: outgoing exits right, incoming enters from the left. Reverse retraces. */
export const FLOW_EXIT_X = 1;

/**
 * Horizontal flow is a fixed left→right conveyor (not hashed per image).
 * exitY stays a small complementary lift from CURRENT rotateZ.
 */
export function exitSignsFromOrientation(orientation: Orientation): { exitX: number; exitY: number } {
  const exitY = orientation.rotateZ === 0 ? 0 : orientation.rotateZ > 0 ? -1 : 1;
  return { exitX: FLOW_EXIT_X, exitY };
}

export function computeGalleryOffsets(input: {
  stackWidth: number;
  stackHeight: number;
  overlayWidth: number;
  isPortrait: boolean;
}): { maxHorizontalOffset: number; maxVerticalOffset: number } {
  if (input.isPortrait) {
    let maxH = clampRange(input.stackWidth * PORTRAIT_MAX_H_RATIO, 120, 420);
    const viewportCap =
      (Math.max(0, input.overlayWidth) * PORTRAIT_VIEWPORT_H_CAP) / PORTRAIT_STACK_SCALE;
    if (Number.isFinite(viewportCap) && viewportCap > 0) {
      maxH = Math.min(maxH, viewportCap);
    }
    return {
      maxHorizontalOffset: maxH,
      maxVerticalOffset: clampRange(input.stackHeight * PORTRAIT_MAX_V_RATIO, 16, 64),
    };
  }
  return {
    maxHorizontalOffset: clampRange(input.stackWidth * DESKTOP_MAX_H_RATIO, 200, 800),
    maxVerticalOffset: clampRange(input.stackHeight * DESKTOP_MAX_V_RATIO, 24, 110),
  };
}

function scaleOrientation(
  orientation: Orientation,
  amount: number,
  rotationMul: number,
): Pick<LayerMotion, 'rotateX' | 'rotateY' | 'rotateZ'> {
  const k = amount * rotationMul;
  return {
    rotateX: orientation.rotateX * k,
    rotateY: orientation.rotateY * k,
    rotateZ: orientation.rotateZ * k,
  };
}

export function computeRotationMotion(input: {
  currentOrientation: Orientation;
  nextOrientation: Orientation;
  depthBlend: number;
  reducedMotion?: boolean;
  isPortrait?: boolean;
  maxHorizontalOffset?: number;
  maxVerticalOffset?: number;
}): { current: LayerMotion; next: LayerMotion } {
  if (input.reducedMotion) {
    return { current: IDENTITY_LAYER_MOTION, next: IDENTITY_LAYER_MOTION };
  }

  const blend = clamp01(input.depthBlend);
  const { rotation, translateZ } = motionMultipliers(Boolean(input.isPortrait));
  const z = visualZOffset(blend, MAX_TRANSITION_DEPTH_PX, translateZ);
  const outgoing = scaleOrientation(input.currentOrientation, -blend, rotation);
  const incoming = scaleOrientation(input.nextOrientation, 1 - blend, rotation);

  const maxH = Number.isFinite(input.maxHorizontalOffset) ? (input.maxHorizontalOffset as number) : 0;
  const maxV = Number.isFinite(input.maxVerticalOffset) ? (input.maxVerticalOffset as number) : 0;
  const { exitX, exitY } = exitSignsFromOrientation(input.currentOrientation);
  const outgoingT = smoothstep(blend);
  const incomingT = smoothstep(1 - blend);

  return {
    current: {
      ...outgoing,
      translateX: exitX * maxH * outgoingT,
      translateY: exitY * maxV * outgoingT,
      translateZ: z,
    },
    next: {
      ...incoming,
      translateX: -exitX * maxH * incomingT,
      translateY: -exitY * maxV * incomingT,
      translateZ: z,
    },
  };
}

function fallbackOrientation(orientations: Orientation[], index: number): Orientation | undefined {
  return orientations[index] ?? orientations[0];
}

/** Per-layer pose: live pair at depthBlend, previous at blend 1, ahead at blend 0 as next. */
export function layerMotionForGalleryIndex(input: {
  index: number;
  currentIndex: number;
  nextIndex: number;
  orientations: Orientation[];
  depthBlend: number;
  reducedMotion?: boolean;
  isPortrait?: boolean;
  maxHorizontalOffset?: number;
  maxVerticalOffset?: number;
}): LayerMotion {
  if (input.reducedMotion) return IDENTITY_LAYER_MOTION;
  if (!input.orientations.length) return IDENTITY_LAYER_MOTION;

  const currentOrientation = fallbackOrientation(input.orientations, input.currentIndex);
  const nextOrientation = fallbackOrientation(input.orientations, input.nextIndex) ?? currentOrientation;
  if (!currentOrientation || !nextOrientation) return IDENTITY_LAYER_MOTION;

  const shared = {
    reducedMotion: input.reducedMotion,
    isPortrait: input.isPortrait,
    maxHorizontalOffset: input.maxHorizontalOffset,
    maxVerticalOffset: input.maxVerticalOffset,
  };

  if (input.index === input.currentIndex) {
    return computeRotationMotion({
      currentOrientation,
      nextOrientation,
      depthBlend: input.depthBlend,
      ...shared,
    }).current;
  }

  if (input.index === input.nextIndex) {
    return computeRotationMotion({
      currentOrientation,
      nextOrientation,
      depthBlend: input.depthBlend,
      ...shared,
    }).next;
  }

  if (input.index < input.currentIndex) {
    const parkedCurrent = input.orientations[input.index];
    if (!parkedCurrent) return IDENTITY_LAYER_MOTION;
    const parkedNext = input.orientations[input.index + 1] ?? parkedCurrent;
    return computeRotationMotion({
      currentOrientation: parkedCurrent,
      nextOrientation: parkedNext,
      depthBlend: 1,
      ...shared,
    }).current;
  }

  const parkedNext = input.orientations[input.index];
  if (!parkedNext) return IDENTITY_LAYER_MOTION;
  const parkedCurrent = input.orientations[input.index - 1] ?? parkedNext;
  return computeRotationMotion({
    currentOrientation: parkedCurrent,
    nextOrientation: parkedNext,
    depthBlend: 0,
    ...shared,
  }).next;
}

export function layerTransformCss(motion: LayerMotion): string {
  if (
    motion.rotateX === 0 &&
    motion.rotateY === 0 &&
    motion.rotateZ === 0 &&
    motion.translateX === 0 &&
    motion.translateY === 0 &&
    motion.translateZ === 0
  ) {
    return 'none';
  }
  return `translate3d(${motion.translateX}px, ${motion.translateY}px, ${motion.translateZ}px) rotateX(${motion.rotateX}deg) rotateY(${motion.rotateY}deg) rotateZ(${motion.rotateZ}deg)`;
}
