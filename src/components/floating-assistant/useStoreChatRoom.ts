import { useMemo } from 'react';
import { db } from '../../db';
import type { StoreChatMessage } from '../../types';

const MESSAGE_LIMIT = 40;

/**
 * Subscribe to the newest ~40 messages for one store room.
 * Passing a new storeId (or null) replaces the previous Instant query.
 */
export function useStoreChatRoom(storeId: string | null | undefined) {
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
      }
    : null;

  const { data, isLoading, error } = db.useQuery(query);

  const messages = useMemo(() => {
    const raw = (data?.storeChatMessages ?? []) as StoreChatMessage[];
    // Query is newest-first; display oldest → newest.
    return raw.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [data?.storeChatMessages]);

  return {
    messages,
    isLoading: Boolean(storeId) && isLoading,
    error: error ?? null,
  };
}
