import { describe, expect, it, vi } from 'vitest';
import {
  isTranslationProviderConfigured,
  mapLangCodeToProviderTarget,
  translateText,
  validateTranslationRequest,
  APP_LANG_CODES,
} from '../../api/_lib/translation/provider.js';
import {
  createIdleTranslationState,
  evaluateTranslationRequest,
  isStoreChatTranslationEnabled,
  mapLangCodeToTranslationTarget,
  markTranslationRetry,
  probeStoreChatTranslationCapability,
  resolveTranslationTargetLang,
  runStoreChatTranslation,
  STORE_CHAT_TRANSLATION_LANG_CODES,
  toggleShowingOriginal,
  translationDisplayText,
  translationStateFromResult,
  translateStoreChatMessage,
} from './storeChatTranslation';

describe('translation provider (server scaffold)', () => {
  it('maps every app LangCode to a provider target', () => {
    expect(APP_LANG_CODES).toEqual([...STORE_CHAT_TRANSLATION_LANG_CODES]);
    for (const code of APP_LANG_CODES) {
      expect(mapLangCodeToProviderTarget(code)).toBeTruthy();
      expect(mapLangCodeToTranslationTarget(code as 'en')).toBe(
        mapLangCodeToProviderTarget(code),
      );
    }
  });

  it('is unconfigured when provider or key missing', () => {
    expect(isTranslationProviderConfigured({})).toBe(false);
    expect(isTranslationProviderConfigured({ TRANSLATION_PROVIDER: 'deepl' })).toBe(
      false,
    );
    expect(
      isTranslationProviderConfigured({
        TRANSLATION_PROVIDER: 'none',
        TRANSLATION_API_KEY: 'secret',
      }),
    ).toBe(false);
    expect(
      isTranslationProviderConfigured({
        TRANSLATION_PROVIDER: 'deepl',
        TRANSLATION_API_KEY: 'secret',
      }),
    ).toBe(true);
    // mymemory is keyless
    expect(
      isTranslationProviderConfigured({ TRANSLATION_PROVIDER: 'mymemory' }),
    ).toBe(true);
  });

  it('validateTranslationRequest covers empty / same-language / bad target', () => {
    expect(validateTranslationRequest({ text: '  ', targetLang: 'en' })).toMatchObject({
      ok: false,
      status: 'empty',
    });
    expect(
      validateTranslationRequest({
        text: 'Hello',
        sourceLang: 'vi',
        targetLang: 'vi',
      }),
    ).toMatchObject({ ok: false, status: 'already-same-language' });
    expect(
      validateTranslationRequest({ text: 'Hello', targetLang: 'xx' }),
    ).toMatchObject({ ok: false, status: 'unsupported' });
    expect(
      validateTranslationRequest({ text: 'Hello', targetLang: 'fr', sourceLang: 'auto' }),
    ).toMatchObject({ ok: true, targetLang: 'fr', providerTarget: 'fr' });
  });

  it('never invents translations when provider is missing or unimplemented', async () => {
    const missing = await translateText(
      { text: 'Hello', targetLang: 'vi' },
      {},
    );
    expect(missing).toMatchObject({ ok: false, status: 'unsupported' });
    expect(missing).not.toHaveProperty('translatedText');

    const scaffold = await translateText(
      { text: 'Hello', targetLang: 'vi' },
      { TRANSLATION_PROVIDER: 'deepl', TRANSLATION_API_KEY: 'x' },
    );
    expect(scaffold).toMatchObject({ ok: false, status: 'unsupported' });
    expect(JSON.stringify(scaffold)).not.toMatch(/Hello/);
  });

  it('translates via mymemory when the upstream response is valid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        responseStatus: 200,
        responseData: { translatedText: 'Xin chào' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await translateText(
      { text: 'Hello', targetLang: 'vi' },
      { TRANSLATION_PROVIDER: 'mymemory' },
    );
    expect(result).toMatchObject({
      ok: true,
      translatedText: 'Xin chào',
      provider: 'mymemory',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(calledUrl).toContain('api.mymemory.translated.net');
    expect(calledUrl).toContain('langpair=Autodetect%7Cvi');

    vi.unstubAllGlobals();
  });
});

describe('storeChatTranslation client adapter', () => {
  it('feature-flags off when Vite env is unset', () => {
    expect(isStoreChatTranslationEnabled({})).toBe(false);
    expect(isStoreChatTranslationEnabled({ VITE_STORE_CHAT_TRANSLATION: '0' })).toBe(
      false,
    );
    expect(isStoreChatTranslationEnabled({ VITE_STORE_CHAT_TRANSLATION: '1' })).toBe(
      true,
    );
    expect(isStoreChatTranslationEnabled({ VITE_STORE_CHAT_TRANSLATION: 'true' })).toBe(
      true,
    );
  });

  it('resolves target language from LangCode list', () => {
    expect(resolveTranslationTargetLang('ja')).toBe('ja');
    expect(mapLangCodeToTranslationTarget('zh')).toBe('zh-CN');
  });

  it('evaluateTranslationRequest returns empty / same-language / unsupported / ready', () => {
    expect(
      evaluateTranslationRequest({
        text: '',
        targetLang: 'en',
        enabled: true,
      }),
    ).toEqual({ status: 'empty' });

    expect(
      evaluateTranslationRequest({
        text: 'xin chào',
        targetLang: 'vi',
        sourceLang: 'vi',
        enabled: true,
      }),
    ).toEqual({
      status: 'already-same-language',
      text: 'xin chào',
      lang: 'vi',
    });

    expect(
      evaluateTranslationRequest({
        text: 'Hello',
        targetLang: 'vi',
        enabled: false,
      }),
    ).toMatchObject({ status: 'unsupported' });

    expect(
      evaluateTranslationRequest({
        text: 'Hello',
        targetLang: 'vi',
        sourceLang: 'en',
        enabled: true,
      }),
    ).toMatchObject({
      status: 'ready',
      providerTarget: 'vi',
      targetLang: 'vi',
    });
  });

  it('maps API success / unsupported / failed and supports retry state', async () => {
    const okFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          status: 'success',
          translatedText: 'Xin chào',
          targetLang: 'vi',
          sourceLang: 'en',
        }),
        { status: 200 },
      ),
    );
    const success = await translateStoreChatMessage({
      text: 'Hello',
      targetLang: 'vi',
      sourceLang: 'en',
      enabled: true,
      fetchImpl: okFetch as unknown as typeof fetch,
    });
    expect(success).toEqual({
      status: 'success',
      translatedText: 'Xin chào',
      targetLang: 'vi',
      sourceLang: 'en',
    });

    const unsupported = await translateStoreChatMessage({
      text: 'Hello',
      targetLang: 'vi',
      enabled: true,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            ok: false,
            status: 'unsupported',
            error: 'Translation provider not configured',
          }),
          { status: 503 },
        )) as unknown as typeof fetch,
    });
    expect(unsupported).toMatchObject({ status: 'unsupported' });

    const failed = await translateStoreChatMessage({
      text: 'Hello',
      targetLang: 'vi',
      enabled: true,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error: 'upstream down' }), {
          status: 502,
        })) as unknown as typeof fetch,
    });
    expect(failed).toEqual({
      status: 'failed',
      message: 'upstream down',
      canRetry: true,
    });

    const failedState = translationStateFromResult('Hello', 'vi', 'en', failed);
    expect(failedState.status).toBe('failed');
    const retryState = markTranslationRetry(failedState);
    expect(retryState.status).toBe('retry');
  });

  it('skips network for empty and already-same-language', async () => {
    const fetchImpl = vi.fn();
    expect(
      await translateStoreChatMessage({
        text: '   ',
        targetLang: 'en',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toEqual({ status: 'empty' });

    expect(
      await translateStoreChatMessage({
        text: 'hola',
        targetLang: 'es',
        sourceLang: 'es',
        enabled: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toEqual({
      status: 'already-same-language',
      text: 'hola',
      lang: 'es',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('runStoreChatTranslation emits loading then terminal state', async () => {
    const states: string[] = [];
    await runStoreChatTranslation(
      {
        text: 'Hello',
        targetLang: 'fr',
        enabled: true,
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              ok: true,
              status: 'success',
              translatedText: 'Bonjour',
              targetLang: 'fr',
            }),
            { status: 200 },
          )) as unknown as typeof fetch,
      },
      (s) => states.push(s.status),
    );
    expect(states).toEqual(['loading', 'success']);
  });

  it('toggle show-original and display text', () => {
    const success = translationStateFromResult('Hello', 'vi', 'en', {
      status: 'success',
      translatedText: 'Xin chào',
      targetLang: 'vi',
      sourceLang: 'en',
    });
    expect(translationDisplayText(success)).toBe('Xin chào');
    const toggled = toggleShowingOriginal(success);
    expect(toggled.showingOriginal).toBe(true);
    expect(translationDisplayText(toggled)).toBe('Hello');
    expect(createIdleTranslationState().status).toBe('idle');
  });

  it('probe capability respects flag and server configured bit', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, configured: true, status: 'ready' }), {
        status: 200,
      }),
    );

    const off = await probeStoreChatTranslationCapability({
      enabled: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(off).toEqual({ configured: false, status: 'unsupported' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const on = await probeStoreChatTranslationCapability({
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(on).toEqual({ configured: true, status: 'ready' });
    expect(fetchImpl).toHaveBeenCalledOnce();

    const unconfiguredFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, configured: false, status: 'unsupported' }),
        { status: 200 },
      ),
    );
    expect(
      await probeStoreChatTranslationCapability({
        enabled: true,
        fetchImpl: unconfiguredFetch as unknown as typeof fetch,
      }),
    ).toEqual({ configured: false, status: 'unsupported' });
  });
});
