/**
 * Provider-neutral translation interface for Store Chat.
 * Secrets stay server-side (TRANSLATION_API_KEY). Never invent translations.
 *
 * Env:
 *   TRANSLATION_PROVIDER — provider id (e.g. "mymemory", "deepl", "google"); empty/none = disabled
 *   TRANSLATION_API_KEY  — provider API key when required; optional for mymemory (email for higher quota)
 */

/** Providers that can run without TRANSLATION_API_KEY. */
const KEYLESS_PROVIDERS = new Set(['mymemory']);

/** App LangCode values mirrored from src/i18n (keep in sync). */
export const APP_LANG_CODES = Object.freeze([
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
]);

/** Map app LangCode → common provider BCP-47 target. */
export const LANG_CODE_TO_PROVIDER_TARGET = Object.freeze({
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
});

const MAX_TEXT_CHARS = 5000;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isTranslationProviderConfigured(env = process.env) {
  const provider = String(env.TRANSLATION_PROVIDER ?? '')
    .trim()
    .toLowerCase();
  if (!provider || provider === 'none' || provider === 'off') return false;
  if (KEYLESS_PROVIDERS.has(provider)) return true;
  const apiKey = String(env.TRANSLATION_API_KEY ?? '').trim();
  return Boolean(apiKey);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function getTranslationProviderId(env = process.env) {
  if (!isTranslationProviderConfigured(env)) return null;
  return String(env.TRANSLATION_PROVIDER ?? '')
    .trim()
    .toLowerCase();
}

/**
 * @param {string} lang
 * @returns {boolean}
 */
export function isSupportedAppLangCode(lang) {
  return APP_LANG_CODES.includes(String(lang || '').trim());
}

/**
 * @param {string} langCode
 * @returns {string | null}
 */
export function mapLangCodeToProviderTarget(langCode) {
  const code = String(langCode || '').trim();
  if (!isSupportedAppLangCode(code)) return null;
  return LANG_CODE_TO_PROVIDER_TARGET[code] ?? code;
}

/**
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeTranslationText(text) {
  return String(text ?? '').trim();
}

/**
 * Pre-flight checks shared by endpoint + future providers.
 * Does not call any upstream API and never fabricates translated text.
 *
 * @param {{ text?: unknown, sourceLang?: unknown, targetLang?: unknown }} input
 * @returns {{
 *   ok: true,
 *   text: string,
 *   sourceLang: string | null,
 *   targetLang: string,
 *   providerTarget: string,
 * } | {
 *   ok: false,
 *   status: 'empty' | 'already-same-language' | 'unsupported' | 'failed',
 *   error: string,
 *   targetLang?: string,
 * }}
 */
export function validateTranslationRequest(input) {
  const text = normalizeTranslationText(input?.text);
  if (!text) {
    return { ok: false, status: 'empty', error: 'No text to translate' };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return {
      ok: false,
      status: 'failed',
      error: `Text exceeds ${MAX_TEXT_CHARS} character limit`,
    };
  }

  const targetLang = String(input?.targetLang ?? '').trim();
  if (!isSupportedAppLangCode(targetLang)) {
    return {
      ok: false,
      status: 'unsupported',
      error: 'Unsupported target language',
      targetLang,
    };
  }

  const providerTarget = mapLangCodeToProviderTarget(targetLang);
  if (!providerTarget) {
    return {
      ok: false,
      status: 'unsupported',
      error: 'Unsupported target language',
      targetLang,
    };
  }

  const rawSource = input?.sourceLang;
  const sourceLang =
    rawSource == null || String(rawSource).trim() === '' || String(rawSource).trim() === 'auto'
      ? null
      : String(rawSource).trim();

  if (sourceLang && isSupportedAppLangCode(sourceLang) && sourceLang === targetLang) {
    return {
      ok: false,
      status: 'already-same-language',
      error: 'Source and target language are the same',
      targetLang,
    };
  }

  return {
    ok: true,
    text,
    sourceLang,
    targetLang,
    providerTarget,
  };
}

/**
 * MyMemory free translation API (https://mymemory.translated.net).
 * Optional TRANSLATION_API_KEY is treated as contact email for higher quota.
 *
 * @param {{
 *   text: string,
 *   sourceLang: string | null,
 *   providerTarget: string,
 * }} request
 * @param {NodeJS.ProcessEnv} [env]
 */
async function translateWithMyMemory(request, env = process.env) {
  const source =
    request.sourceLang && isSupportedAppLangCode(request.sourceLang)
      ? mapLangCodeToProviderTarget(request.sourceLang)
      : 'Autodetect';
  const langpair = `${source}|${request.providerTarget}`;
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', request.text);
  url.searchParams.set('langpair', langpair);
  const email = String(env.TRANSLATION_API_KEY ?? '').trim();
  if (email.includes('@')) {
    url.searchParams.set('de', email);
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Translation network error',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 'failed',
      error: `Translation provider HTTP ${response.status}`,
    };
  }

  /** @type {any} */
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 'failed', error: 'Invalid translation response' };
  }

  const translated = String(payload?.responseData?.translatedText ?? '').trim();
  const statusCode = Number(payload?.responseStatus ?? 0);
  if (!translated || (statusCode && statusCode !== 200)) {
    const detail = String(payload?.responseDetails ?? payload?.quotaFinished ?? '').trim();
    return {
      ok: false,
      status: 'failed',
      error: detail || 'Translation provider returned no text',
    };
  }

  // MyMemory echoes source text with a warning prefix when it cannot translate.
  if (/^MYMEMORY WARNING:/i.test(translated)) {
    return {
      ok: false,
      status: 'failed',
      error: translated,
    };
  }

  return {
    ok: true,
    translatedText: translated,
    detectedSourceLang: request.sourceLang,
    provider: 'mymemory',
  };
}

/**
 * Provider registry. Never return fabricated/mock translated strings.
 *
 * @param {{
 *   text: string,
 *   sourceLang: string | null,
 *   targetLang: string,
 *   providerTarget: string,
 * }} request
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{
 *   ok: true,
 *   translatedText: string,
 *   detectedSourceLang?: string | null,
 *   provider: string,
 * } | {
 *   ok: false,
 *   status: 'unsupported' | 'failed',
 *   error: string,
 * }>}
 */
export async function translateWithProvider(request, env = process.env) {
  if (!isTranslationProviderConfigured(env)) {
    return {
      ok: false,
      status: 'unsupported',
      error: 'Translation provider not configured',
    };
  }

  const providerId = getTranslationProviderId(env);
  const known = new Set(['mymemory', 'deepl', 'google', 'azure', 'openai']);
  if (!providerId || !known.has(providerId)) {
    return {
      ok: false,
      status: 'unsupported',
      error: providerId
        ? `Translation provider "${providerId}" is not implemented`
        : 'Translation provider not configured',
    };
  }

  if (providerId === 'mymemory') {
    return translateWithMyMemory(request, env);
  }

  // Reserved paid adapters — not shipped yet.
  return {
    ok: false,
    status: 'unsupported',
    error: `Translation provider "${providerId}" adapter is not implemented yet`,
  };
}

/**
 * Full translate pipeline: validate → provider.
 *
 * @param {{ text?: unknown, sourceLang?: unknown, targetLang?: unknown }} input
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function translateText(input, env = process.env) {
  const validated = validateTranslationRequest(input);
  if (!validated.ok) return validated;
  return translateWithProvider(validated, env);
}

export const TRANSLATION_MAX_TEXT_CHARS = MAX_TEXT_CHARS;
