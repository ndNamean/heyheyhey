/**
 * Client feature flag for chat composer attachments.
 * Off unless VITE_CHAT_ATTACHMENTS is explicitly enabled (1 | true | on).
 * Schema/perms/upload API can ship while UI stays gated.
 */

export function isChatAttachmentsEnabled(
  env: { VITE_CHAT_ATTACHMENTS?: unknown } = import.meta.env,
): boolean {
  const raw = String(env.VITE_CHAT_ATTACHMENTS ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}
