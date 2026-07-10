import { useEffect, useRef } from 'react';

/**
 * Native / browser back integration for the SPA.
 *
 * Keeps a single history "trap" entry while any handler is registered.
 * System back (Android), browser back, and Escape invoke the highest-priority
 * enabled handler. Returning true consumes the event; false lets it fall through.
 *
 * Priorities matter because React runs child effects before parent effects —
 * without priorities, page-level handlers would sit above overlay handlers.
 */

export const BACK_PRIORITY = {
  PAGE: 10,
  WIZARD: 20,
  MODAL: 30,
  CAMERA: 40,
  POST_CAPTURE: 45,
  CAMERA_OPTIONS: 50,
} as const;

type BackHandler = () => boolean;

interface Entry {
  id: number;
  priority: number;
  handler: BackHandler;
}

const entries: Entry[] = [];
let nextId = 1;
let trapArmed = false;
let removingTrap = false;
let listenersAttached = false;

function armTrap() {
  if (trapArmed || typeof window === 'undefined') return;
  window.history.pushState({ __heyNativeBack: true }, '');
  trapArmed = true;
}

function disarmTrap() {
  if (!trapArmed || typeof window === 'undefined') return;
  removingTrap = true;
  trapArmed = false;
  window.history.back();
}

function invokeTopHandler(): boolean {
  const sorted = [...entries].sort((a, b) => b.priority - a.priority || b.id - a.id);
  for (const entry of sorted) {
    if (entry.handler()) return true;
  }
  return false;
}

function onPopState() {
  if (removingTrap) {
    removingTrap = false;
    return;
  }

  trapArmed = false;

  if (invokeTopHandler()) {
    armTrap();
  }
  // No handler claimed it — leave untrapped so another back can exit the site.
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (e.defaultPrevented) return;

  if (invokeTopHandler()) {
    e.preventDefault();
  }
}

function ensureListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeyDown);
}

/**
 * Register a back handler.
 * @param handler Return true if the back action was handled.
 * @param enabled When false, the handler is not registered.
 * @param priority Higher wins. Use BACK_PRIORITY constants.
 */
export function useNativeBack(
  handler: () => boolean,
  enabled = true,
  priority: number = BACK_PRIORITY.PAGE,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    ensureListeners();
    armTrap();

    const entry: Entry = {
      id: nextId++,
      priority,
      handler: () => handlerRef.current(),
    };
    entries.push(entry);

    return () => {
      const idx = entries.indexOf(entry);
      if (idx >= 0) entries.splice(idx, 1);
      if (entries.length === 0) disarmTrap();
    };
  }, [enabled, priority]);
}
