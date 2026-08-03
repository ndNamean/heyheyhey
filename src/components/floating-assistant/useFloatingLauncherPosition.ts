import { useCallback, useEffect, useState } from 'react';

export type LauncherSide = 'left' | 'right';

const STORAGE_KEY = 'floatingAssistant.launcherSide';
const DRAG_THRESHOLD_PX = 8;
/** Below this width, drag is disabled to avoid fighting touch scroll. */
const DRAG_DISABLE_MAX_WIDTH = 600;

function readStoredSide(): LauncherSide {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'left' || raw === 'right') return raw;
  } catch {
    /* ignore */
  }
  return 'right';
}

function writeStoredSide(side: LauncherSide) {
  try {
    localStorage.setItem(STORAGE_KEY, side);
  } catch {
    /* ignore */
  }
}

function isDragEnabledViewport(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth > DRAG_DISABLE_MAX_WIDTH;
}

export function useFloatingLauncherPosition() {
  const [side, setSideState] = useState<LauncherSide>(() =>
    typeof window !== 'undefined' ? readStoredSide() : 'right',
  );
  const [dragEnabled, setDragEnabled] = useState(isDragEnabledViewport);
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);

  useEffect(() => {
    function onResize() {
      setDragEnabled(isDragEnabledViewport());
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setSide = useCallback((next: LauncherSide) => {
    setSideState(next);
    writeStoredSide(next);
  }, []);

  const dockLeft = useCallback(() => setSide('left'), [setSide]);
  const dockRight = useCallback(() => setSide('right'), [setSide]);
  const resetPosition = useCallback(() => setSide('right'), [setSide]);

  const beginPointerDrag = useCallback(
    (clientX: number, onClick: () => void) => {
      if (!dragEnabled) {
        onClick();
        return () => {};
      }

      let moved = false;
      let latestX = clientX;
      setDragging(true);
      setDragX(clientX);

      function onMove(e: PointerEvent) {
        latestX = e.clientX;
        if (Math.abs(e.clientX - clientX) >= DRAG_THRESHOLD_PX) {
          moved = true;
        }
        setDragX(e.clientX);
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        setDragging(false);
        setDragX(null);

        if (!moved) {
          onClick();
          return;
        }

        const mid = window.innerWidth / 2;
        setSide(latestX < mid ? 'left' : 'right');
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
    },
    [dragEnabled, setSide],
  );

  return {
    side,
    dragging,
    dragX,
    dragEnabled,
    dockLeft,
    dockRight,
    resetPosition,
    beginPointerDrag,
  };
}
