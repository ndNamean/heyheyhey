import { useCallback, useEffect, useRef } from 'react';

/** Restartable idle timer. Clears on unmount. No React state. */
export function useIdleResetTimer(delayMs: number, onIdle: () => void) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const restart = useCallback(() => {
    clear();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onIdleRef.current();
    }, delayMs);
  }, [clear, delayMs]);

  useEffect(() => () => clear(), [clear]);

  return { restart, clear };
}
