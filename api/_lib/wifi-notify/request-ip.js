/**
 * Extract the client public IP from trusted proxy headers.
 * Never trust a body-supplied IP.
 */

import { normalizePublicIp, isValidExactPublicIp } from './ip-normalize.js';

function headerValue(headers, name) {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function asStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) => splitForwarded(v));
  }
  return splitForwarded(value);
}

function splitForwarded(value) {
  if (value == null) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Leftmost public hop from x-forwarded-for / x-real-ip / x-vercel-forwarded-for.
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @returns {string | null}
 */
export function getClientPublicIp(req) {
  const headers = req?.headers ?? {};
  const candidates = [
    ...asStringList(headerValue(headers, 'x-forwarded-for')),
    ...asStringList(headerValue(headers, 'x-real-ip')),
    ...asStringList(headerValue(headers, 'x-vercel-forwarded-for')),
  ];

  for (const raw of candidates) {
    const normalized = normalizePublicIp(raw);
    if (normalized && isValidExactPublicIp(normalized)) {
      return normalized;
    }
  }
  return null;
}
