import { useEffect, useMemo, useRef } from 'react';
import { db } from '../../db';
import { nowIso } from '../../lib/utils';
import { partitionGroupMembershipRoomIds } from '../../lib/storeOpsLeadership';
import { isGroupChatEnabled } from '../../lib/groupChatFlag';
import { isStoreOpsLeadershipChatEnabled } from '../../lib/storeOpsLeadershipFlag';
import type { GroupChatMember, GroupChatMessage } from '../../types';

const UNREAD_LIMIT = 200;

function unreadQuery(roomIds: string[]) {
  if (!roomIds.length) return null;
  return {
    groupChatMessages: {
      $: {
        where: { roomId: { $in: roomIds } },
        order: { createdAt: 'desc' as const },
        limit: UNREAD_LIMIT,
      },
    },
  };
}

function countUnread(
  messages: GroupChatMessage[],
  memberships: GroupChatMember[],
  currentUserId: string,
): Record<string, number> {
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
}

/**
 * Cross-device group unread via members.lastReadAt (client Instant update).
 * Private vs leadership queries are split so each keeps the 200 cap independently.
 */
export function useGroupChatUnread(options: {
  memberships: GroupChatMember[];
  currentUserId: string;
  viewingRoomId: string | null;
}) {
  const { memberships, currentUserId, viewingRoomId } = options;
  const groupChatOn = isGroupChatEnabled();
  const leadershipOn = isStoreOpsLeadershipChatEnabled();

  const { privateIds, leadershipIds } = useMemo(() => {
    const partitioned = partitionGroupMembershipRoomIds(memberships);
    return {
      privateIds: groupChatOn ? partitioned.privateIds : [],
      leadershipIds: leadershipOn ? partitioned.leadershipIds : [],
    };
  }, [memberships, groupChatOn, leadershipOn]);

  const privateIdsKey = privateIds.slice().sort().join(',');
  const leadershipIdsKey = leadershipIds.slice().sort().join(',');

  const { data: privateData } = db.useQuery(unreadQuery(privateIds));
  const { data: leadershipData } = db.useQuery(unreadQuery(leadershipIds));

  const privateMessages = (privateData?.groupChatMessages ?? []) as GroupChatMessage[];
  const leadershipMessages = (leadershipData?.groupChatMessages ?? []) as GroupChatMessage[];

  const unreadByRoom = useMemo(() => {
    return {
      ...countUnread(privateMessages, memberships, currentUserId),
      ...countUnread(leadershipMessages, memberships, currentUserId),
    };
  }, [privateMessages, leadershipMessages, memberships, currentUserId]);

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
  }, [viewingRoomId, currentUserId, memberships, privateIdsKey, leadershipIdsKey]);

  return {
    unreadByRoom,
    unreadConversationCount,
    totalUnreadMessages,
  };
}
