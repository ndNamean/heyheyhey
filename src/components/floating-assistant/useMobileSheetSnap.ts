import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  type PersistableMode,
  MOBILE_CLOSE_THRESHOLD_VH,
  MOBILE_COMPACT_VH,
  MOBILE_EXPANDED_VH,
} from './assistantPanelLayout';

type Options = {
  enabled: boolean;
  mode: PersistableMode | 'focus';
  viewportHeight: number;
  onHeightChange: (height: number) => void;
  onSnap: (mode: PersistableMode) => void;
  onCloseRequest: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

/**
 * Mobile sheet drag via the top handle only (avoids fighting message swipe-to-reply).
 * Snaps between compact (~65dvh) and expanded (~98dvh); far-down drag requests close.
 */
export function useMobileSheetSnap({
  enabled,
  mode,
  viewportHeight,
  onHeightChange,
  onSnap,
  onCloseRequest,
  onDragStart,
  onDragEnd,
}: Options) {
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    lastHeight: number;
    moved: boolean;
  } | null>(null);

  const compactH = Math.round(viewportHeight * MOBILE_COMPACT_VH);
  const expandedH = Math.round(viewportHeight * MOBILE_EXPANDED_VH);
  const closeH = Math.round(viewportHeight * MOBILE_CLOSE_THRESHOLD_VH);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (mode === 'focus') return;
      if (event.button !== 0) return;
      event.preventDefault();

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const startHeight = mode === 'expanded' ? expandedH : compactH;
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight,
        lastHeight: startHeight,
        moved: false,
      };
      onDragStart?.();

      function onMove(e: PointerEvent) {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dy) > 4) drag.moved = true;
        // Drag down → shorter sheet.
        const next = Math.min(expandedH, Math.max(closeH * 0.5, drag.startHeight - dy));
        drag.lastHeight = next;
        onHeightChange(next);
      }

      function onUp(e: PointerEvent) {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        dragRef.current = null;
        onDragEnd?.();

        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        if (!drag.moved) {
          // Tap handle toggles expand/collapse.
          onSnap(mode === 'expanded' ? 'compact' : 'expanded');
          return;
        }

        if (drag.lastHeight <= closeH) {
          onCloseRequest();
          return;
        }

        const mid = (compactH + expandedH) / 2;
        onSnap(drag.lastHeight >= mid ? 'expanded' : 'compact');
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [
      closeH,
      compactH,
      enabled,
      expandedH,
      mode,
      onCloseRequest,
      onDragEnd,
      onDragStart,
      onHeightChange,
      onSnap,
    ],
  );

  return { onHandlePointerDown, compactH, expandedH };
}
