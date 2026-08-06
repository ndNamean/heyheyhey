// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePanelResize } from './usePanelResize';

describe('usePanelResize', () => {
  it('maps right-dock drag (top-left grip) so left/up grows the panel', () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const { result } = renderHook(() =>
      usePanelResize({
        enabled: true,
        dock: 'right',
        width: 400,
        height: 500,
        onResize,
        onResizeEnd,
      }),
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    result.current.onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: target,
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 150 }),
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, clientX: 150, clientY: 150 }),
    );

    expect(onResizeEnd).toHaveBeenCalled();
    const last = onResizeEnd.mock.calls[onResizeEnd.mock.calls.length - 1];
    expect(last[0]).toBe(450); // moved left 50 → wider
    expect(last[1]).toBe(550); // moved up 50 → taller
  });

  it('maps left-dock drag (top-right grip) so right/up grows the panel', () => {
    const onResizeEnd = vi.fn();
    const { result } = renderHook(() =>
      usePanelResize({
        enabled: true,
        dock: 'left',
        width: 400,
        height: 500,
        onResize: vi.fn(),
        onResizeEnd,
      }),
    );

    const target = document.createElement('div');
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    result.current.onPointerDown({
      button: 0,
      pointerId: 2,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: target,
    } as unknown as React.PointerEvent<HTMLElement>);

    window.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 2, clientX: 160, clientY: 40 }),
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 2, clientX: 160, clientY: 40 }),
    );

    const last = onResizeEnd.mock.calls[onResizeEnd.mock.calls.length - 1];
    expect(last[0]).toBe(460);
    expect(last[1]).toBe(560);
  });

  it('ignores pointer down when disabled', () => {
    const onResizeStart = vi.fn();
    const { result } = renderHook(() =>
      usePanelResize({
        enabled: false,
        dock: 'right',
        width: 400,
        height: 500,
        onResize: vi.fn(),
        onResizeStart,
      }),
    );

    result.current.onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: document.createElement('div'),
    } as unknown as React.PointerEvent<HTMLElement>);

    expect(onResizeStart).not.toHaveBeenCalled();
  });
});
