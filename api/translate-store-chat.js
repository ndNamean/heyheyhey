/**
 * Vercel Serverless — Store Chat message translation (provider-neutral).
 * API key from TRANSLATION_API_KEY env only — never exposed to client.
 *
 * POST JSON: { text, targetLang, sourceLang? }
 * Responses use a stable `status` field for client state mapping.
 */

import {
  isTranslationProviderConfigured,
  translateText,
  validateTranslationRequest,
} from './_lib/translation/provider.js';

function json(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Capability probe for UI feature-flagging (no secrets leaked).
    const configured = isTranslationProviderConfigured();
    return json(res, 200, {
      ok: true,
      configured,
      status: configured ? 'ready' : 'unsupported',
    });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, status: 'failed', error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string'
    ? (() => {
        try {
          return JSON.parse(req.body);
        } catch {
          return null;
        }
      })()
    : req.body;

  if (!body || typeof body !== 'object') {
    return json(res, 400, {
      ok: false,
      status: 'failed',
      error: 'Invalid JSON body',
    });
  }

  // Fast path for empty / same-language / bad target without requiring provider.
  const preflight = validateTranslationRequest(body);
  if (!preflight.ok) {
    const http =
      preflight.status === 'empty' || preflight.status === 'already-same-language'
        ? 200
        : preflight.status === 'unsupported'
          ? 400
          : 400;
    return json(res, http, {
      ok: false,
      status: preflight.status,
      error: preflight.error,
      targetLang: preflight.targetLang ?? body.targetLang ?? null,
      text: preflight.status === 'already-same-language'
        ? String(body.text ?? '').trim()
        : undefined,
    });
  }

  if (!isTranslationProviderConfigured()) {
    return json(res, 503, {
      ok: false,
      status: 'unsupported',
      error: 'Translation provider not configured',
      targetLang: preflight.targetLang,
    });
  }

  try {
    const result = await translateText(body);
    if (!result.ok) {
      const http = result.status === 'unsupported' ? 503 : 502;
      return json(res, http, {
        ok: false,
        status: result.status,
        error: result.error,
        targetLang: preflight.targetLang,
      });
    }

    return json(res, 200, {
      ok: true,
      status: 'success',
      translatedText: result.translatedText,
      targetLang: preflight.targetLang,
      sourceLang: result.detectedSourceLang ?? preflight.sourceLang,
      provider: result.provider,
    });
  } catch (e) {
    console.error('[translate-store-chat]', e);
    return json(res, 502, {
      ok: false,
      status: 'failed',
      error: 'Translation request failed',
      targetLang: preflight.targetLang,
    });
  }
}
