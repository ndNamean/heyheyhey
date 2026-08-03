// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerVisualState } from './useComposerVisualState';

describe('useComposerVisualState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays disabled and ignores input when enabled is false', () => {
    const { result } = renderHook(() =>
      useComposerVisualState({ enabled: false, offline: false }),
    );

    act(() => {
      result.current.onFocus();
      result.current.onInput();
      result.current.setSending();
    });

    expect(result.current.state).toBe('disabled');
    expect(result.current.keyFlash).toBe(false);
  });

  it('clears flash timers on disable without leaking', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useComposerVisualState({ enabled, offline: false }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      result.current.onFocus();
      result.current.onInput();
    });
    expect(result.current.keyFlash).toBe(true);

    rerender({ enabled: false });
    expect(result.current.state).toBe('disabled');
    expect(result.current.keyFlash).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.state).toBe('disabled');
    expect(result.current.keyFlash).toBe(false);
  });

  it('replaces key-flash timer on rapid input', () => {
    const { result } = renderHook(() =>
      useComposerVisualState({ enabled: true, offline: false }),
    );

    act(() => {
      result.current.onInput();
      result.current.onInput();
      result.current.onInput();
    });
    expect(result.current.keyFlash).toBe(true);

    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(result.current.keyFlash).toBe(false);
  });
});
