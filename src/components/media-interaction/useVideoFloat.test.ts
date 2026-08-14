// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIDEO_FLOAT, useVideoFloat } from './useVideoFloat';

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

function pointer(extra?: Record<string, unknown>) {
  return { clientX: 10, clientY: 10, pointerId: 1, ...extra } as any;
}

describe('useVideoFloat', () => {
  beforeEach(() => {
    installMatchMedia({ fineHover: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('desktop: enter base, idle enhanced, move back to base, leave rest', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result } = renderHook(() => useVideoFloat());
    act(() => {
      result.current.bind.onPointerEnter(pointer());
    });
    expect(result.current.state).toBe('base');
    act(() => {
      vi.advanceTimersByTime(VIDEO_FLOAT.IDLE_MS);
    });
    expect(result.current.state).toBe('enhanced');
    act(() => {
      result.current.bind.onPointerMove();
    });
    expect(result.current.state).toBe('base');
    act(() => {
      result.current.bind.onPointerLeave();
    });
    expect(result.current.state).toBe('resting');
  });

  it('stays resting under reduced motion', () => {
    installMatchMedia({ fineHover: true, reducedMotion: true });
    const { result } = renderHook(() => useVideoFloat());
    act(() => {
      result.current.bind.onPointerEnter(pointer());
    });
    expect(result.current.state).toBe('resting');
  });

  it('does not float when disabled', () => {
    const { result } = renderHook(() => useVideoFloat({ enabled: false }));
    act(() => {
      result.current.bind.onPointerEnter(pointer());
    });
    expect(result.current.state).toBe('resting');
  });

  it('does not float without fine hover', () => {
    installMatchMedia({ fineHover: false });
    const { result } = renderHook(() => useVideoFloat());
    act(() => {
      result.current.bind.onPointerEnter(pointer());
    });
    expect(result.current.state).toBe('resting');
  });

  it('Escape resets float and preventDefault', () => {
    const { result } = renderHook(() => useVideoFloat());
    const preventDefault = vi.fn();
    act(() => {
      result.current.bind.onPointerEnter(pointer());
    });
    act(() => {
      result.current.bind.onKeyDown({
        key: 'Escape',
        preventDefault,
        stopPropagation: vi.fn(),
        target: {},
        currentTarget: {},
      } as any);
    });
    expect(result.current.state).toBe('resting');
    expect(preventDefault).toHaveBeenCalled();
  });

  it('Space/Enter only toggle when target is the wrapper', () => {
    const { result } = renderHook(() => useVideoFloat());
    const wrapper = { id: 'wrap' };
    const video = { id: 'video' };
    act(() => {
      result.current.bind.onKeyDown({
        key: ' ',
        preventDefault: vi.fn(),
        target: video,
        currentTarget: wrapper,
      } as any);
    });
    expect(result.current.state).toBe('resting');
    act(() => {
      result.current.bind.onKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
        target: wrapper,
        currentTarget: wrapper,
      } as any);
    });
    expect(result.current.state).toBe('base');
  });
});
