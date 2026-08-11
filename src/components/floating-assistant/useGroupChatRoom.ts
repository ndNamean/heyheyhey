import { useMemo } from 'react';
import { db } from '../../db';
import {
  groupGiphyReactions,
  groupUnicodeReactions,
  mapReactionsByMessageId,
  type GiphyReactionGroup,
  type UnicodeReactionGroup,
} from '../../lib/storeChatReactions';
import type {
  GroupChatBookmark,
  GroupChatMember,
  GroupChatMessage,
  GroupChatReaction,
  GroupChatRoom,
} from '../../types';

const MESSAGE_LIMIT = 40;

/**
 * Subscribe to one group room + newest ~40 messages,
 * plus room-batched reactions/bookmarks (membership-gated).
 */
export function useGroupChatRoom(roomId: string | null | undefined, currentUserId = '') {
  const query = roomId
    ? {
        groupChatRooms: {
          $: { where: { id: roomId } },
          members: { profile: { avatarFile: {} } },
          invites: { invitee: { avatarFile: {} } },
        },
        groupChatMessages: {
          $: {
            where: { roomId },
            order: { createdAt: 'desc' as const },
            limit: MESSAGE_LIMIT,
          },
          sender: { avatarFile: {} },
        },
        groupChatReactions: {
          $: {
            where: { roomId },
            order: { createdAt: 'asc' as const },
          },
        },
        ...(currentUserId
          ? {
              groupChatMembers: {
                $: { where: { roomId, userId: currentUserId } },
              },
              groupChatBookmarks: {
                $: {
                  where: { roomId, userId: currentUserId },
                  order: { createdAt: 'asc' as const },
                },
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

  const pendingInvites = useMemo(() => {
    const invites = (room?.invites ?? []) as NonNullable<GroupChatRoom['invites']>;
    return invites.filter((inv) => inv.status === 'pending');
  }, [room?.invites]);

  const reactions = useMemo(
    () => (data?.groupChatReactions ?? []) as GroupChatReaction[],
    [data?.groupChatReactions],
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
    () => (data?.groupChatBookmarks ?? []) as GroupChatBookmark[],
    [data?.groupChatBookmarks],
  );

  const bookmarkByMessageId = useMemo(() => {
    const map = new Map<string, GroupChatBookmark>();
    for (const bookmark of bookmarks) {
      if (!map.has(bookmark.messageId)) map.set(bookmark.messageId, bookmark);
    }
    return map;
  }, [bookmarks]);

  return {
    room,
    messages,
    members,
    pendingInvites,
    myMembership,
    reactions,
    reactionsByMessageId,
    reactionGroupsByMessageId,
    giphyReactionGroupsByMessageId,
    bookmarks,
    bookmarkByMessageId,
    isLoading: Boolean(roomId) && isLoading,
    error: error ?? null,
  };
}
