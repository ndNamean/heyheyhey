/**
 * GIPHY client for Store Chat media picker (Phase 4).
 * Uses VITE_GIPHY_API_KEY (public beta key — GIPHY requires client-side search).
 *
 * Attribution: every surface that shows GIPHY results must display
 * {@link GIPHY_POWERED_BY_MARK} / {@link GIPHY_ATTRIBUTION_URL} conspicuously.
 *
 * StoreChatPanel gates the media button with `isGiphyConfigured()`, stages
 * selection via GiphyPicker → GiphyMediaPreview, and sends through
 * `buildStoreChatMediaPayload`.
 */

export type GiphyRating = 'g' | 'pg' | 'pg-13' | 'r';

/** Picker tabs — Memes uses GIF search with preset queries. */
export type GiphyPickerTab = 'gifs' | 'stickers' | 'memes' | 'emoji';

/** Normalized kind stored on messages / selection. */
export type GiphyMediaKind = 'gif' | 'sticker' | 'meme' | 'emoji';

export type GiphyContentRating = GiphyRating;

export const GIPHY_DEFAULT_RATING: GiphyRating = 'pg';
export const GIPHY_DEFAULT_LIMIT = 24;
export const GIPHY_SEARCH_DEBOUNCE_MS = 300;

/** Official attribution — required wherever the API is utilized. */
export const GIPHY_POWERED_BY_MARK = 'Powered by GIPHY';
export const GIPHY_ATTRIBUTION_URL = 'https://giphy.com/';
/** Official mark asset (dark-friendly). */
export const GIPHY_POWERED_BY_LOGO_DARK =
  'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif';

export const GIPHY_MEME_PRESETS = [
  'meme',
  'reaction meme',
  'funny meme',
  'office meme',
  'cat meme',
  'dog meme',
] as const;

export interface GiphyMediaItem {
  id: string;
  kind: GiphyMediaKind;
  title: string;
  width: number;
  height: number;
  /** Preferred display / send rendition (fixed_height or downsized). */
  url: string;
  /** Lightweight grid preview. */
  previewUrl: string;
  username: string;
  /** Deep link to GIPHY page when available. */
  itemUrl: string;
}

export interface GiphySearchParams {
  tab: GiphyPickerTab;
  query?: string;
  /** Memes tab: which preset when query is empty. */
  memePreset?: string;
  limit?: number;
  offset?: number;
  rating?: GiphyRating;
  signal?: AbortSignal;
}

export interface GiphySearchResult {
  items: GiphyMediaItem[];
  totalCount: number;
  offset: number;
  count: number;
}

export class GiphyClientError extends Error {
  readonly status: number | null;
  readonly code: 'missing_key' | 'http' | 'parse' | 'aborted' | 'unknown';

  constructor(
    message: string,
    opts: { status?: number | null; code?: GiphyClientError['code']; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'GiphyClientError';
    this.status = opts.status ?? null;
    this.code = opts.code ?? 'unknown';
  }
}

type RawImage = {
  url?: string;
  width?: string;
  height?: string;
};

type RawGif = {
  id?: string;
  title?: string;
  url?: string;
  username?: string;
  images?: {
    fixed_height?: RawImage;
    fixed_height_small?: RawImage;
    downsized?: RawImage;
    downsized_small?: RawImage;
    preview_gif?: RawImage;
    original?: RawImage;
  };
};

function readApiKey(): string {
  const key = String(import.meta.env.VITE_GIPHY_API_KEY ?? '').trim();
  return key;
}

/** Feature gate — picker / media button should hide when unset. */
export function isGiphyConfigured(): boolean {
  return readApiKey().length > 0;
}

export function getGiphyApiKey(): string | null {
  const key = readApiKey();
  return key || null;
}

export function tabToMediaKind(tab: GiphyPickerTab): GiphyMediaKind {
  switch (tab) {
    case 'stickers':
      return 'sticker';
    case 'memes':
      return 'meme';
    case 'emoji':
      return 'emoji';
    default:
      return 'gif';
  }
}

function parseDim(raw: string | undefined, fallback = 0): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function normalizeGiphyItem(raw: RawGif, kind: GiphyMediaKind): GiphyMediaItem | null {
  const id = String(raw.id ?? '').trim();
  if (!id) return null;
  const images = raw.images ?? {};
  const primary =
    images.fixed_height ?? images.downsized ?? images.original ?? images.fixed_height_small;
  const preview =
    images.fixed_height_small ??
    images.preview_gif ??
    images.downsized_small ??
    primary;
  const url = String(primary?.url ?? '').trim();
  if (!url) return null;
  const previewUrl = String(preview?.url ?? url).trim() || url;
  return {
    id,
    kind,
    title: String(raw.title ?? '').trim() || 'GIPHY',
    width: parseDim(primary?.width, 200),
    height: parseDim(primary?.height, 200),
    url,
    previewUrl,
    username: String(raw.username ?? '').trim(),
    itemUrl: String(raw.url ?? '').trim() || `${GIPHY_ATTRIBUTION_URL}gifs/${id}`,
  };
}

function buildSearchUrl(path: string, params: Record<string, string | number | undefined>): string {
  const key = getGiphyApiKey();
  if (!key) {
    throw new GiphyClientError('VITE_GIPHY_API_KEY is not configured', { code: 'missing_key' });
  }
  const qs = new URLSearchParams();
  qs.set('api_key', key);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    qs.set(k, String(v));
  }
  return `https://api.giphy.com${path}?${qs.toString()}`;
}

async function fetchGiphyJson(
  url: string,
  signal?: AbortSignal,
): Promise<{ data: RawGif[]; pagination?: { total_count?: number; count?: number; offset?: number } }> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new GiphyClientError('Search aborted', { code: 'aborted', cause: err });
    }
    throw new GiphyClientError('Network error talking to GIPHY', { code: 'unknown', cause: err });
  }
  if (!res.ok) {
    throw new GiphyClientError(`GIPHY HTTP ${res.status}`, {
      status: res.status,
      code: 'http',
    });
  }
  try {
    return (await res.json()) as {
      data: RawGif[];
      pagination?: { total_count?: number; count?: number; offset?: number };
    };
  } catch (err) {
    throw new GiphyClientError('Invalid GIPHY response', { code: 'parse', cause: err });
  }
}

function resolveMemeQuery(query: string | undefined, memePreset: string | undefined): string {
  const q = (query ?? '').trim();
  if (q) return q;
  const preset = (memePreset ?? GIPHY_MEME_PRESETS[0]).trim();
  return preset || 'meme';
}

/**
 * Search / browse GIPHY for the active picker tab.
 * Empty GIF/sticker queries use trending; memes use presets; emoji uses /v2/emoji
 * (search falls back to sticker search when a query is present).
 */
export async function searchGiphy(params: GiphySearchParams): Promise<GiphySearchResult> {
  const rating = params.rating ?? GIPHY_DEFAULT_RATING;
  const limit = params.limit ?? GIPHY_DEFAULT_LIMIT;
  const offset = params.offset ?? 0;
  const kind = tabToMediaKind(params.tab);
  const q = (params.query ?? '').trim();

  let url: string;
  if (params.tab === 'emoji') {
    if (q) {
      url = buildSearchUrl('/v1/stickers/search', {
        q,
        limit,
        offset,
        rating,
        lang: 'en',
      });
    } else {
      url = buildSearchUrl('/v2/emoji', { limit, offset });
    }
  } else if (params.tab === 'memes') {
    url = buildSearchUrl('/v1/gifs/search', {
      q: resolveMemeQuery(params.query, params.memePreset),
      limit,
      offset,
      rating,
      lang: 'en',
    });
  } else if (params.tab === 'stickers') {
    url = q
      ? buildSearchUrl('/v1/stickers/search', { q, limit, offset, rating, lang: 'en' })
      : buildSearchUrl('/v1/stickers/trending', { limit, offset, rating });
  } else {
    url = q
      ? buildSearchUrl('/v1/gifs/search', { q, limit, offset, rating, lang: 'en' })
      : buildSearchUrl('/v1/gifs/trending', { limit, offset, rating });
  }

  const json = await fetchGiphyJson(url, params.signal);
  const rawList = Array.isArray(json.data) ? json.data : [];
  const items: GiphyMediaItem[] = [];
  for (const raw of rawList) {
    const item = normalizeGiphyItem(raw, kind);
    if (item) items.push(item);
  }
  const pagination = json.pagination ?? {};
  return {
    items,
    totalCount: Number(pagination.total_count ?? items.length) || items.length,
    offset: Number(pagination.offset ?? offset) || offset,
    count: Number(pagination.count ?? items.length) || items.length,
  };
}

export type DebouncedAsyncController<TArgs extends unknown[], TResult> = {
  /** Schedule a call; previous pending timers and in-flight fetches are cancelled. */
  schedule: (...args: TArgs) => Promise<TResult>;
  /** Cancel pending timer and abort in-flight request. */
  cancel: () => void;
  /** Whether a timer or fetch is outstanding. */
  isPending: () => boolean;
};

/**
 * Debounce + AbortController helper for search-as-you-type.
 * Each `schedule` cancels the previous timer and aborts the previous fetch.
 */
export function createDebouncedAsync<TArgs extends unknown[], TResult>(
  run: (signal: AbortSignal, ...args: TArgs) => Promise<TResult>,
  delayMs: number = GIPHY_SEARCH_DEBOUNCE_MS,
): DebouncedAsyncController<TArgs, TResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let rejectPending: ((err: GiphyClientError) => void) | null = null;

  const abortError = () => new GiphyClientError('Search aborted', { code: 'aborted' });

  const cancel = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (controller) {
      controller.abort();
      controller = null;
    }
    const reject = rejectPending;
    rejectPending = null;
    // Defer so same-tick callers can attach .catch / expect(...).rejects.
    if (reject) {
      queueMicrotask(() => reject(abortError()));
    }
  };

  const schedule = (...args: TArgs): Promise<TResult> => {
    cancel();
    return new Promise<TResult>((resolve, reject) => {
      let settled = false;
      const safeResolve = (value: TResult) => {
        if (settled) return;
        settled = true;
        if (rejectPending === reject) rejectPending = null;
        resolve(value);
      };
      const safeReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        if (rejectPending === reject) rejectPending = null;
        reject(err);
      };

      rejectPending = (err) => safeReject(err);
      timer = setTimeout(() => {
        timer = null;
        controller = new AbortController();
        const signal = controller.signal;
        void run(signal, ...args)
          .then((result) => {
            if (signal.aborted) {
              safeReject(abortError());
              return;
            }
            safeResolve(result);
          })
          .catch((err) => {
            if (signal.aborted || (err instanceof GiphyClientError && err.code === 'aborted')) {
              safeReject(
                err instanceof GiphyClientError
                  ? err
                  : new GiphyClientError('Search aborted', { code: 'aborted', cause: err }),
              );
              return;
            }
            safeReject(err);
          })
          .finally(() => {
            if (controller?.signal === signal) controller = null;
          });
      }, Math.max(0, delayMs));
    });
  };

  return {
    schedule,
    cancel,
    isPending: () => timer != null || controller != null || rejectPending != null,
  };
}

/** Convenience: debounced `searchGiphy` bound to current params factory. */
export function createDebouncedGiphySearch(
  delayMs: number = GIPHY_SEARCH_DEBOUNCE_MS,
): DebouncedAsyncController<[Omit<GiphySearchParams, 'signal'>], GiphySearchResult> {
  return createDebouncedAsync(
    (signal, params) => searchGiphy({ ...params, signal }),
    delayMs,
  );
}

/** Single in-flight search with explicit cancel (no debounce). */
export function createCancellableSearch(): {
  search: (params: Omit<GiphySearchParams, 'signal'>) => Promise<GiphySearchResult>;
  cancel: () => void;
} {
  let controller: AbortController | null = null;
  return {
    cancel: () => {
      controller?.abort();
      controller = null;
    },
    search: (params) => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      return searchGiphy({ ...params, signal }).finally(() => {
        if (controller?.signal === signal) controller = null;
      });
    },
  };
}
