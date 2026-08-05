import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

type PointerEvt = ReactPointerEvent<HTMLElement>;

interface Options {
  enabled: boolean;
  onReply: () => void;
  thresholdPx?: number;
  /** Mirror gesture for RTL (swipe toward start edge). */
  isRtl?: boolean;
}

const DEFAULT_THRESHOLD = 56;

export function useSwipeToReply({
  enabled,
  onReply,
  thresholdPx = DEFAULT_THRESHOLD,
  isRtl = false,
}: Options) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const trackingRef = useRef(false);
  const triggeredRef = useRef(false);

  function onPointerDown(event: PointerEvt) {
    if (!enabled || event.pointerType === 'mouse') return;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    trackingRef.current = true;
    triggeredRef.current = false;
  }

  function onPointerMove(event: PointerEvt) {
    if (!enabled || !trackingRef.current || triggeredRef.current) return;
    const dx = event.clientX - startXRef.current;
    const dy = Math.abs(event.clientY - startYRef.current);
    if (dy > 24) return;
    const reached = isRtl ? dx <= -thresholdPx : dx >= thresholdPx;
    if (reached) {
      triggeredRef.current = true;
      onReply();
    }
  }

  function onPointerUp() {
    trackingRef.current = false;
    triggeredRef.current = false;
  }

  function onPointerCancel() {
    trackingRef.current = false;
    triggeredRef.current = false;
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
