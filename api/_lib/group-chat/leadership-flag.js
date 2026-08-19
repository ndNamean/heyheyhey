/**
 * Server mirror of src/lib/storeOpsLeadershipFlag.ts — both default OFF.
 */

function isTruthyFlag(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

export function isStoreOpsLeadershipChatEnabled(
  value = process.env.VITE_STORE_OPS_LEADERSHIP_CHAT ||
    process.env.STORE_OPS_LEADERSHIP_CHAT,
) {
  return isTruthyFlag(value);
}

export function isStoreOpsLeadershipOversightNotifyEnabled(
  value = process.env.VITE_STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY ||
    process.env.STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY,
) {
  return isTruthyFlag(value);
}
