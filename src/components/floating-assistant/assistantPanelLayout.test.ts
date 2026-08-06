// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  LAYOUT_STORAGE_KEY,
  clamp,
  clampDesktopSize,
  createDefaultStoredLayout,
  defaultCompactSize,
  defaultExpandedSize,
  getFormFactor,
  mobileSheetHeight,
  parseStoredPanelLayout,
  readStoredPanelLayout,
  resolveDesktopSize,
  toPersistableMode,
  writeStoredPanelLayout,
  DESKTOP_RESIZE_MIN_WIDTH,
  DESKTOP_RESIZE_MIN_HEIGHT,
  DESKTOP_EXPANDED_WIDTH_DEFAULT,
  DESKTOP_EXPANDED_WIDTH_MAX,
  MOBILE_COMPACT_VH,
  MOBILE_EXPANDED_VH,
} from './assistantPanelLayout';

describe('assistantPanelLayout clamps', () => {
  it('clamps numbers into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(3, 5, 2)).toBe(5);
  });

  it('enforces desktop resize floor 340×460', () => {
    const size = clampDesktopSize(100, 100, {
      width: 1400,
      height: 900,
      bottomChrome: 24,
    });
    expect(size.width).toBe(DESKTOP_RESIZE_MIN_WIDTH);
    expect(size.height).toBe(DESKTOP_RESIZE_MIN_HEIGHT);
  });

  it('caps desktop size to viewport margins', () => {
    const size = clampDesktopSize(2000, 2000, {
      width: 800,
      height: 600,
      bottomChrome: 24,
    });
    expect(size.width).toBeLessThanOrEqual(800 - 32);
    expect(size.height).toBeLessThanOrEqual(600 - 24 - 80);
  });

  it('keeps compact default near 400×≤640 without forcing resize floor on width when viewport is tight', () => {
    const size = defaultCompactSize({ width: 1280, height: 900, bottomChrome: 24 });
    expect(size.width).toBe(400);
    expect(size.height).toBeLessThanOrEqual(640);
  });

  it('uses expanded default width 640 within 560–720', () => {
    const size = defaultExpandedSize({ width: 1400, height: 900, bottomChrome: 24 });
    expect(size.width).toBe(DESKTOP_EXPANDED_WIDTH_DEFAULT);
    expect(size.width).toBeLessThanOrEqual(DESKTOP_EXPANDED_WIDTH_MAX);
  });

  it('narrow desktop clamps expanded width to available viewport', () => {
    const size = defaultExpandedSize({ width: 500, height: 800, bottomChrome: 24 });
    expect(size.width).toBeLessThanOrEqual(500 - 32);
  });

  it('computes mobile sheet snap heights', () => {
    expect(mobileSheetHeight('compact', 1000)).toBe(Math.round(1000 * MOBILE_COMPACT_VH));
    expect(mobileSheetHeight('expanded', 1000)).toBe(Math.round(1000 * MOBILE_EXPANDED_VH));
  });

  it('detects form factor at 800px breakpoint', () => {
    expect(getFormFactor(800)).toBe('mobile');
    expect(getFormFactor(801)).toBe('desktop');
  });

  it('never persists focus as a mode', () => {
    expect(toPersistableMode('focus')).toBe('expanded');
    expect(toPersistableMode('compact')).toBe('compact');
  });
});

describe('assistantPanelLayout storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns defaults for missing / invalid storage', () => {
    expect(readStoredPanelLayout()).toEqual(createDefaultStoredLayout());
    expect(parseStoredPanelLayout(null)).toEqual(createDefaultStoredLayout());
    expect(parseStoredPanelLayout({ v: 99 })).toEqual(createDefaultStoredLayout());
    expect(parseStoredPanelLayout({ v: 1, desktop: {}, mobile: 'nope' })).toEqual(
      createDefaultStoredLayout(),
    );
  });

  it('rejects focus in stored mode and unknown fields safely', () => {
    const parsed = parseStoredPanelLayout({
      v: 1,
      desktop: { mode: 'focus', width: 500, height: 500, secret: 'x' },
      mobile: { mode: 'expanded' },
    });
    expect(parsed.desktop.mode).toBe('compact');
    expect(parsed.desktop.width).toBe(500);
    expect(parsed.mobile.mode).toBe('expanded');
  });

  it('round-trips valid layout and never writes focus', () => {
    writeStoredPanelLayout({
      v: 1,
      desktop: { mode: 'expanded', width: 600, height: 500 },
      mobile: { mode: 'compact' },
    });
    const raw = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
    expect(raw.desktop.mode).toBe('expanded');
    expect(raw.mobile.mode).toBe('compact');
    expect(readStoredPanelLayout().desktop.width).toBe(600);
  });

  it('resolveDesktopSize applies stored custom compact size', () => {
    const size = resolveDesktopSize(
      'compact',
      { mode: 'compact', width: 380, height: 500 },
      { width: 1400, height: 900, bottomChrome: 24 },
    );
    expect(size.width).toBe(380);
    expect(size.height).toBe(500);
  });
});
