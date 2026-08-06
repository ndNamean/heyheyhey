/** Layout types, clamps, and persistence for the floating assistant panel. */

export type AssistantPanelMode = 'compact' | 'expanded' | 'focus';
export type PersistableMode = 'compact' | 'expanded';
export type FormFactor = 'desktop' | 'mobile';
export type DockSide = 'left' | 'right';

export const LAYOUT_STORAGE_KEY = 'floatingAssistant.panelLayout';
export const LAYOUT_VERSION = 1 as const;

export const MOBILE_BREAKPOINT_PX = 800;

export const DESKTOP_COMPACT_WIDTH = 400;
export const DESKTOP_COMPACT_MAX_HEIGHT = 640;
export const DESKTOP_COMPACT_MIN_HEIGHT_CSS = 320;

export const DESKTOP_RESIZE_MIN_WIDTH = 340;
export const DESKTOP_RESIZE_MIN_HEIGHT = 460;

export const DESKTOP_EXPANDED_WIDTH_DEFAULT = 640;
export const DESKTOP_EXPANDED_WIDTH_MIN = 560;
export const DESKTOP_EXPANDED_WIDTH_MAX = 720;
export const DESKTOP_EXPANDED_HEIGHT_VH = 0.88;

export const VIEWPORT_EDGE_MARGIN = 16;

export const MOBILE_COMPACT_VH = 0.65;
export const MOBILE_EXPANDED_VH = 0.98;

/** Close sheet if dragged below this fraction of compact height. */
export const MOBILE_CLOSE_THRESHOLD_VH = 0.35;

export type StoredPanelLayout = {
  v: typeof LAYOUT_VERSION;
  desktop: {
    mode: PersistableMode;
    width?: number;
    height?: number;
  };
  mobile: {
    mode: PersistableMode;
  };
};

export type ViewportMetrics = {
  width: number;
  height: number;
  /** Space reserved above bottom chrome (FAB + nav). */
  bottomChrome: number;
};

export function isMobileViewport(width = typeof window !== 'undefined' ? window.innerWidth : 1024): boolean {
  return width <= MOBILE_BREAKPOINT_PX;
}

export function getFormFactor(width?: number): FormFactor {
  return isMobileViewport(width) ? 'mobile' : 'desktop';
}

export function prefersFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(pointer: fine)').matches;
}

export function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, n));
}

export function maxDesktopWidth(viewportWidth: number): number {
  return Math.max(DESKTOP_RESIZE_MIN_WIDTH, viewportWidth - VIEWPORT_EDGE_MARGIN * 2);
}

export function maxDesktopHeight(viewportHeight: number, bottomChrome: number): number {
  const available = viewportHeight - bottomChrome - 80;
  return Math.max(DESKTOP_RESIZE_MIN_HEIGHT, available);
}

export function defaultCompactSize(viewport: ViewportMetrics): { width: number; height: number } {
  const width = Math.min(DESKTOP_COMPACT_WIDTH, maxDesktopWidth(viewport.width));
  const height = Math.min(
    DESKTOP_COMPACT_MAX_HEIGHT,
    maxDesktopHeight(viewport.height, viewport.bottomChrome),
  );
  return {
    width: Math.max(DESKTOP_RESIZE_MIN_WIDTH, width),
    height: Math.max(DESKTOP_COMPACT_MIN_HEIGHT_CSS, height),
  };
}

export function defaultExpandedSize(viewport: ViewportMetrics): { width: number; height: number } {
  const maxW = maxDesktopWidth(viewport.width);
  const width = clamp(
    DESKTOP_EXPANDED_WIDTH_DEFAULT,
    Math.min(DESKTOP_EXPANDED_WIDTH_MIN, maxW),
    Math.min(DESKTOP_EXPANDED_WIDTH_MAX, maxW),
  );
  const height = Math.min(
    viewport.height * DESKTOP_EXPANDED_HEIGHT_VH,
    maxDesktopHeight(viewport.height, viewport.bottomChrome),
  );
  return {
    width,
    height: Math.max(DESKTOP_RESIZE_MIN_HEIGHT, height),
  };
}

export function clampDesktopSize(
  width: number,
  height: number,
  viewport: ViewportMetrics,
): { width: number; height: number } {
  const maxW = maxDesktopWidth(viewport.width);
  const maxH = maxDesktopHeight(viewport.height, viewport.bottomChrome);
  return {
    width: clamp(width, DESKTOP_RESIZE_MIN_WIDTH, maxW),
    height: clamp(height, DESKTOP_RESIZE_MIN_HEIGHT, maxH),
  };
}

export function mobileSheetHeight(mode: PersistableMode, viewportHeight: number): number {
  const vh = mode === 'expanded' ? MOBILE_EXPANDED_VH : MOBILE_COMPACT_VH;
  return Math.round(viewportHeight * vh);
}

export function toPersistableMode(mode: AssistantPanelMode): PersistableMode {
  return mode === 'focus' ? 'expanded' : mode;
}

export function createDefaultStoredLayout(): StoredPanelLayout {
  return {
    v: LAYOUT_VERSION,
    desktop: { mode: 'compact' },
    mobile: { mode: 'compact' },
  };
}

function isPersistableMode(value: unknown): value is PersistableMode {
  return value === 'compact' || value === 'expanded';
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Validate and normalize stored layout. Invalid → defaults. Never returns focus. */
export function parseStoredPanelLayout(raw: unknown): StoredPanelLayout {
  const defaults = createDefaultStoredLayout();
  if (!raw || typeof raw !== 'object') return defaults;

  const obj = raw as Record<string, unknown>;
  if (obj.v !== LAYOUT_VERSION) return defaults;

  const desktopRaw = obj.desktop;
  const mobileRaw = obj.mobile;
  if (!desktopRaw || typeof desktopRaw !== 'object' || !mobileRaw || typeof mobileRaw !== 'object') {
    return defaults;
  }

  const desktop = desktopRaw as Record<string, unknown>;
  const mobile = mobileRaw as Record<string, unknown>;

  const result: StoredPanelLayout = {
    v: LAYOUT_VERSION,
    desktop: {
      mode: isPersistableMode(desktop.mode) ? desktop.mode : 'compact',
    },
    mobile: {
      mode: isPersistableMode(mobile.mode) ? mobile.mode : 'compact',
    },
  };

  if (isFinitePositive(desktop.width)) result.desktop.width = desktop.width;
  if (isFinitePositive(desktop.height)) result.desktop.height = desktop.height;

  return result;
}

export function readStoredPanelLayout(): StoredPanelLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return createDefaultStoredLayout();
    return parseStoredPanelLayout(JSON.parse(raw));
  } catch {
    return createDefaultStoredLayout();
  }
}

export function writeStoredPanelLayout(layout: StoredPanelLayout): void {
  try {
    const safe: StoredPanelLayout = {
      v: LAYOUT_VERSION,
      desktop: {
        mode: toPersistableMode(layout.desktop.mode),
        ...(isFinitePositive(layout.desktop.width) ? { width: layout.desktop.width } : {}),
        ...(isFinitePositive(layout.desktop.height) ? { height: layout.desktop.height } : {}),
      },
      mobile: {
        mode: toPersistableMode(layout.mobile.mode),
      },
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(safe));
  } catch {
    /* ignore quota / private mode */
  }
}

export function resolveDesktopSize(
  mode: PersistableMode,
  stored: StoredPanelLayout['desktop'],
  viewport: ViewportMetrics,
): { width: number; height: number } {
  if (mode === 'expanded') {
    const expanded = defaultExpandedSize(viewport);
    if (isFinitePositive(stored.width) || isFinitePositive(stored.height)) {
      const custom = clampDesktopSize(
        stored.width ?? expanded.width,
        stored.height ?? expanded.height,
        viewport,
      );
      // Prefer expanded floor for width when restoring a custom size into expanded.
      return {
        width: clamp(
          Math.max(custom.width, DESKTOP_EXPANDED_WIDTH_MIN),
          DESKTOP_RESIZE_MIN_WIDTH,
          Math.min(DESKTOP_EXPANDED_WIDTH_MAX, maxDesktopWidth(viewport.width)),
        ),
        height: Math.max(custom.height, expanded.height * 0.85),
      };
    }
    return expanded;
  }

  const compact = defaultCompactSize(viewport);
  if (isFinitePositive(stored.width) || isFinitePositive(stored.height)) {
    return clampDesktopSize(stored.width ?? compact.width, stored.height ?? compact.height, viewport);
  }
  return compact;
}
