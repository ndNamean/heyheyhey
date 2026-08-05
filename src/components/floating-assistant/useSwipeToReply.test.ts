// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwipeToReply } from './useSwipeToReply';

function touchMove(
  handlers: ReturnType<typeof useSwipeToReply>,
  startX: number,
  moveX: number,
) {
  handlers.onPointerDown({
    pointerType: 'touch',
    clientX: startX,
    clientY: 10,
  } as any);
  handlers.onPointerMove({
    pointerType: 'touch',
    clientX: moveX,
    clientY: 12,
  } as any);
}

describe('useSwipeToReply', () => {
  it('triggers reply on LTR rightward swipe past threshold', () => {
    const onReply = vi.fn();
    const { result } = renderHook(() =>
      useSwipeToReply({ enabled: true, onReply, thresholdPx: 40, isRtl: false }),
    );
    act(() => touchMove(result.current, 0, 50));
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('does not trigger LTR reply on leftward swipe', () => {
    const onReply = vi.fn();
    const { result } = renderHook(() =>
      useSwipeToReply({ enabled: true, onReply, thresholdPx: 40, isRtl: false }),
    );
    act(() => touchMove(result.current, 100, 40));
    expect(onReply).not.toHaveBeenCalled();
  });

  it('mirrors gesture for RTL (leftward swipe)', () => {
    const onReply = vi.fn();
    const { result } = renderHook(() =>
      useSwipeToReply({ enabled: true, onReply, thresholdPx: 40, isRtl: true }),
    );
    act(() => touchMove(result.current, 100, 50));
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('ignores mouse pointers', () => {
    const onReply = vi.fn();
    const { result } = renderHook(() =>
      useSwipeToReply({ enabled: true, onReply, thresholdPx: 40 }),
    );
    act(() => {
      result.current.onPointerDown({
        pointerType: 'mouse',
        clientX: 0,
        clientY: 0,
      } as any);
      result.current.onPointerMove({
        pointerType: 'mouse',
        clientX: 80,
        clientY: 0,
      } as any);
    });
    expect(onReply).not.toHaveBeenCalled();
  });
});
