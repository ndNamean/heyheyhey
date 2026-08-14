// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_ZOOM, useImageZoom } from './useImageZoom';

function installMatchMedia(opts: { fineHover?: boolean; reducedMotion?: boolean } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => {
      const isMotion = query.includes('prefers-reduced-motion');
      const isHover = query.includes('pointer: fine');
      return {
        matches: isMotion ? Boolean(opts.reducedMotion) : isHover ? Boolean(opts.fineHover) : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

function mockBox(el: HTMLElement, size = 100) {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: size,
      bottom: size,
      width: size,
      height: size,
      toJSON: () => {},
    }) as DOMRect;
}

function pointer(clientX: number, clientY: number, extra?: Record<string, unknown>) {
  return { clientX, clientY, pointerId: 1, ...extra } as any;
}

describe('useImageZoom', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('desktop: enter base, idle enhanced, move back to base never rest, leave rest', () => {
    installMatchMedia({ fineHover: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result } = renderHook(() => useImageZoom());
    const el = document.createElement('div');
    mockBox(el);
    result.current.viewportRef.current = el;

    act(() => {
      result.current.bind.onPointerEnter(pointer(25, 25));
    });
    expect(result.current.state).toBe('base');
    expect(el.style.getPropertyValue('--media-zoom-ox')).toBe('25%');
    expect(el.style.getPropertyValue('--media-zoom-oy')).toBe('25%');

    act(() => {
      vi.advanceTimersByTime(IMAGE_ZOOM.IDLE_MS);
    });
    expect(result.current.state).toBe('enhanced');

    act(() => {
      result.current.bind.onPointerMove(pointer(40, 10));
    });
    expect(result.current.state).toBe('base');
    expect(el.style.getPropertyValue('--media-zoom-ox')).toBe('40%');
    expect(el.style.getPropertyValue('--media-zoom-oy')).toBe('10%');

    act(() => {
      result.current.bind.onPointerMove(pointer(50, 50));
    });
    expect(result.current.state).toBe('base');

    act(() => {
      result.current.bind.onPointerLeave();
    });
    expect(result.current.state).toBe('resting');
  });

  it('does not bind hover zoom when there is no fine pointer', () => {
    installMatchMedia({ fineHover: false });
    const { result } = renderHook(() => useImageZoom());
    act(() => {
      result.current.bind.onPointerEnter(pointer(10, 10));
    });
    expect(result.current.state).toBe('resting');
  });

  it('touch tap toggles zoomed at the tap origin; swipe does not', () => {
    installMatchMedia({ fineHover: false });
    const { result } = renderHook(() => useImageZoom());
    const el = document.createElement('div');
    mockBox(el);
    result.current.viewportRef.current = el;

    act(() => {
      result.current.bind.onPointerDown(pointer(20, 30));
      result.current.bind.onPointerUp(pointer(20, 30));
    });
    expect(result.current.state).toBe('zoomed');
    expect(el.style.getPropertyValue('--media-zoom-ox')).toBe('20%');

    act(() => {
      result.current.bind.onPointerDown(pointer(20, 30));
      result.current.bind.onPointerUp(pointer(20, 30));
    });
    expect(result.current.state).toBe('resting');

    act(() => {
      result.current.bind.onPointerDown(pointer(0, 0));
      result.current.bind.onPointerMove(pointer(20, 0));
      result.current.bind.onPointerUp(pointer(20, 0));
    });
    expect(result.current.state).toBe('resting');
  });

  it('ignores long-press as a zoom tap', () => {
    installMatchMedia({ fineHover: false });
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { result } = renderHook(() => useImageZoom());
    act(() => {
      result.current.bind.onPointerDown(pointer(10, 10));
      vi.setSystemTime(IMAGE_ZOOM.TAP_MAX_DURATION_MS + 1);
      result.current.bind.onPointerUp(pointer(10, 10));
    });
    expect(result.current.state).toBe('resting');
  });

  it('keyboard toggles base at center and Escape returns to rest', () => {
    installMatchMedia({ fineHover: false });
    const { result } = renderHook(() => useImageZoom());
    const el = document.createElement('div');
    mockBox(el);
    result.current.viewportRef.current = el;

    const preventDefault = vi.fn();
    act(() => {
      result.current.bind.onKeyDown({ key: 'Enter', preventDefault, stopPropagation: vi.fn() } as any);
    });
    expect(result.current.state).toBe('base');
    expect(el.style.getPropertyValue('--media-zoom-ox')).toBe('50%');

    act(() => {
      result.current.bind.onKeyDown({
        key: 'Escape',
        preventDefault,
        stopPropagation: vi.fn(),
      } as any);
    });
    expect(result.current.state).toBe('resting');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('reduced motion still uses zoom states', () => {
    installMatchMedia({ fineHover: true, reducedMotion: true });
    const { result } = renderHook(() => useImageZoom());
    expect(result.current.reducedMotion).toBe(true);
    act(() => {
      result.current.bind.onPointerEnter(pointer(50, 50));
    });
    expect(result.current.state).toBe('base');
  });

  it('resets when resetKey changes', () => {
    installMatchMedia({ fineHover: true });
    const { result, rerender } = renderHook(({ resetKey }) => useImageZoom({ resetKey }), {
      initialProps: { resetKey: 'a' },
    });
    act(() => {
      result.current.bind.onPointerEnter(pointer(10, 10));
    });
    expect(result.current.state).toBe('base');
    rerender({ resetKey: 'b' });
    expect(result.current.state).toBe('resting');
  });
});
