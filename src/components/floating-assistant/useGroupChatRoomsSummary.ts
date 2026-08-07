import { useMemo } from 'react';
import { db } from '../../db';
import type { GroupChatInvite, GroupChatMember, GroupChatRoom } from '../../types';

/**
 * Memberships + pending invites for the signed-in user (Instant client rules).
 */
export function useGroupChatRoomsSummary(userId: string | undefined) {
  const query = userId
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
    return (data?.groupChatInvites ?? []) as GroupChatInvite[];
  }, [data?.groupChatInvites]);

  const membershipByRoomId = useMemo(() => {
    const map = new Map<string, GroupChatMember>();
    for (const m of memberships) map.set(m.roomId, m);
    return map;
  }, [memberships]);

  return {
    rooms,
    memberships,
    membershipByRoomId,
    pendingInvites,
    isLoading,
    error,
  };
}
