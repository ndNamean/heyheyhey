import type { GroupChatRoom, Store } from '../types';

export type ChatForwardDestination =
  | { kind: 'store'; id: string; label: string }
  | { kind: 'group'; id: string; label: string };

function storeLabel(store: Store): string {
  const code = store.code?.trim();
  const name = store.name?.trim();
  if (code && name) return `${code} · ${name}`;
  return name || code || store.id;
}

/**
 * Forward destinations = authorized stores + other group rooms the user can send to.
 * Excludes the current room when forwarding from a group.
 */
export function buildChatForwardDestinations(opts: {
  authorizedStores: Store[];
  groupRooms: GroupChatRoom[];
  /** Exclude this group room id (current conversation). */
  excludeGroupRoomId?: string | null;
  /** Optionally exclude a store id when forwarding from that store. */
  excludeStoreId?: string | null;
}): ChatForwardDestination[] {
  const excludeGroup = String(opts.excludeGroupRoomId ?? '').trim();
  const excludeStore = String(opts.excludeStoreId ?? '').trim();
  const out: ChatForwardDestination[] = [];

  for (const store of opts.authorizedStores) {
    if (!store?.id || !store.active) continue;
    if (excludeStore && store.id === excludeStore) continue;
    out.push({ kind: 'store', id: store.id, label: storeLabel(store) });
  }

  for (const room of opts.groupRooms) {
    if (!room?.id) continue;
    if (room.status === 'archived') continue;
    if (excludeGroup && room.id === excludeGroup) continue;
    const name = room.name?.trim() || room.id;
    out.push({ kind: 'group', id: room.id, label: name });
  }

  return out;
}
