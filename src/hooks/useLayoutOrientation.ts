import { useEffect, useState } from 'react';
import type { LayoutOrientation } from '../lib/cameraMediaTransform';

function readLayoutOrientation(): LayoutOrientation {
  if (typeof window === 'undefined') return 'portrait';
  try {
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(orientation: landscape)').matches) return 'landscape';
      if (window.matchMedia('(orientation: portrait)').matches) return 'portrait';
    }
  } catch {
    /* ignore */
  }
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

/**
 * Viewport-driven portrait/landscape for camera chrome only.
 * Does not use DeviceOrientation / gyroscope permissions.
 */
export function useLayoutOrientation(enabled = true): LayoutOrientation {
  const [orientation, setOrientation] = useState<LayoutOrientation>(() =>
    enabled ? readLayoutOrientation() : 'portrait',
  );

  useEffect(() => {
    if (!enabled) {
      setOrientation('portrait');
      return;
    }

    const update = () => setOrientation(readLayoutOrientation());
    update();

    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(orientation: landscape)')
        : null;

    if (mql) {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', update);
      } else {
        // Safari < 14
        (mql as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(update);
      }
    }

    window.addEventListener('resize', update);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);

    const so = window.screen?.orientation;
    so?.addEventListener?.('change', update);

    return () => {
      if (mql) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', update);
        } else {
          (mql as MediaQueryList & { removeListener: (cb: () => void) => void }).removeListener(
            update,
          );
        }
      }
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      so?.removeEventListener?.('change', update);
    };
  }, [enabled]);

  return orientation;
}
