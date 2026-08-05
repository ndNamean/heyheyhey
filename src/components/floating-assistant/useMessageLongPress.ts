import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

type PointerEvt = ReactPointerEvent<HTMLElement>;

interface Options {
  enabled: boolean;
  onLongPress: () => void;
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 420;

export function useMessageLongPress({ enabled, onLongPress, delayMs = DEFAULT_DELAY_MS }: Options) {
  const timerRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const movedRef = useRef(false);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function onPointerDown(event: PointerEvt) {
    if (!enabled || event.pointerType === 'mouse') return;
    movedRef.current = false;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      if (!movedRef.current) onLongPress();
      timerRef.current = null;
    }, delayMs);
  }

  function onPointerMove(event: PointerEvt) {
    if (!enabled || timerRef.current === null) return;
    const dx = Math.abs(event.clientX - startXRef.current);
    const dy = Math.abs(event.clientY - startYRef.current);
    if (dx > 8 || dy > 8) {
      movedRef.current = true;
      clearTimer();
    }
  }

  function onPointerUp() {
    clearTimer();
  }

  function onPointerCancel() {
    clearTimer();
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
