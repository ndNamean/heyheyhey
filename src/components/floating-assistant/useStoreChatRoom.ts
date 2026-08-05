import { useMemo } from 'react';
import { db } from '../../db';
import {
  groupGiphyReactions,
  groupUnicodeReactions,
  mapReactionsByMessageId,
  type GiphyReactionGroup,
  type UnicodeReactionGroup,
} from '../../lib/storeChatReactions';
import type { StoreChatBookmark, StoreChatMessage, StoreChatReaction } from '../../types';

const MESSAGE_LIMIT = 40;

/**
 * Subscribe to the newest ~40 messages for one store room,
 * plus room-batched reaction and bookmark queries (not per-message).
 * Passing a new storeId (or null) replaces the previous Instant query.
 */
export function useStoreChatRoom(
  storeId: string | null | undefined,
  currentUserId = '',
) {
  const query = storeId
    ? {
        storeChatMessages: {
          $: {
            where: { storeId },
            order: { createdAt: 'desc' as const },
            limit: MESSAGE_LIMIT,
          },
          sender: { avatarFile: {} },
        },
        storeChatReactions: {
          $: {
            where: { storeId },
            order: { createdAt: 'asc' as const },
          },
        },
        ...(currentUserId
          ? {
              storeChatBookmarks: {
                $: {
                  where: { storeId, userId: currentUserId },
                  order: { createdAt: 'asc' as const },
                },
              },
            }
          : {}),
      }
    : null;

  const { data, isLoading, error } = db.useQuery(query);

  const messages = useMemo(() => {
    const raw = (data?.storeChatMessages ?? []) as StoreChatMessage[];
    // Query is newest-first; display oldest → newest.
    return raw.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [data?.storeChatMessages]);

  const reactions = useMemo(
    () => (data?.storeChatReactions ?? []) as StoreChatReaction[],
    [data?.storeChatReactions],
  );

  const reactionsByMessageId = useMemo(
    () => mapReactionsByMessageId(reactions),
    [reactions],
  );

  const reactionGroupsByMessageId = useMemo(() => {
    const map = new Map<string, UnicodeReactionGroup[]>();
    for (const [messageId, list] of reactionsByMessageId) {
      map.set(messageId, groupUnicodeReactions(list, currentUserId));
    }
    return map;
  }, [reactionsByMessageId, currentUserId]);

  const giphyReactionGroupsByMessageId = useMemo(() => {
    const map = new Map<string, GiphyReactionGroup[]>();
    for (const [messageId, list] of reactionsByMessageId) {
      map.set(messageId, groupGiphyReactions(list, currentUserId));
    }
    return map;
  }, [reactionsByMessageId, currentUserId]);

  const bookmarks = useMemo(
    () => (data?.storeChatBookmarks ?? []) as StoreChatBookmark[],
    [data?.storeChatBookmarks],
  );

  const bookmarkByMessageId = useMemo(() => {
    const map = new Map<string, StoreChatBookmark>();
    for (const bookmark of bookmarks) {
      if (!map.has(bookmark.messageId)) map.set(bookmark.messageId, bookmark);
    }
    return map;
  }, [bookmarks]);

  return {
    messages,
    reactions,
    reactionsByMessageId,
    reactionGroupsByMessageId,
    giphyReactionGroupsByMessageId,
    bookmarks,
    bookmarkByMessageId,
    isLoading: Boolean(storeId) && isLoading,
    error: error ?? null,
  };
}
