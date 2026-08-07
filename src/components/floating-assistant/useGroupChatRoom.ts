import { useMemo } from 'react';
import { db } from '../../db';
import type { GroupChatMember, GroupChatMessage, GroupChatRoom } from '../../types';

const MESSAGE_LIMIT = 40;

export function useGroupChatRoom(roomId: string | null | undefined, currentUserId = '') {
  const query = roomId
    ? {
        groupChatRooms: {
          $: { where: { id: roomId } },
          members: { profile: { avatarFile: {} } },
        },
        groupChatMessages: {
          $: {
            where: { roomId },
            order: { createdAt: 'desc' as const },
            limit: MESSAGE_LIMIT,
          },
          sender: { avatarFile: {} },
        },
        ...(currentUserId
          ? {
              groupChatMembers: {
                $: { where: { roomId, userId: currentUserId } },
              },
            }
          : {}),
      }
    : null;

  const { data, isLoading, error } = db.useQuery(query);

  const room = useMemo(() => {
    const raw = data?.groupChatRooms?.[0] as GroupChatRoom | undefined;
    return raw ?? null;
  }, [data?.groupChatRooms]);

  const messages = useMemo(() => {
    const raw = (data?.groupChatMessages ?? []) as GroupChatMessage[];
    return raw.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [data?.groupChatMessages]);

  const myMembership = useMemo(() => {
    return ((data?.groupChatMembers ?? []) as GroupChatMember[])[0] ?? null;
  }, [data?.groupChatMembers]);

  const members = useMemo(() => {
    return (room?.members ?? []) as GroupChatMember[];
  }, [room?.members]);

  return {
    room,
    messages,
    members,
    myMembership,
    isLoading,
    error,
  };
}
