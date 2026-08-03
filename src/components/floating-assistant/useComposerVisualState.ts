import { useCallback, useEffect, useRef, useState } from 'react';

export type ComposerVisualState =
  | 'idle'
  | 'focused'
  | 'typing'
  | 'sending'
  | 'success'
  | 'failure'
  | 'offline'
  | 'disabled';

interface Options {
  /** When false, state stays `disabled` and flashes are ignored. */
  enabled: boolean;
  /** Force offline presentation (e.g. navigator.onLine). */
  offline?: boolean;
}

const KEY_FLASH_MS = 120;
const SUCCESS_FLASH_MS = 900;
const FAILURE_FLASH_MS = 1200;

export type ComposerVisualHandlers = {
  onFocus: () => void;
  onBlur: () => void;
  onInput: () => void;
  setSending: () => void;
  setSuccess: () => void;
  setFailure: () => void;
  resetFlash: () => void;
};

/**
 * Visual composer state for `data-composer-state` / key-flash on the floating panel.
 * Only an enabled Store Chat composer drives glow/flash; Knowledge stays disabled.
 */
export function useComposerVisualState({ enabled, offline = false }: Options) {
  const [state, setState] = useState<ComposerVisualState>(enabled ? 'idle' : 'disabled');
  const [keyFlash, setKeyFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(false);

  const clearFlashTimer = useCallback(() => {
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
  }, []);

  const clearStatusTimer = useCallback(() => {
    if (statusTimer.current) {
      clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
  }, []);

  const clearTypingIdle = useCallback(() => {
    if (typingIdleTimer.current) {
      clearTimeout(typingIdleTimer.current);
      typingIdleTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearFlashTimer();
      clearStatusTimer();
      clearTypingIdle();
      setKeyFlash(false);
      setState('disabled');
      return;
    }
    if (offline) {
      setState('offline');
      return;
    }
    setState((prev) => (prev === 'disabled' || prev === 'offline' ? 'idle' : prev));
  }, [enabled, offline, clearFlashTimer, clearStatusTimer, clearTypingIdle]);

  useEffect(
    () => () => {
      clearFlashTimer();
      clearStatusTimer();
      clearTypingIdle();
    },
    [clearFlashTimer, clearStatusTimer, clearTypingIdle],
  );

  const onFocus = useCallback(() => {
    if (!enabled || offline) return;
    focusedRef.current = true;
    setState((prev) => (prev === 'sending' ? prev : 'focused'));
  }, [enabled, offline]);

  const onBlur = useCallback(() => {
    focusedRef.current = false;
    clearTypingIdle();
    if (!enabled || offline) return;
    setState((prev) => (prev === 'sending' || prev === 'success' || prev === 'failure' ? prev : 'idle'));
  }, [enabled, offline, clearTypingIdle]);

  const onInput = useCallback(() => {
    if (!enabled || offline) return;
    setState('typing');
    clearTypingIdle();
    typingIdleTimer.current = setTimeout(() => {
      setState(focusedRef.current ? 'focused' : 'idle');
    }, 600);

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    setKeyFlash(true);
    clearFlashTimer();
    flashTimer.current = setTimeout(() => setKeyFlash(false), KEY_FLASH_MS);
  }, [enabled, offline, clearFlashTimer, clearTypingIdle]);

  const setSending = useCallback(() => {
    if (!enabled) return;
    clearStatusTimer();
    clearTypingIdle();
    setState('sending');
  }, [enabled, clearStatusTimer, clearTypingIdle]);

  const setSuccess = useCallback(() => {
    if (!enabled) return;
    clearStatusTimer();
    setState('success');
    statusTimer.current = setTimeout(() => {
      setState(focusedRef.current ? 'focused' : 'idle');
    }, SUCCESS_FLASH_MS);
  }, [enabled, clearStatusTimer]);

  const setFailure = useCallback(() => {
    if (!enabled) return;
    clearStatusTimer();
    setState('failure');
    statusTimer.current = setTimeout(() => {
      setState(focusedRef.current ? 'focused' : 'idle');
    }, FAILURE_FLASH_MS);
  }, [enabled, clearStatusTimer]);

  const resetFlash = useCallback(() => {
    clearFlashTimer();
    setKeyFlash(false);
  }, [clearFlashTimer]);

  return {
    state: offline && enabled ? ('offline' as const) : state,
    keyFlash,
    onFocus,
    onBlur,
    onInput,
    setSending,
    setSuccess,
    setFailure,
    resetFlash,
  } satisfies { state: ComposerVisualState; keyFlash: boolean } & ComposerVisualHandlers;
}
