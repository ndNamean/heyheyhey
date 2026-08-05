/**
 * Client adapter for Store Chat translation.
 * Provider secrets stay on the server; this module never hardcodes API keys.
 *
 * Feature flag: translation is off unless VITE_STORE_CHAT_TRANSLATION is
 * explicitly enabled. Even then, the server returns `unsupported` when
 * TRANSLATION_PROVIDER / TRANSLATION_API_KEY are missing.
 *
 * UI wiring leftovers (do not edit StoreChatPanel here — merge later):
 * - Gate the Translate action with `isStoreChatTranslationEnabled()` and
 *   optionally `probeStoreChatTranslationCapability()`.
 * - Target language: `resolveTranslationTargetLang(useLang().lang)`.
 * - Per-viewer message state: `createIdleTranslationState` +
 *   `runStoreChatTranslation` / `translationStateFromResult`.
 * - Show original: `toggleShowingOriginal` + `translationDisplayText`.
 * - Retry after failed: `markTranslationRetry` then call translate again
 *   (status cycle: failed → retry → loading → success|failed|unsupported).
 * - Hide Translate when status would be `unsupported` from the flag/probe.
 */

import type { LangCode } from '../i18n';

/** Keep in sync with src/i18n LangCode / api/_lib/translation/provider.js */
export const STORE_CHAT_TRANSLATION_LANG_CODES: readonly LangCode[] = [
  'en',
  'vi',
  'fr',
  'zh',
  'es',
  'ar',
  'pt',
  'ru',
  'ja',
  'de',
  'hi',
  'id',
] as const;

/** Provider BCP-47 targets mirrored from the server map. */
export const LANG_CODE_TO_TRANSLATION_TARGET: Record<LangCode, string> = {
  en: 'en',
  vi: 'vi',
  fr: 'fr',
  zh: 'zh-CN',
  es: 'es',
  ar: 'ar',
  pt: 'pt',
  ru: 'ru',
  ja: 'ja',
  de: 'de',
  hi: 'hi',
  id: 'id',
};

export type StoreChatTranslationStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'unsupported'
  | 'failed'
  | 'retry'
  | 'already-same-language'
  | 'empty';

export interface StoreChatTranslationState {
  status: StoreChatTranslationStatus;
  originalText: string;
  translatedText: string | null;
  targetLang: LangCode | null;
  sourceLang: LangCode | 'auto' | null;
  errorMessage: string | null;
  showingOriginal: boolean;
}

export interface TranslateStoreChatParams {
  text: string;
  targetLang: LangCode;
  /** When known (e.g. sender locale); omit / 'auto' for detection. */
  sourceLang?: LangCode | 'auto' | null;
  /**
   * Override feature flag (tests / capability probe).
   * When omitted, uses `isStoreChatTranslationEnabled()`.
   */
  enabled?: boolean;
  signal?: AbortSignal;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override endpoint path for tests. */
  endpoint?: string;
}

export type TranslateStoreChatResult =
  | { status: 'empty' }
  | { status: 'already-same-language'; text: string; lang: LangCode }
  | { status: 'unsupported'; message: string }
  | {
      status: 'success';
      translatedText: string;
      targetLang: LangCode;
      sourceLang: string | null;
    }
  | { status: 'failed'; message: string; canRetry: true };

const DEFAULT_ENDPOINT = '/api/translate-store-chat';

export function createIdleTranslationState(): StoreChatTranslationState {
  return {
    status: 'idle',
    originalText: '',
    translatedText: null,
    targetLang: null,
    sourceLang: null,
    errorMessage: null,
    showingOriginal: false,
  };
}

/**
 * Client feature flag. Off by default when unset so unconfigured
 * environments never surface Translate in the UI.
 */
export function isStoreChatTranslationEnabled(
  env: { VITE_STORE_CHAT_TRANSLATION?: unknown } = import.meta.env,
): boolean {
  const raw = String(env.VITE_STORE_CHAT_TRANSLATION ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

export function isStoreChatTranslationLang(code: string): code is LangCode {
  return (STORE_CHAT_TRANSLATION_LANG_CODES as readonly string[]).includes(code);
}

/** Map app language selection → provider target tag. */
export function mapLangCodeToTranslationTarget(lang: LangCode): string {
  return LANG_CODE_TO_TRANSLATION_TARGET[lang];
}

/**
 * Resolve target language from the existing app language system (`useLang().lang`).
 */
export function resolveTranslationTargetLang(lang: LangCode): LangCode {
  return isStoreChatTranslationLang(lang) ? lang : 'en';
}

/**
 * Pure preflight before any network call.
 */
export function evaluateTranslationRequest(params: {
  text: string;
  targetLang: LangCode;
  sourceLang?: LangCode | 'auto' | null;
  enabled?: boolean;
}):
  | { status: 'empty' }
  | { status: 'already-same-language'; text: string; lang: LangCode }
  | { status: 'unsupported'; message: string }
  | {
      status: 'ready';
      text: string;
      targetLang: LangCode;
      sourceLang: LangCode | 'auto' | null;
      providerTarget: string;
    } {
  if (params.enabled === false || (params.enabled === undefined && !isStoreChatTranslationEnabled())) {
    return {
      status: 'unsupported',
      message: 'Translation is not enabled',
    };
  }

  const text = String(params.text ?? '').trim();
  if (!text) return { status: 'empty' };

  const targetLang = resolveTranslationTargetLang(params.targetLang);
  const source =
    params.sourceLang == null || params.sourceLang === ''
      ? null
      : params.sourceLang;

  if (source && source !== 'auto' && source === targetLang) {
    return {
      status: 'already-same-language',
      text,
      lang: targetLang,
    };
  }

  return {
    status: 'ready',
    text,
    targetLang,
    sourceLang: source,
    providerTarget: mapLangCodeToTranslationTarget(targetLang),
  };
}

export function translationStateFromResult(
  originalText: string,
  targetLang: LangCode,
  sourceLang: LangCode | 'auto' | null,
  result: TranslateStoreChatResult,
): StoreChatTranslationState {
  switch (result.status) {
    case 'empty':
      return {
        ...createIdleTranslationState(),
        status: 'empty',
        originalText,
        targetLang,
        sourceLang,
      };
    case 'already-same-language':
      return {
        status: 'already-same-language',
        originalText: result.text,
        translatedText: null,
        targetLang: result.lang,
        sourceLang,
        errorMessage: null,
        showingOriginal: true,
      };
    case 'unsupported':
      return {
        status: 'unsupported',
        originalText,
        translatedText: null,
        targetLang,
        sourceLang,
        errorMessage: result.message,
        showingOriginal: true,
      };
    case 'success':
      return {
        status: 'success',
        originalText,
        translatedText: result.translatedText,
        targetLang: result.targetLang,
        sourceLang,
        errorMessage: null,
        showingOriginal: false,
      };
    case 'failed':
      return {
        status: 'failed',
        originalText,
        translatedText: null,
        targetLang,
        sourceLang,
        errorMessage: result.message,
        showingOriginal: true,
      };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

/** Move a failed translation into the explicit retry status (UI affordance). */
export function markTranslationRetry(
  state: StoreChatTranslationState,
): StoreChatTranslationState {
  if (state.status !== 'failed' && state.status !== 'retry') return state;
  return {
    ...state,
    status: 'retry',
  };
}

export function toggleShowingOriginal(
  state: StoreChatTranslationState,
): StoreChatTranslationState {
  if (state.status !== 'success' || !state.translatedText) return state;
  return {
    ...state,
    showingOriginal: !state.showingOriginal,
  };
}

export function translationDisplayText(state: StoreChatTranslationState): string {
  if (state.status === 'success' && state.translatedText && !state.showingOriginal) {
    return state.translatedText;
  }
  return state.originalText;
}

type ApiPayload = {
  ok?: boolean;
  status?: string;
  error?: string;
  translatedText?: string;
  targetLang?: string;
  sourceLang?: string | null;
  text?: string;
  configured?: boolean;
};

async function readJson(resp: Response): Promise<ApiPayload> {
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ApiPayload;
  } catch {
    return {};
  }
}

/**
 * Probe whether the server has a translation provider configured.
 * Safe to call when the client flag is on; returns unsupported on errors.
 */
export async function probeStoreChatTranslationCapability(options?: {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  signal?: AbortSignal;
  /** Override feature flag (tests). */
  enabled?: boolean;
}): Promise<{ configured: boolean; status: 'ready' | 'unsupported' }> {
  const enabled =
    options?.enabled !== undefined
      ? options.enabled
      : isStoreChatTranslationEnabled();
  if (!enabled) {
    return { configured: false, status: 'unsupported' };
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  const endpoint = options?.endpoint ?? DEFAULT_ENDPOINT;
  try {
    const resp = await fetchImpl(endpoint, { method: 'GET', signal: options?.signal });
    const data = await readJson(resp);
    if (data.configured === true || data.status === 'ready') {
      return { configured: true, status: 'ready' };
    }
    return { configured: false, status: 'unsupported' };
  } catch {
    return { configured: false, status: 'unsupported' };
  }
}

/**
 * Request a translation for a Store Chat message body.
 * Never invents translated text on the client.
 */
export async function translateStoreChatMessage(
  params: TranslateStoreChatParams,
): Promise<TranslateStoreChatResult> {
  const preflight = evaluateTranslationRequest({
    text: params.text,
    targetLang: params.targetLang,
    sourceLang: params.sourceLang,
    enabled: params.enabled,
  });

  if (preflight.status === 'empty') return { status: 'empty' };
  if (preflight.status === 'already-same-language') {
    return {
      status: 'already-same-language',
      text: preflight.text,
      lang: preflight.lang,
    };
  }
  if (preflight.status === 'unsupported') {
    return { status: 'unsupported', message: preflight.message };
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const endpoint = params.endpoint ?? DEFAULT_ENDPOINT;

  try {
    const resp = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: params.signal,
      body: JSON.stringify({
        text: preflight.text,
        targetLang: preflight.targetLang,
        sourceLang: preflight.sourceLang ?? 'auto',
      }),
    });
    const data = await readJson(resp);

    if (data.status === 'empty') return { status: 'empty' };
    if (data.status === 'already-same-language') {
      return {
        status: 'already-same-language',
        text: typeof data.text === 'string' ? data.text : preflight.text,
        lang: preflight.targetLang,
      };
    }
    if (data.status === 'unsupported' || resp.status === 503) {
      return {
        status: 'unsupported',
        message:
          typeof data.error === 'string'
            ? data.error
            : 'Translation provider not configured',
      };
    }
    if (data.ok && data.status === 'success' && typeof data.translatedText === 'string') {
      return {
        status: 'success',
        translatedText: data.translatedText,
        targetLang: preflight.targetLang,
        sourceLang:
          typeof data.sourceLang === 'string' ? data.sourceLang : preflight.sourceLang,
      };
    }

    return {
      status: 'failed',
      message:
        typeof data.error === 'string'
          ? data.error
          : `Translation failed (${resp.status})`,
      canRetry: true,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { status: 'failed', message: 'Translation cancelled', canRetry: true };
    }
    return {
      status: 'failed',
      message: e instanceof Error ? e.message : 'Translation failed',
      canRetry: true,
    };
  }
}

/**
 * Convenience helper for UI: set loading, call API, map to state.
 * Caller owns React state; this stays framework-free.
 */
export async function runStoreChatTranslation(
  params: TranslateStoreChatParams,
  onState: (state: StoreChatTranslationState) => void,
): Promise<StoreChatTranslationState> {
  const targetLang = resolveTranslationTargetLang(params.targetLang);
  const sourceLang = params.sourceLang ?? null;
  const originalText = String(params.text ?? '');

  onState({
    status: 'loading',
    originalText,
    translatedText: null,
    targetLang,
    sourceLang,
    errorMessage: null,
    showingOriginal: false,
  });

  const result = await translateStoreChatMessage(params);
  const next = translationStateFromResult(originalText, targetLang, sourceLang, result);
  onState(next);
  return next;
}
