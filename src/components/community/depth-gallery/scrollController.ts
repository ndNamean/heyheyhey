/**
 * Custom scroll engine for the Community depth gallery.
 * Accepts wheel/touch deltas (or attaches to an overlay element — never window).
 * No velocity HUD, no Three.js.
 */

import { clamp, getDepthRange, type DepthRange } from './galleryLayers';

export const SCROLL_SMOOTHING = 0.08;
export const SCROLL_TO_WORLD_FACTOR = 0.01;
export const WHEEL_SCROLL_SPEED = 1;
export const TOUCH_SCROLL_SPEED = 1.8;
export const VELOCITY_DAMPING = 0.12;
export const VELOCITY_MAX = 1.5;
export const VELOCITY_STOP_THRESHOLD = 0.0001;
export const FIRST_PLANE_VIEW_OFFSET = 5;
export const LAST_PLANE_VIEW_OFFSET = 5;
export const WHEEL_LINE_HEIGHT = 16;

export type WheelDeltaInput = {
  deltaY: number;
  deltaMode: number;
};

export type ScrollAttachOptions = {
  /** Overlay viewport height for deltaMode === 2. Defaults to element.clientHeight. */
  getViewportHeight?: () => number;
};

export type ScrollControllerState = {
  scrollTarget: number;
  scrollCurrent: number;
  velocity: number;
  rawVelocity: number;
  cameraZ: number;
  minCameraZ: number;
  maxCameraZ: number;
  minScroll: number;
  maxScroll: number;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Wheel deltaMode: 0 pixels, 1 lines (*16), 2 pages (*viewportHeight).
 * viewportHeight is passed in so this never reads window.
 */
export function normalizeWheelDelta(
  event: WheelDeltaInput,
  viewportHeight: number,
): number {
  if (event.deltaMode === 1) return event.deltaY * WHEEL_LINE_HEIGHT;
  if (event.deltaMode === 2) return event.deltaY * viewportHeight;
  return event.deltaY;
}

export class ScrollController {
  scrollTarget = 0;
  scrollCurrent = 0;
  scrollSmoothing = SCROLL_SMOOTHING;
  scrollToWorldFactor = SCROLL_TO_WORLD_FACTOR;
  wheelScrollSpeed = WHEEL_SCROLL_SPEED;
  touchScrollSpeed = TOUCH_SCROLL_SPEED;
  previousScrollCurrent = 0;
  invertScroll = false;

  rawVelocity = 0;
  velocity = 0;
  velocityDamping = VELOCITY_DAMPING;
  velocityMax = VELOCITY_MAX;
  velocityStopThreshold = VELOCITY_STOP_THRESHOLD;

  useScrollBounds = true;
  firstPlaneViewOffset = FIRST_PLANE_VIEW_OFFSET;
  lastPlaneViewOffset = LAST_PLANE_VIEW_OFFSET;
  minCameraZ = 0;
  maxCameraZ = 0;
  cameraStartZ = 0;
  cameraZ = 0;

  touchY = 0;
  planeCount = 0;

  private attachedElement: HTMLElement | null = null;
  private getViewportHeight: (() => number) | null = null;
  private readonly onWheel = (event: WheelEvent) => {
    if (event.cancelable) event.preventDefault();
    const viewportHeight = this.resolveViewportHeight();
    this.applyWheel(event, viewportHeight);
  };
  private readonly onTouchStart = (event: TouchEvent) => {
    this.beginTouch(event.touches[0]?.clientY ?? this.touchY);
  };
  private readonly onTouchMove = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
    this.moveTouch(event.touches[0]?.clientY ?? this.touchY);
  };

  constructor(options?: { planeCount?: number; invertScroll?: boolean }) {
    this.invertScroll = Boolean(options?.invertScroll);
    this.setPlaneCount(options?.planeCount ?? 0);
    this.init();
  }

  init(): void {
    this.updateCameraBounds();
    this.cameraStartZ = this.maxCameraZ;
    this.cameraZ = this.cameraStartZ;
    this.scrollTarget = 0;
    this.scrollCurrent = 0;
    this.previousScrollCurrent = 0;
    this.rawVelocity = 0;
    this.velocity = 0;
  }

  setPlaneCount(planeCount: number): void {
    this.planeCount = Math.max(0, Math.floor(planeCount));
    this.setDepthRange(getDepthRange(this.planeCount));
  }

  setDepthRange(range: DepthRange): void {
    this.maxCameraZ = range.nearestZ + this.firstPlaneViewOffset;
    this.minCameraZ = range.deepestZ + this.lastPlaneViewOffset;
    if (this.minCameraZ > this.maxCameraZ) {
      this.minCameraZ = this.maxCameraZ;
    }
  }

  updateCameraBounds(range?: DepthRange): void {
    if (range) {
      this.setDepthRange(range);
      return;
    }
    this.setDepthRange(getDepthRange(this.planeCount));
  }

  cameraZFromScroll(scrollAmount: number): number {
    return this.cameraStartZ - scrollAmount * this.scrollToWorldFactor;
  }

  scrollFromCameraZ(cameraZ: number): number {
    if (this.scrollToWorldFactor === 0) return 0;
    return (this.cameraStartZ - cameraZ) / this.scrollToWorldFactor;
  }

  get minScroll(): number {
    return this.scrollFromCameraZ(this.maxCameraZ);
  }

  get maxScroll(): number {
    return this.scrollFromCameraZ(this.minCameraZ);
  }

  addScrollInput(deltaY: number): void {
    const scrollDirection = this.invertScroll ? -1 : 1;
    this.scrollTarget += deltaY * scrollDirection;
  }

  applyWheel(event: WheelDeltaInput, viewportHeight: number): void {
    const normalized = normalizeWheelDelta(event, viewportHeight) * this.wheelScrollSpeed;
    this.addScrollInput(normalized);
  }

  beginTouch(clientY: number): void {
    this.touchY = clientY;
  }

  /** deltaY = previousTouchY - currentTouchY, then * touchScrollSpeed. */
  moveTouch(clientY: number): void {
    const deltaY = this.touchY - clientY;
    this.addScrollInput(deltaY * this.touchScrollSpeed);
    this.touchY = clientY;
  }

  /**
   * Bind wheel/touch on an overlay root. Never window.
   * Overlay may also call applyWheel / beginTouch / moveTouch itself.
   */
  attach(element: HTMLElement, options?: ScrollAttachOptions): void {
    this.detach();
    this.attachedElement = element;
    this.getViewportHeight = options?.getViewportHeight ?? null;
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('touchstart', this.onTouchStart, { passive: true });
    element.addEventListener('touchmove', this.onTouchMove, { passive: false });
  }

  detach(): void {
    const element = this.attachedElement;
    if (element) {
      element.removeEventListener('wheel', this.onWheel);
      element.removeEventListener('touchstart', this.onTouchStart);
      element.removeEventListener('touchmove', this.onTouchMove);
    }
    this.attachedElement = null;
    this.getViewportHeight = null;
  }

  update(range?: DepthRange): ScrollControllerState {
    this.updateCameraBounds(range);

    this.scrollCurrent = lerp(this.scrollCurrent, this.scrollTarget, this.scrollSmoothing);

    if (this.useScrollBounds) {
      const minimumScroll = this.minScroll;
      const maximumScroll = this.maxScroll;
      this.scrollTarget = clamp(this.scrollTarget, minimumScroll, maximumScroll);
      this.scrollCurrent = clamp(this.scrollCurrent, minimumScroll, maximumScroll);
    }

    this.updateVelocity();

    const nextCameraZ = this.cameraZFromScroll(this.scrollCurrent);
    this.cameraZ = this.useScrollBounds
      ? clamp(nextCameraZ, this.minCameraZ, this.maxCameraZ)
      : nextCameraZ;

    return this.getState();
  }

  getState(): ScrollControllerState {
    return {
      scrollTarget: this.scrollTarget,
      scrollCurrent: this.scrollCurrent,
      velocity: this.velocity,
      rawVelocity: this.rawVelocity,
      cameraZ: this.cameraZ,
      minCameraZ: this.minCameraZ,
      maxCameraZ: this.maxCameraZ,
      minScroll: this.minScroll,
      maxScroll: this.maxScroll,
    };
  }

  dispose(): void {
    this.detach();
  }

  private updateVelocity(): void {
    this.rawVelocity = this.scrollCurrent - this.previousScrollCurrent;
    this.velocity = lerp(this.velocity, this.rawVelocity, this.velocityDamping);
    this.velocity = clamp(this.velocity, -this.velocityMax, this.velocityMax);
    if (Math.abs(this.velocity) < this.velocityStopThreshold) {
      this.velocity = 0;
    }
    this.previousScrollCurrent = this.scrollCurrent;
  }

  private resolveViewportHeight(): number {
    if (this.getViewportHeight) {
      const height = this.getViewportHeight();
      if (Number.isFinite(height) && height > 0) return height;
    }
    const elementHeight = this.attachedElement?.clientHeight ?? 0;
    return elementHeight > 0 ? elementHeight : 1;
  }
}
