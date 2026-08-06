import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AssistantPanelMode,
  type FormFactor,
  type PersistableMode,
  type StoredPanelLayout,
  type ViewportMetrics,
  clampDesktopSize,
  defaultCompactSize,
  defaultExpandedSize,
  getFormFactor,
  mobileSheetHeight,
  prefersFinePointer,
  readStoredPanelLayout,
  resolveDesktopSize,
  toPersistableMode,
  writeStoredPanelLayout,
} from './assistantPanelLayout';

function readBottomChrome(): number {
  if (typeof document === 'undefined') return 96;
  const root = document.querySelector('.floating-assistant-root');
  if (!root) return 96;
  const raw = getComputedStyle(root).getPropertyValue('--fa-bottom-offset').trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 96;
}

function readViewport(): ViewportMetrics {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768, bottomChrome: 24 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    bottomChrome: readBottomChrome(),
  };
}

function readKeyboardInset(): number {
  if (typeof window === 'undefined' || !window.visualViewport) return 0;
  const vv = window.visualViewport;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export type AssistantPanelLayoutApi = {
  mode: AssistantPanelMode;
  formFactor: FormFactor;
  width: number;
  height: number;
  keyboardInset: number;
  finePointer: boolean;
  resizing: boolean;
  sheetDragging: boolean;
  expand: () => void;
  collapse: () => void;
  enterFocus: () => void;
  exitFocus: () => void;
  resetSize: () => void;
  setDesktopSize: (width: number, height: number, opts?: { persist?: boolean }) => void;
  setResizing: (value: boolean) => void;
  setSheetDragging: (value: boolean) => void;
  setMobileHeight: (height: number) => void;
  snapMobile: (mode: PersistableMode) => void;
  /** Request close from sheet drag threshold — caller decides. */
  onSheetCloseRequest?: () => void;
};

export function useAssistantPanelLayout(open: boolean): AssistantPanelLayoutApi {
  const storedRef = useRef<StoredPanelLayout>(
    typeof window !== 'undefined' ? readStoredPanelLayout() : {
      v: 1,
      desktop: { mode: 'compact' },
      mobile: { mode: 'compact' },
    },
  );
  const previousModeRef = useRef<PersistableMode>('compact');
  const viewportRef = useRef<ViewportMetrics>(readViewport());

  const [formFactor, setFormFactor] = useState<FormFactor>(() => getFormFactor());
  const [finePointer, setFinePointer] = useState(() => prefersFinePointer());
  const [mode, setMode] = useState<AssistantPanelMode>(() => {
    const stored = storedRef.current;
    const ff = getFormFactor();
    return ff === 'mobile' ? stored.mobile.mode : stored.desktop.mode;
  });
  const [width, setWidth] = useState(() => {
    const vp = readViewport();
    return resolveDesktopSize('compact', storedRef.current.desktop, vp).width;
  });
  const [height, setHeight] = useState(() => {
    const vp = readViewport();
    const ff = getFormFactor();
    if (ff === 'mobile') {
      return mobileSheetHeight(storedRef.current.mobile.mode, vp.height);
    }
    return resolveDesktopSize('compact', storedRef.current.desktop, vp).height;
  });
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [resizing, setResizing] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);

  const persist = useCallback((next: StoredPanelLayout) => {
    storedRef.current = next;
    writeStoredPanelLayout(next);
  }, []);

  const applyPersistableMode = useCallback(
    (nextMode: PersistableMode, ff: FormFactor, vp: ViewportMetrics) => {
      if (ff === 'mobile') {
        setHeight(mobileSheetHeight(nextMode, vp.height));
        persist({
          ...storedRef.current,
          mobile: { mode: nextMode },
        });
        return;
      }
      const size = resolveDesktopSize(nextMode, storedRef.current.desktop, vp);
      setWidth(size.width);
      setHeight(size.height);
      persist({
        ...storedRef.current,
        desktop: {
          ...storedRef.current.desktop,
          mode: nextMode,
        },
      });
    },
    [persist],
  );

  const reclamp = useCallback(() => {
    const vp = readViewport();
    viewportRef.current = vp;
    const ff = getFormFactor(vp.width);
    setFormFactor(ff);
    setFinePointer(prefersFinePointer());
    setKeyboardInset(readKeyboardInset());

    setMode((current) => {
      if (current === 'focus') return current;
      const persistable = toPersistableMode(current);
      if (ff === 'mobile') {
        setHeight(mobileSheetHeight(persistable, vp.height));
      } else {
        const size = resolveDesktopSize(persistable, storedRef.current.desktop, vp);
        setWidth(size.width);
        setHeight(size.height);
      }
      return current;
    });
  }, []);

  useEffect(() => {
    reclamp();
    function onResize() {
      reclamp();
    }
    window.addEventListener('resize', onResize);
    const mq = window.matchMedia('(pointer: fine)');
    const onPointer = () => setFinePointer(mq.matches);
    mq.addEventListener?.('change', onPointer);

    const vv = window.visualViewport;
    function onVv() {
      setKeyboardInset(readKeyboardInset());
    }
    vv?.addEventListener('resize', onVv);
    vv?.addEventListener('scroll', onVv);

    return () => {
      window.removeEventListener('resize', onResize);
      mq.removeEventListener?.('change', onPointer);
      vv?.removeEventListener('resize', onVv);
      vv?.removeEventListener('scroll', onVv);
    };
  }, [reclamp]);

  // On open: restore persistable mode for current form factor; never Focus.
  useEffect(() => {
    if (!open) {
      setMode((current) => {
        if (current === 'focus') return previousModeRef.current;
        return current;
      });
      return;
    }
    const vp = readViewport();
    viewportRef.current = vp;
    const ff = getFormFactor(vp.width);
    const stored = storedRef.current;
    const nextMode = ff === 'mobile' ? stored.mobile.mode : stored.desktop.mode;
    setFormFactor(ff);
    setMode(nextMode);
    applyPersistableMode(nextMode, ff, vp);
  }, [open, applyPersistableMode]);

  const expand = useCallback(() => {
    const vp = viewportRef.current;
    const ff = formFactor;
    previousModeRef.current = 'expanded';
    setMode('expanded');
    applyPersistableMode('expanded', ff, vp);
  }, [applyPersistableMode, formFactor]);

  const collapse = useCallback(() => {
    const vp = viewportRef.current;
    const ff = formFactor;
    previousModeRef.current = 'compact';
    setMode('compact');
    applyPersistableMode('compact', ff, vp);
  }, [applyPersistableMode, formFactor]);

  const enterFocus = useCallback(() => {
    setMode((current) => {
      if (current !== 'expanded') return current;
      previousModeRef.current = 'expanded';
      return 'focus';
    });
  }, []);

  const exitFocus = useCallback(() => {
    const restore = previousModeRef.current;
    const vp = viewportRef.current;
    const ff = formFactor;
    setMode(restore);
    applyPersistableMode(restore, ff, vp);
  }, [applyPersistableMode, formFactor]);

  const resetSize = useCallback(() => {
    const vp = viewportRef.current;
    const persistable = toPersistableMode(mode === 'focus' ? previousModeRef.current : mode);
    const cleared: StoredPanelLayout = {
      ...storedRef.current,
      desktop: { mode: storedRef.current.desktop.mode },
    };
    persist(cleared);
    if (formFactor === 'mobile') {
      setHeight(mobileSheetHeight(persistable, vp.height));
      return;
    }
    const size = persistable === 'expanded' ? defaultExpandedSize(vp) : defaultCompactSize(vp);
    setWidth(size.width);
    setHeight(size.height);
  }, [formFactor, mode, persist]);

  const setDesktopSize = useCallback(
    (nextWidth: number, nextHeight: number, opts?: { persist?: boolean }) => {
      const vp = viewportRef.current;
      const clamped = clampDesktopSize(nextWidth, nextHeight, vp);
      setWidth(clamped.width);
      setHeight(clamped.height);
      if (opts?.persist !== false) {
        persist({
          ...storedRef.current,
          desktop: {
            ...storedRef.current.desktop,
            mode: toPersistableMode(mode === 'focus' ? previousModeRef.current : mode),
            width: clamped.width,
            height: clamped.height,
          },
        });
      }
    },
    [mode, persist],
  );

  const setMobileHeight = useCallback((nextHeight: number) => {
    setHeight(Math.max(120, nextHeight));
  }, []);

  const snapMobile = useCallback(
    (nextMode: PersistableMode) => {
      const vp = viewportRef.current;
      setMode(nextMode);
      previousModeRef.current = nextMode;
      applyPersistableMode(nextMode, 'mobile', vp);
    },
    [applyPersistableMode],
  );

  return {
    mode,
    formFactor,
    width,
    height,
    keyboardInset,
    finePointer,
    resizing,
    sheetDragging,
    expand,
    collapse,
    enterFocus,
    exitFocus,
    resetSize,
    setDesktopSize,
    setResizing,
    setSheetDragging,
    setMobileHeight,
    snapMobile,
  };
}
