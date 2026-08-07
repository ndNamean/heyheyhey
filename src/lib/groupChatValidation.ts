/** Client + shared validation for Custom Group Chat room names. */

export const GROUP_CHAT_NAME_MAX = 80;
export const GROUP_CHAT_DESCRIPTION_MAX = 280;

const URL_LIKE =
  /https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|io|app|co|vn)\b/i;
const SYMBOL_ONLY = /^[\s\p{P}\p{S}]+$/u;

export type GroupChatNameValidation =
  | { ok: true; name: string }
  | { ok: false; error: 'empty' | 'too_long' | 'symbol_only' | 'unsafe_url' };

export function normalizeGroupChatName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateGroupChatName(raw: unknown): GroupChatNameValidation {
  const name = normalizeGroupChatName(raw);
  if (!name) return { ok: false, error: 'empty' };
  if (name.length > GROUP_CHAT_NAME_MAX) return { ok: false, error: 'too_long' };
  if (SYMBOL_ONLY.test(name)) return { ok: false, error: 'symbol_only' };
  if (URL_LIKE.test(name)) return { ok: false, error: 'unsafe_url' };
  return { ok: true, name };
}

export function normalizeGroupChatDescription(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GROUP_CHAT_DESCRIPTION_MAX);
}

/** Lowercase alphanumeric key for similar-name warnings (not unique). */
export function similarNameKey(name: string): string {
  return normalizeGroupChatName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
