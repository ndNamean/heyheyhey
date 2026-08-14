import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePointerCapabilities } from './pointerCapabilities';
import { useIdleResetTimer } from './useIdleResetTimer';

export type ImageZoomState = 'resting' | 'base' | 'enhanced' | 'zoomed';

export const IMAGE_ZOOM = {
  BASE_SCALE: 2,
  ENHANCED_SCALE: 3,
  TOUCH_SCALE: 2,
  IDLE_MS: 300,
  DURATION_MS: 250,
  TAP_MOVE_THRESHOLD_PX: 8,
  TAP_MAX_DURATION_MS: 400,
  WILL_CHANGE_CLEAR_MS: 250,
} as const;

export function scaleForImageZoomState(state: ImageZoomState): number {
  switch (state) {
    case 'base':
    case 'zoomed':
      return IMAGE_ZOOM.BASE_SCALE;
    case 'enhanced':
      return IMAGE_ZOOM.ENHANCED_SCALE;
    default:
      return 1;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function originFromPointer(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  return {
    x: clamp(((clientX - rect.left) / w) * 100, 0, 100),
    y: clamp(((clientY - rect.top) / h) * 100, 0, 100),
  };
}

function applyOrigin(el: HTMLElement, origin: { x: number; y: number }) {
  el.style.setProperty('--media-zoom-ox', `${origin.x}%`);
  el.style.setProperty('--media-zoom-oy', `${origin.y}%`);
}

type TapTrack = {
  pointerId: number;
  x: number;
  y: number;
  startedAt: number;
  moved: boolean;
};

export function useImageZoom(options: { resetKey?: string } = {}) {
  const { fineHover, reducedMotion } = usePointerCapabilities();
  const [state, setState] = useState<ImageZoomState>('resting');
  const [willChange, setWillChange] = useState(false);
  const viewportRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef<ImageZoomState>('resting');
  const fineHoverRef = useRef(fineHover);
  const rafRef = useRef<number | null>(null);
  const originRafPendingRef = useRef(false);
  const originRef = useRef({ x: 50, y: 50 });
  const tapRef = useRef<TapTrack | null>(null);
  const suppressClickRef = useRef(false);
  const willChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  stateRef.current = state;
  fineHoverRef.current = fineHover;

  const clearRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    originRafPendingRef.current = false;
  }, []);

  const clearWillChangeTimer = useCallback(() => {
    if (willChangeTimerRef.current != null) {
      clearTimeout(willChangeTimerRef.current);
      willChangeTimerRef.current = null;
    }
  }, []);

  const scheduleOrigin = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current;
    if (!el) return;
    originRef.current = originFromPointer(el, clientX, clientY);
    if (originRafPendingRef.current) return;
    originRafPendingRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      originRafPendingRef.current = false;
      rafRef.current = null;
      const node = viewportRef.current;
      if (node) applyOrigin(node, originRef.current);
    });
  }, []);

  const setOriginCenter = useCallback(() => {
    originRef.current = { x: 50, y: 50 };
    const el = viewportRef.current;
    if (el) applyOrigin(el, originRef.current);
  }, []);

  const reset = useCallback(() => {
    setState('resting');
    stateRef.current = 'resting';
    setOriginCenter();
    tapRef.current = null;
  }, [setOriginCenter]);

  const { restart: restartIdle, clear: clearIdle } = useIdleResetTimer(IMAGE_ZOOM.IDLE_MS, () => {
    if (stateRef.current === 'base') {
      setState('enhanced');
      stateRef.current = 'enhanced';
    }
  });

  useEffect(() => {
    reset();
    clearIdle();
    clearRaf();
    clearWillChangeTimer();
    setWillChange(false);
  }, [options.resetKey, reset, clearIdle, clearRaf, clearWillChangeTimer]);

  useEffect(() => {
    reset();
    clearIdle();
  }, [fineHover, reset, clearIdle]);

  useEffect(
    () => () => {
      clearIdle();
      clearRaf();
      clearWillChangeTimer();
    },
    [clearIdle, clearRaf, clearWillChangeTimer],
  );

  const markActive = useCallback(() => {
    clearWillChangeTimer();
    setWillChange(true);
  }, [clearWillChangeTimer]);

  const scheduleWillChangeClear = useCallback(() => {
    clearWillChangeTimer();
    willChangeTimerRef.current = setTimeout(() => {
      willChangeTimerRef.current = null;
      if (stateRef.current === 'resting') setWillChange(false);
    }, IMAGE_ZOOM.WILL_CHANGE_CLEAR_MS);
  }, [clearWillChangeTimer]);

  const onPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!fineHoverRef.current) return;
      markActive();
      scheduleOrigin(event.clientX, event.clientY);
      setState('base');
      stateRef.current = 'base';
      restartIdle();
    },
    [markActive, scheduleOrigin, restartIdle],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (fineHoverRef.current) {
        if (stateRef.current === 'resting') return;
        scheduleOrigin(event.clientX, event.clientY);
        if (stateRef.current === 'enhanced') {
          setState('base');
          stateRef.current = 'base';
        }
        restartIdle();
        return;
      }
      const tap = tapRef.current;
      if (!tap || tap.pointerId !== event.pointerId) return;
      const dx = Math.abs(event.clientX - tap.x);
      const dy = Math.abs(event.clientY - tap.y);
      if (dx > IMAGE_ZOOM.TAP_MOVE_THRESHOLD_PX || dy > IMAGE_ZOOM.TAP_MOVE_THRESHOLD_PX) {
        tap.moved = true;
      }
    },
    [scheduleOrigin, restartIdle],
  );

  const onPointerLeave = useCallback(() => {
    if (!fineHoverRef.current) return;
    clearIdle();
    reset();
    scheduleWillChangeClear();
  }, [clearIdle, reset, scheduleWillChangeClear]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (fineHoverRef.current) return;
    tapRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: Date.now(),
      moved: false,
    };
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (fineHoverRef.current) return;
      const tap = tapRef.current;
      tapRef.current = null;
      if (!tap || tap.pointerId !== event.pointerId || tap.moved) return;
      if (Date.now() - tap.startedAt > IMAGE_ZOOM.TAP_MAX_DURATION_MS) return;
      suppressClickRef.current = true;
      scheduleOrigin(event.clientX, event.clientY);
      markActive();
      if (stateRef.current === 'resting') {
        setState('zoomed');
        stateRef.current = 'zoomed';
      } else {
        reset();
        scheduleWillChangeClear();
      }
    },
    [scheduleOrigin, markActive, reset, scheduleWillChangeClear],
  );

  const toggleKeyboard = useCallback(() => {
    markActive();
    if (stateRef.current === 'resting') {
      setOriginCenter();
      setState('base');
      stateRef.current = 'base';
    } else {
      reset();
      scheduleWillChangeClear();
    }
  }, [markActive, setOriginCenter, reset, scheduleWillChangeClear]);

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (fineHoverRef.current) return;
      if (event.detail === 0) toggleKeyboard();
    },
    [toggleKeyboard],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        if (stateRef.current !== 'resting') {
          event.preventDefault();
          event.stopPropagation();
          clearIdle();
          reset();
          scheduleWillChangeClear();
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleKeyboard();
      }
    },
    [clearIdle, reset, scheduleWillChangeClear, toggleKeyboard],
  );

  return {
    state,
    scale: scaleForImageZoomState(state),
    willChange,
    reducedMotion,
    fineHover,
    viewportRef,
    reset,
    bind: {
      onPointerEnter,
      onPointerMove,
      onPointerLeave,
      onPointerDown,
      onPointerUp,
      onClick,
      onKeyDown,
    },
  };
}
