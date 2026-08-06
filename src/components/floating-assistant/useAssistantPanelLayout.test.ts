// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_STORAGE_KEY } from './assistantPanelLayout';
import { useAssistantPanelLayout } from './useAssistantPanelLayout';

function stubMatchMedia(fine = true) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('pointer: fine') ? fine : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('useAssistantPanelLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia(true);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts compact and cycles Compact → Expanded → Focus → Expanded → Compact', () => {
    const { result } = renderHook(() => useAssistantPanelLayout(true));

    expect(result.current.mode).toBe('compact');

    act(() => {
      result.current.expand();
    });
    expect(result.current.mode).toBe('expanded');

    act(() => {
      result.current.enterFocus();
    });
    expect(result.current.mode).toBe('focus');

    act(() => {
      result.current.exitFocus();
    });
    expect(result.current.mode).toBe('expanded');

    act(() => {
      result.current.collapse();
    });
    expect(result.current.mode).toBe('compact');
  });

  it('blocks enter Focus from Compact', () => {
    const { result } = renderHook(() => useAssistantPanelLayout(true));
    expect(result.current.mode).toBe('compact');
    act(() => {
      result.current.enterFocus();
    });
    expect(result.current.mode).toBe('compact');
  });

  it('never persists focus mode', () => {
    const { result } = renderHook(() => useAssistantPanelLayout(true));
    act(() => {
      result.current.expand();
      result.current.enterFocus();
    });
    expect(result.current.mode).toBe('focus');
    const raw = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
    expect(raw.desktop?.mode).not.toBe('focus');
    expect(raw.desktop?.mode).toBe('expanded');
  });

  it('persists desktop size on resize commit and clears on reset', () => {
    const { result } = renderHook(() => useAssistantPanelLayout(true));
    act(() => {
      result.current.setDesktopSize(500, 520, { persist: true });
    });
    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
    expect(stored.desktop.width).toBe(500);
    expect(stored.desktop.height).toBe(520);

    act(() => {
      result.current.resetSize();
    });
    const after = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
    expect(after.desktop.width).toBeUndefined();
    expect(after.desktop.height).toBeUndefined();
  });
});
