import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

type Options = {
  enabled: boolean;
  panelRef: RefObject<HTMLElement | null>;
  /** Element to focus when entering focus mode (e.g. Exit Focus). */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * Focus-mode a11y: aria-modal semantics are applied by the panel;
 * this hook sets inert on `.app-shell`, traps Tab focus, and restores focus on exit.
 */
export function useFocusModeA11y({ enabled, panelRef, initialFocusRef }: Options) {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const inertTargetsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    if (!enabled) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const shell = document.querySelector<HTMLElement>('.app-shell');
    const targets: HTMLElement[] = [];
    if (shell) {
      shell.setAttribute('inert', '');
      targets.push(shell);
    }
    inertTargetsRef.current = targets;

    const panel = panelRef.current;
    const initial = initialFocusRef?.current;
    const focusable = panel ? getFocusable(panel) : [];
    const toFocus = initial ?? focusable[0] ?? panel;
    toFocus?.focus?.();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !panelRef.current) return;
      const nodes = getFocusable(panelRef.current);
      if (nodes.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panelRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      for (const el of inertTargetsRef.current) {
        el.removeAttribute('inert');
      }
      inertTargetsRef.current = [];
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [enabled, initialFocusRef, panelRef]);
}
