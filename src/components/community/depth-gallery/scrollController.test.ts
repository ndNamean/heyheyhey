import { describe, expect, it } from 'vitest';
import {
  FIRST_PLANE_VIEW_OFFSET,
  LAST_PLANE_VIEW_OFFSET,
  SCROLL_SMOOTHING,
  SCROLL_TO_WORLD_FACTOR,
  ScrollController,
  TOUCH_SCROLL_SPEED,
  VELOCITY_DAMPING,
  VELOCITY_MAX,
  VELOCITY_STOP_THRESHOLD,
  WHEEL_LINE_HEIGHT,
  WHEEL_SCROLL_SPEED,
  normalizeWheelDelta,
} from './scrollController';

function makeScroll(planeCount = 5): ScrollController {
  return new ScrollController({ planeCount });
}

describe('normalizeWheelDelta', () => {
  it('returns pixels for deltaMode 0', () => {
    expect(normalizeWheelDelta({ deltaY: 42, deltaMode: 0 }, 800)).toBe(42);
  });

  it('multiplies lines (deltaMode 1) by 16', () => {
    expect(normalizeWheelDelta({ deltaY: 3, deltaMode: 1 }, 800)).toBe(3 * WHEEL_LINE_HEIGHT);
    expect(WHEEL_LINE_HEIGHT).toBe(16);
  });

  it('multiplies pages (deltaMode 2) by the passed viewport height, not window', () => {
    expect(normalizeWheelDelta({ deltaY: 1, deltaMode: 2 }, 720)).toBe(720);
    expect(normalizeWheelDelta({ deltaY: 0.5, deltaMode: 2 }, 400)).toBe(200);
  });
});

describe('scroll lerp and clamp', () => {
  it('uses smoothing 0.08 toward scrollTarget', () => {
    const scroll = makeScroll(5);
    scroll.scrollTarget = 100;
    scroll.update();
    expect(SCROLL_SMOOTHING).toBe(0.08);
    expect(scroll.scrollCurrent).toBeCloseTo(100 * SCROLL_SMOOTHING, 8);
  });

  it('clamps both scrollTarget and scrollCurrent to depth bounds', () => {
    const scroll = makeScroll(5);
    const maxScroll = scroll.maxScroll;
    expect(maxScroll).toBeGreaterThan(0);

    scroll.scrollTarget = maxScroll + 50_000;
    scroll.update();

    expect(scroll.scrollTarget).toBe(maxScroll);
    expect(scroll.scrollCurrent).toBe(maxScroll);
  });

  it('lets reverse input move target immediately after overscroll clamp', () => {
    const scroll = makeScroll(5);
    const maxScroll = scroll.maxScroll;
    scroll.scrollTarget = maxScroll + 50_000;
    scroll.update();
    expect(scroll.scrollTarget).toBe(maxScroll);

    scroll.addScrollInput(-120);
    expect(scroll.scrollTarget).toBe(maxScroll - 120);

    scroll.update();
    expect(scroll.scrollTarget).toBe(maxScroll - 120);
    expect(scroll.scrollCurrent).toBeLessThan(maxScroll);
  });
});

describe('velocity and cameraZ', () => {
  it('damps velocity and snaps below the stop threshold', () => {
    const scroll = makeScroll(5);
    expect(VELOCITY_DAMPING).toBe(0.12);
    expect(VELOCITY_MAX).toBe(1.5);
    expect(VELOCITY_STOP_THRESHOLD).toBe(0.0001);

    scroll.applyWheel({ deltaY: 80, deltaMode: 0 }, 800);
    expect(WHEEL_SCROLL_SPEED).toBe(1);
    for (let i = 0; i < 8; i++) scroll.update();
    expect(Math.abs(scroll.velocity)).toBeGreaterThan(VELOCITY_STOP_THRESHOLD);

    for (let i = 0; i < 200; i++) scroll.update();
    expect(scroll.velocity).toBe(0);
    expect(scroll.scrollCurrent).toBeCloseTo(scroll.scrollTarget, 5);
  });

  it('clamps velocity magnitude to velocityMax', () => {
    const scroll = makeScroll(5);
    scroll.scrollCurrent = 0;
    scroll.previousScrollCurrent = 0;
    scroll.velocity = 0;
    scroll.scrollTarget = scroll.maxScroll;
    scroll.update();
    expect(Math.abs(scroll.velocity)).toBeLessThanOrEqual(VELOCITY_MAX);
  });

  it('derives cameraZ only from scrollCurrent (startZ - current * 0.01)', () => {
    const scroll = makeScroll(5);
    expect(SCROLL_TO_WORLD_FACTOR).toBe(0.01);
    expect(scroll.cameraStartZ).toBe(scroll.maxCameraZ);
    expect(scroll.maxCameraZ).toBe(FIRST_PLANE_VIEW_OFFSET);
    expect(scroll.minCameraZ).toBeLessThan(scroll.maxCameraZ);
    expect(LAST_PLANE_VIEW_OFFSET).toBe(5);

    scroll.scrollCurrent = 250;
    scroll.scrollTarget = 250;
    const state = scroll.update();
    expect(state.cameraZ).toBeCloseTo(
      scroll.cameraStartZ - 250 * SCROLL_TO_WORLD_FACTOR,
      8,
    );

    const cameraAtRest = state.cameraZ;
    scroll.velocity = 1.5;
    const again = scroll.update();
    expect(again.cameraZ).toBeCloseTo(cameraAtRest, 5);
  });

  it('applies touchScrollSpeed 1.8 from previousY - currentY', () => {
    const scroll = makeScroll(5);
    expect(TOUCH_SCROLL_SPEED).toBe(1.8);
    scroll.beginTouch(200);
    scroll.moveTouch(160);
    expect(scroll.scrollTarget).toBeCloseTo((200 - 160) * TOUCH_SCROLL_SPEED, 8);
  });
});
