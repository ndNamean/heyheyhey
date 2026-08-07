import { useEffect, useMemo, useRef } from 'react';
import { db } from '../../db';
import { nowIso } from '../../lib/utils';
import type { GroupChatMember, GroupChatMessage } from '../../types';

/**
 * Cross-device group unread via members.lastReadAt (client Instant update).
 * Returns unread message counts and conversation-level unread flags.
 */
export function useGroupChatUnread(options: {
  memberships: GroupChatMember[];
  currentUserId: string;
  viewingRoomId: string | null;
}) {
  const { memberships, currentUserId, viewingRoomId } = options;
  const roomIds = useMemo(
    () => memberships.map((m) => m.roomId).filter(Boolean),
    [memberships],
  );
  const roomIdsKey = roomIds.slice().sort().join(',');

  const query =
    roomIds.length > 0
      ? {
          groupChatMessages: {
            $: {
              where: { roomId: { $in: roomIds } },
              order: { createdAt: 'desc' as const },
              limit: 200,
            },
          },
        }
      : null;

  const { data } = db.useQuery(query);

  const messages = (data?.groupChatMessages ?? []) as GroupChatMessage[];

  const unreadByRoom = useMemo(() => {
    const lastRead = new Map(memberships.map((m) => [m.roomId, m.lastReadAt || '']));
    const counts: Record<string, number> = {};
    for (const m of messages) {
      if (m.status === 'deleted' || m.deletedAt) continue;
      if (m.senderUserId === currentUserId) continue;
      if (m.messageType === 'system') continue;
      const lr = lastRead.get(m.roomId) || '';
      if (!lr || m.createdAt > lr) {
        counts[m.roomId] = (counts[m.roomId] || 0) + 1;
      }
    }
    return counts;
  }, [messages, memberships, currentUserId]);

  const unreadConversationCount = useMemo(
    () => Object.values(unreadByRoom).filter((n) => n > 0).length,
    [unreadByRoom],
  );

  const totalUnreadMessages = useMemo(
    () => Object.values(unreadByRoom).reduce((a, b) => a + b, 0),
    [unreadByRoom],
  );

  const writingRef = useRef(false);
  useEffect(() => {
    if (!viewingRoomId || !currentUserId) return;
    const membership = memberships.find((m) => m.roomId === viewingRoomId);
    if (!membership) return;
    const now = nowIso();
    if (membership.lastReadAt && membership.lastReadAt >= now.slice(0, 16)) return;
    if (writingRef.current) return;
    writingRef.current = true;
    db.transact(db.tx.groupChatMembers[membership.id].update({ lastReadAt: now }))
      .catch(() => {})
      .finally(() => {
        writingRef.current = false;
      });
  }, [viewingRoomId, currentUserId, memberships, roomIdsKey]);

  return {
    unreadByRoom,
    unreadConversationCount,
    totalUnreadMessages,
  };
}
