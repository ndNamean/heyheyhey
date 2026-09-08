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

export type Orientation = {
  rotateX: number;
  rotateY: number;
  rotateZ: number;
};

export type LayerMotion = {
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  translateZ: number;
};

export const IDENTITY_LAYER_MOTION: LayerMotion = {
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  translateZ: 0,
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
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

function scaleOrientation(orientation: Orientation, amount: number, rotationMul: number): Omit<LayerMotion, 'translateZ'> {
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
}): { current: LayerMotion; next: LayerMotion } {
  if (input.reducedMotion) {
    return { current: IDENTITY_LAYER_MOTION, next: IDENTITY_LAYER_MOTION };
  }

  const blend = clamp01(input.depthBlend);
  const { rotation, translateZ } = motionMultipliers(Boolean(input.isPortrait));
  const z = visualZOffset(blend, MAX_TRANSITION_DEPTH_PX, translateZ);
  const outgoing = scaleOrientation(input.currentOrientation, -blend, rotation);
  const incoming = scaleOrientation(input.nextOrientation, 1 - blend, rotation);

  return {
    current: { ...outgoing, translateZ: z },
    next: { ...incoming, translateZ: z },
  };
}

export function layerTransformCss(motion: LayerMotion): string {
  if (
    motion.rotateX === 0 &&
    motion.rotateY === 0 &&
    motion.rotateZ === 0 &&
    motion.translateZ === 0
  ) {
    return 'none';
  }
  return `rotateX(${motion.rotateX}deg) rotateY(${motion.rotateY}deg) rotateZ(${motion.rotateZ}deg) translateZ(${motion.translateZ}px)`;
}
