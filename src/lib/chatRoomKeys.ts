/** Unified Chats room reference — store rooms stay store-keyed; groups use roomId. */

export type ChatRoomKind = 'store' | 'group';

export type ChatRoomRef =
  | { kind: 'store'; id: string }
  | { kind: 'group'; id: string };

export type ChatRoomKey = `store:${string}` | `group:${string}`;

export function toChatRoomKey(ref: ChatRoomRef): ChatRoomKey {
  return `${ref.kind}:${ref.id}`;
}

export function parseChatRoomKey(key: string | null | undefined): ChatRoomRef | null {
  if (!key || typeof key !== 'string') return null;
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const kind = key.slice(0, idx);
  const id = key.slice(idx + 1).trim();
  if (!id) return null;
  if (kind === 'store' || kind === 'group') return { kind, id };
  return null;
}

export const SELECTED_CHAT_ROOM_STORAGE_KEY = 'floatingAssistant.selectedChatRoomKey';

/** Migrate legacy store-only selection when group chat is enabled. */
export function migrateSelectedChatRoomKey(
  legacyStoreId: string | null | undefined,
  storedRoomKey: string | null | undefined,
): ChatRoomRef | null {
  const fromKey = parseChatRoomKey(storedRoomKey);
  if (fromKey) return fromKey;
  const storeId = String(legacyStoreId ?? '').trim();
  if (storeId) return { kind: 'store', id: storeId };
  return null;
}
