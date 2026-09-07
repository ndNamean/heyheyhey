import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export const SWIPE_FAMOUS_COMMIT_PX = 64;
export const SWIPE_FAMOUS_ABORT_DY = 24;
export const SWIPE_FAMOUS_EDGE_PX = 24;
export const SWIPE_FAMOUS_AXIS_SLOP_PX = 10;

export type SwipeFamousCommit = 'left' | 'right';

export type SwipeFamousMoveResult = {
  ignore: boolean;
  aborted: boolean;
  dx: number;
  dy: number;
  committed: false | SwipeFamousCommit;
};

export function shouldEnableSwipeFamous(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

/**
 * Axis / edge rules for Famous swipe (Phase 7).
 * Right = Famous vote; left = session skip.
 */
export function resolveSwipeFamousMove(input: {
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  commitPx?: number;
  abortDy?: number;
  edgePx?: number;
}): SwipeFamousMoveResult {
  const commitPx = input.commitPx ?? SWIPE_FAMOUS_COMMIT_PX;
  const abortDy = input.abortDy ?? SWIPE_FAMOUS_ABORT_DY;
  const edgePx = input.edgePx ?? SWIPE_FAMOUS_EDGE_PX;
  const dx = input.clientX - input.startClientX;
  const dy = input.clientY - input.startClientY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (input.startClientX < edgePx) {
    return { ignore: true, aborted: false, dx: 0, dy: 0, committed: false };
  }
  if (absDy > abortDy) {
    return { ignore: false, aborted: true, dx, dy, committed: false };
  }
  if (absDy > absDx && absDy > SWIPE_FAMOUS_AXIS_SLOP_PX) {
    return { ignore: false, aborted: true, dx, dy, committed: false };
  }
  if (absDx >= commitPx) {
    return { ignore: false, aborted: false, dx, dy, committed: dx > 0 ? 'right' : 'left' };
  }
  return { ignore: false, aborted: false, dx, dy, committed: false };
}

type PointerEvt = ReactPointerEvent<HTMLElement>;

interface Options {
  enabled: boolean;
  onFamous: () => void;
  onSkip: () => void;
  commitPx?: number;
}

export function useSwipeFamous({ enabled, onFamous, onSkip, commitPx = SWIPE_FAMOUS_COMMIT_PX }: Options) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const trackingRef = useRef(false);
  const committedRef = useRef(false);
  const ignoreClickRef = useRef(false);
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    trackingRef.current = false;
    committedRef.current = false;
    setDragging(false);
    setOffsetX(0);
  }, []);

  function onPointerDown(event: PointerEvt) {
    if (!enabled) return;
    const result = resolveSwipeFamousMove({
      startClientX: event.clientX,
      startClientY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (result.ignore) return;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    trackingRef.current = true;
    committedRef.current = false;
    ignoreClickRef.current = false;
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
  }

  function onPointerMove(event: PointerEvt) {
    if (!enabled || !trackingRef.current || committedRef.current) return;
    const result = resolveSwipeFamousMove({
      startClientX: startXRef.current,
      startClientY: startYRef.current,
      clientX: event.clientX,
      clientY: event.clientY,
      commitPx,
    });
    if (result.ignore || result.aborted) {
      reset();
      return;
    }
    setOffsetX(result.dx);
    if (Math.abs(result.dx) > 8) ignoreClickRef.current = true;
    if (result.committed === 'right') {
      committedRef.current = true;
      ignoreClickRef.current = true;
      reset();
      onFamous();
      return;
    }
    if (result.committed === 'left') {
      committedRef.current = true;
      ignoreClickRef.current = true;
      reset();
      onSkip();
    }
  }

  function onPointerUp(event: PointerEvt) {
    if (!enabled) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (!committedRef.current) reset();
    trackingRef.current = false;
  }

  function onPointerCancel() {
    reset();
  }

  function onClickCapture(event: React.MouseEvent<HTMLElement>) {
    if (!ignoreClickRef.current) return;
    ignoreClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    offsetX,
    dragging,
    swipeHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
