/**
 * Client mirror of api/_lib/chat-attachment/json-budget.js.
 * Used to assert grant JSON never carries file bytes toward Vercel’s 4.5 MB cap.
 */

export const VERCEL_FUNCTION_BODY_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);
export const JSON_REQUEST_ENVELOPE_BYTES = 64 * 1024;
export const JSON_REQUEST_BYTE_BUDGET =
  VERCEL_FUNCTION_BODY_MAX_BYTES - JSON_REQUEST_ENVELOPE_BYTES;
export const MAGIC_PREFIX_MAX_BYTES = 32;
export const ATTACHMENT_TOO_LARGE_COPY = 'File too large.';

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(String(text ?? '')).length;
}

export function jsonPayloadByteLength(payload: unknown): number {
  return utf8ByteLength(JSON.stringify(payload));
}

export function grantPayloadHasFileBytes(
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const raw = payload.fileBase64;
  return typeof raw === 'string' && raw.length > 0;
}

export function assertJsonFitsFunctionBody(payload: Record<string, unknown>): number {
  if (grantPayloadHasFileBytes(payload)) {
    throw Object.assign(new Error(ATTACHMENT_TOO_LARGE_COPY), {
      status: 413,
      code: 'too_large',
    });
  }
  const bytes = jsonPayloadByteLength(payload);
  if (bytes > JSON_REQUEST_BYTE_BUDGET) {
    throw Object.assign(new Error(ATTACHMENT_TOO_LARGE_COPY), {
      status: 413,
      code: 'too_large',
    });
  }
  return bytes;
}
