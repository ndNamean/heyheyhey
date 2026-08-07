/**
 * Server mirror of src/lib/groupChatFlag.ts — default OFF.
 */

export function isGroupChatEnabled(
  value = process.env.VITE_GROUP_CHAT || process.env.GROUP_CHAT,
) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}
