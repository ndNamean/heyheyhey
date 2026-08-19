import { useMemo } from 'react';
import { db } from '../../db';
import { isGroupChatEnabled } from '../../lib/groupChatFlag';
import { isChatsSurfaceEnabled, isStoreOpsLeadershipChatEnabled } from '../../lib/storeOpsLeadershipFlag';
import { isStoreOpsLeadershipRoom } from '../../lib/storeOpsLeadership';
import type { GroupChatInvite, GroupChatMember, GroupChatRoom } from '../../types';

/**
 * Memberships + pending invites for the signed-in user (Instant client rules).
 * Queries when private groups OR leadership rooms are enabled.
 */
export function useGroupChatRoomsSummary(userId: string | undefined) {
  const enabled = isChatsSurfaceEnabled();
  const groupChatOn = isGroupChatEnabled();
  const leadershipOn = isStoreOpsLeadershipChatEnabled();
  const query =
    userId && enabled
      ? {
          groupChatMembers: {
            $: { where: { userId } },
            room: {},
          },
          groupChatInvites: {
            $: { where: { inviteeUserId: userId, status: 'pending' } },
          },
        }
      : null;

  const { data, isLoading, error } = db.useQuery(query);

  const memberships = useMemo(() => {
    return ((data?.groupChatMembers ?? []) as GroupChatMember[]).filter((m) => {
      const room = Array.isArray(m.room) ? m.room[0] : m.room;
      return room && room.status !== 'archived';
    });
  }, [data?.groupChatMembers]);

  const rooms = useMemo(() => {
    const out: GroupChatRoom[] = [];
    for (const m of memberships) {
      const room = (Array.isArray(m.room) ? m.room[0] : m.room) as GroupChatRoom | undefined;
      if (room) out.push({ ...room, members: [m] });
    }
    out.sort((a, b) => (b.lastMessageAt || b.updatedAt || '').localeCompare(a.lastMessageAt || a.updatedAt || ''));
    return out;
  }, [memberships]);

  const pendingInvites = useMemo(() => {
    if (!groupChatOn) return [];
    return (data?.groupChatInvites ?? []) as GroupChatInvite[];
  }, [data?.groupChatInvites, groupChatOn]);

  const membershipByRoomId = useMemo(() => {
    const map = new Map<string, GroupChatMember>();
    for (const m of memberships) map.set(m.roomId, m);
    return map;
  }, [memberships]);

  const visibleRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (isStoreOpsLeadershipRoom(room)) return leadershipOn;
      return groupChatOn;
    });
  }, [rooms, leadershipOn, groupChatOn]);

  return {
    rooms: visibleRooms,
    memberships,
    membershipByRoomId,
    pendingInvites,
    isLoading,
    error,
  };
}
