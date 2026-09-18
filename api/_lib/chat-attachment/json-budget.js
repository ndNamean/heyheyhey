/**
 * Vercel serverless request body budget for chat-attachment grant JSON.
 * `api.bodyParser.sizeLimit` does not override the platform 4.5 MB cap.
 * https://vercel.com/docs/functions/limitations
 */

/** 4.5 MiB — Vercel documented function request body limit. */
export const VERCEL_FUNCTION_BODY_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

/** Room for JSON keys, auth headers, and grant metadata. */
export const JSON_REQUEST_ENVELOPE_BYTES = 64 * 1024;

export const JSON_REQUEST_BYTE_BUDGET =
  VERCEL_FUNCTION_BODY_MAX_BYTES - JSON_REQUEST_ENVELOPE_BYTES;

/** First bytes of the file, sent as base64 for magic sniffing (not the file). */
export const MAGIC_PREFIX_MAX_BYTES = 32;

export const ATTACHMENT_TOO_LARGE_COPY = 'File too large.';

export function utf8ByteLength(text) {
  const value = String(text ?? '');
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length;
  }
  return Buffer.byteLength(value, 'utf8');
}

export function jsonPayloadByteLength(payload) {
  return utf8ByteLength(JSON.stringify(payload));
}

export function grantPayloadHasFileBytes(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const raw = payload.fileBase64;
  return typeof raw === 'string' && raw.length > 0;
}

export function assertJsonFitsFunctionBody(payload) {
  if (grantPayloadHasFileBytes(payload)) {
    const err = new Error(ATTACHMENT_TOO_LARGE_COPY);
    err.status = 413;
    err.code = 'too_large';
    throw err;
  }
  const bytes = jsonPayloadByteLength(payload);
  if (bytes > JSON_REQUEST_BYTE_BUDGET) {
    const err = new Error(ATTACHMENT_TOO_LARGE_COPY);
    err.status = 413;
    err.code = 'too_large';
    throw err;
  }
  return bytes;
}
