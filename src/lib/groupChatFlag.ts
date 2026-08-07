/**
 * Custom Group Chat feature flag.
 * Off unless VITE_GROUP_CHAT is explicitly enabled (1 | true | on).
 * Server Admin routes must gate with the same check.
 */

export function isGroupChatEnabled(
  env: { VITE_GROUP_CHAT?: unknown; GROUP_CHAT?: unknown } = import.meta.env,
): boolean {
  const raw = String(env.VITE_GROUP_CHAT ?? env.GROUP_CHAT ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}
