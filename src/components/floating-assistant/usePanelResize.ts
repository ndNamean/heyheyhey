import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { DockSide } from './assistantPanelLayout';

export type PanelResizeHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Options = {
  enabled: boolean;
  dock: DockSide;
  width: number;
  height: number;
  onResize: (width: number, height: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: (width: number, height: number) => void;
};

/**
 * Desktop corner resize with pointer capture and rAF-coalesced updates.
 * Right-dock → top-left grip; left-dock → top-right grip.
 */
export function usePanelResize({
  enabled,
  dock,
  width,
  height,
  onResize,
  onResizeStart,
  onResizeEnd,
}: Options): PanelResizeHandlers {
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    lastW: number;
    lastH: number;
    raf: number | null;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const start = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startW: sizeRef.current.width,
        startH: sizeRef.current.height,
        lastW: sizeRef.current.width,
        lastH: sizeRef.current.height,
        raf: null as number | null,
      };
      dragRef.current = start;
      onResizeStart?.();

      function flush() {
        const drag = dragRef.current;
        if (!drag) return;
        drag.raf = null;
        onResize(drag.lastW, drag.lastH);
      }

      function onMove(e: PointerEvent) {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;

        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;

        // Right-docked: grip is top-left → drag left increases width, drag up increases height.
        // Left-docked: grip is top-right → drag right increases width, drag up increases height.
        const nextW = dock === 'right' ? drag.startW - dx : drag.startW + dx;
        const nextH = drag.startH - dy;

        drag.lastW = nextW;
        drag.lastH = nextH;

        if (drag.raf == null) {
          drag.raf = requestAnimationFrame(flush);
        }
      }

      function onUp(e: PointerEvent) {
        const drag = dragRef.current;
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (drag.raf != null) {
          cancelAnimationFrame(drag.raf);
          drag.raf = null;
        }
        onResize(drag.lastW, drag.lastH);
        onResizeEnd?.(drag.lastW, drag.lastH);
        dragRef.current = null;
        try {
          target.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [dock, enabled, onResize, onResizeEnd, onResizeStart],
  );

  return { onPointerDown };
}
