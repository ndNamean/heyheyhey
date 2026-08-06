/**
 * Resolve Store Chat rooms for Logbook ack (and single-store) delivery.
 * All-store notes (entry.storeId === '') fan out to recipient-linked active rooms.
 */

export function profileStoreIds(profile) {
  return (profile?.stores ?? []).map((s) => s.id).filter(Boolean);
}

/** Same access rule as api/logbook-notify.js — linked stores or owner/admin/areaManager. */
export function hasStoreAccess(profile, storeId) {
  if (!storeId) return false;
  const ids = profileStoreIds(profile);
  if (ids.includes(storeId)) return true;
  const role = profile?.role || '';
  return role === 'owner' || role === 'areaManager' || role === 'admin';
}

/**
 * Rooms for logbook_system chat writes.
 * - entry.storeId set → that single room (unchanged).
 * - empty storeId → every active store that at least one ack recipient can access.
 *
 * @param {{ storeId?: string }} entry
 * @param {string[]} recipients userIds who must ack / receive the event
 * @param {Array<{ userId: string, role?: string, stores?: Array<{ id: string }> }>} profiles
 * @param {Array<{ id: string, active?: boolean }>} stores
 * @returns {string[]}
 */
export function resolveAckChatStoreIds(entry, recipients, profiles, stores) {
  const entryStoreId = String(entry?.storeId || '').trim();
  if (entryStoreId) return [entryStoreId];

  const recipientSet = new Set((recipients || []).filter(Boolean));
  if (recipientSet.size === 0) return [];

  const recipientProfiles = (profiles || []).filter((p) =>
    recipientSet.has(p.userId),
  );
  if (recipientProfiles.length === 0) return [];

  const activeIds = (stores || [])
    .filter((s) => s && s.id && s.active === true)
    .map((s) => s.id);

  const roomIds = new Set();
  for (const storeId of activeIds) {
    if (recipientProfiles.some((p) => hasStoreAccess(p, storeId))) {
      roomIds.add(storeId);
    }
  }
  return [...roomIds].sort();
}

/** Ack recipients who can access a given store room (for per-room mentions). */
export function recipientsForChatRoom(recipients, profiles, storeId) {
  const profileByUser = new Map(
    (profiles || []).map((p) => [p.userId, p]),
  );
  return (recipients || []).filter((userId) => {
    const p = profileByUser.get(userId);
    return p ? hasStoreAccess(p, storeId) : false;
  });
}
