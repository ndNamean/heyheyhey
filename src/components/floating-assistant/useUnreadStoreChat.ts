import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../../db';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import { nowIso } from '../../lib/utils';
import type { StoreChatMessage } from '../../types';

const LAST_READ_KEY = 'floatingAssistant.lastReadByStore';
const ACTIVITY_QUERY_LIMIT = 120;

type LastReadMap = Record<string, string>;

export type UnreadSenderSummary = {
  userId: string;
  count: number;
  profile: AvatarProfileFields;
  latestCreatedAt: string;
};

function readLastReadMap(): LastReadMap {
  try {
    const raw = localStorage.getItem(LAST_READ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: LastReadMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLastReadMap(map: LastReadMap) {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

function isActiveMessage(m: StoreChatMessage): boolean {
  return m.status !== 'deleted' && !m.deletedAt;
}

function profileForUnreadSender(m: StoreChatMessage): AvatarProfileFields {
  const sender = m.sender;
  if (sender) {
    return {
      displayName: sender.displayName,
      email: sender.email,
      userId: sender.userId,
      avatarUrl: sender.avatarUrl,
      avatarPath: sender.avatarPath,
      avatarFile: sender.avatarFile,
    };
  }
  return {
    displayName: m.senderNameSnapshot || 'Unknown',
    email: '',
    userId: m.senderUserId,
  };
}

/**
 * Lean visual unread: localStorage lastReadAt per storeId only (not auth).
 * Counts other users' active messages newer than lastRead for authorized stores.
 */
export function useUnreadStoreChat(options: {
  authorizedStoreIds: string[];
  currentUserId: string;
  /** When set, mark this store read (viewing the room). */
  viewingStoreId: string | null;
}) {
  const { authorizedStoreIds, currentUserId, viewingStoreId } = options;
  const [lastReadByStore, setLastReadByStore] = useState<LastReadMap>(() => readLastReadMap());

  const storeIdsKey = authorizedStoreIds.slice().sort().join(',');

  const query =
    authorizedStoreIds.length > 0
      ? {
          storeChatMessages: {
            $: {
              where: { storeId: { $in: authorizedStoreIds } },
              order: { createdAt: 'desc' as const },
              limit: ACTIVITY_QUERY_LIMIT,
            },
            sender: { avatarFile: {} },
          },
        }
      : null;

  const { data } = db.useQuery(query);

  const recentMessages = useMemo(
    () => (data?.storeChatMessages ?? []) as StoreChatMessage[],
    [data?.storeChatMessages],
  );

  const markStoreRead = useCallback(
    (storeId: string, atIso?: string) => {
      if (!storeId) return;
      const stamp = atIso || nowIso();
      setLastReadByStore((prev) => {
        const prevAt = prev[storeId] ?? '';
        if (prevAt && prevAt >= stamp) return prev;
        const next = { ...prev, [storeId]: stamp };
        writeLastReadMap(next);
        return next;
      });
    },
    [],
  );

  // Mark room read while viewing Store Chat for that store.
  useEffect(() => {
    if (!viewingStoreId) return;
    if (!authorizedStoreIds.includes(viewingStoreId)) return;

    const roomMsgs = recentMessages.filter((m) => m.storeId === viewingStoreId && isActiveMessage(m));
    const latest = roomMsgs.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '');
    markStoreRead(viewingStoreId, latest || nowIso());
  }, [viewingStoreId, authorizedStoreIds, recentMessages, markStoreRead, storeIdsKey]);

  const { unreadByStore, unreadSendersByStore } = useMemo(() => {
    const counts: Record<string, number> = {};
    const senderMaps: Record<
      string,
      Map<string, { count: number; profile: AvatarProfileFields; latestCreatedAt: string }>
    > = {};

    for (const id of authorizedStoreIds) {
      counts[id] = 0;
      senderMaps[id] = new Map();
    }

    for (const m of recentMessages) {
      if (!authorizedStoreIds.includes(m.storeId)) continue;
      if (!isActiveMessage(m)) continue;
      if (!currentUserId || m.senderUserId === currentUserId) continue;
      const lastRead = lastReadByStore[m.storeId] ?? '';
      if (lastRead && m.createdAt <= lastRead) continue;

      counts[m.storeId] = (counts[m.storeId] ?? 0) + 1;

      const storeSenders = senderMaps[m.storeId] ?? new Map();
      senderMaps[m.storeId] = storeSenders;
      const existing = storeSenders.get(m.senderUserId);
      if (existing) {
        existing.count += 1;
        if (m.createdAt > existing.latestCreatedAt) {
          existing.latestCreatedAt = m.createdAt;
          existing.profile = profileForUnreadSender(m);
        }
      } else {
        storeSenders.set(m.senderUserId, {
          count: 1,
          profile: profileForUnreadSender(m),
          latestCreatedAt: m.createdAt,
        });
      }
    }

    const unreadSenders: Record<string, UnreadSenderSummary[]> = {};
    for (const storeId of authorizedStoreIds) {
      const entries = [...(senderMaps[storeId] ?? new Map()).entries()].map(
        ([userId, info]) => ({
          userId,
          count: info.count,
          profile: info.profile,
          latestCreatedAt: info.latestCreatedAt,
        }),
      );
      entries.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
      unreadSenders[storeId] = entries;
    }

    return { unreadByStore: counts, unreadSendersByStore: unreadSenders };
  }, [authorizedStoreIds, recentMessages, lastReadByStore, currentUserId]);

  const totalUnread = useMemo(
    () => Object.values(unreadByStore).reduce((sum, n) => sum + n, 0),
    [unreadByStore],
  );

  const selectedUnread = viewingStoreId ? (unreadByStore[viewingStoreId] ?? 0) : 0;

  return {
    unreadByStore,
    unreadSendersByStore,
    totalUnread,
    selectedUnread,
    markStoreRead,
    hasUnread: totalUnread > 0,
  };
}
