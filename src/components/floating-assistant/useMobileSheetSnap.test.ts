// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMobileSheetSnap } from './useMobileSheetSnap';
import { MOBILE_COMPACT_VH, MOBILE_EXPANDED_VH } from './assistantPanelLayout';

describe('useMobileSheetSnap', () => {
  it('toggles expand on handle tap without drag', () => {
    const onSnap = vi.fn();
    const { result } = renderHook(() =>
      useMobileSheetSnap({
        enabled: true,
        mode: 'compact',
        viewportHeight: 1000,
        onHeightChange: vi.fn(),
        onSnap,
        onCloseRequest: vi.fn(),
      }),
    );

    expect(result.current.compactH).toBe(Math.round(1000 * MOBILE_COMPACT_VH));
    expect(result.current.expandedH).toBe(Math.round(1000 * MOBILE_EXPANDED_VH));

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    result.current.onHandlePointerDown({
      button: 0,
      pointerId: 1,
      clientY: 100,
      preventDefault: vi.fn(),
      currentTarget: target,
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 100 }));
    expect(onSnap).toHaveBeenCalledWith('expanded');
  });

  it('requests close when dragged far down', () => {
    const onCloseRequest = vi.fn();
    const { result } = renderHook(() =>
      useMobileSheetSnap({
        enabled: true,
        mode: 'compact',
        viewportHeight: 1000,
        onHeightChange: vi.fn(),
        onSnap: vi.fn(),
        onCloseRequest,
      }),
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    result.current.onHandlePointerDown({
      button: 0,
      pointerId: 3,
      clientY: 100,
      preventDefault: vi.fn(),
      currentTarget: target,
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientY: 500 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, clientY: 500 }));
    expect(onCloseRequest).toHaveBeenCalled();
  });
});
