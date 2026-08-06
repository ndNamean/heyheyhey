import { describe, expect, it } from 'vitest';
import type { MentionCandidate } from './storeChatMentions';
import type { Profile, StoreChatMessage } from '../types';
import { avatarFieldsForMessage } from './storeChatAvatar';

function baseMessage(
  overrides: Partial<StoreChatMessage> = {},
): StoreChatMessage {
  return {
    id: 'm1',
    storeId: 's1',
    senderUserId: 'user-actor',
    senderProfileId: '',
    senderNameSnapshot: 'Actor Snap',
    senderRoleSnapshot: 'staff',
    messageType: 'logbook_system',
    body: 'System note\n@all',
    createdAt: '2026-08-04T00:00:00.000Z',
    editedAt: '',
    deletedAt: '',
    status: 'active',
    replyToMessageId: '',
    ...overrides,
  };
}

const liveProfile = {
  id: 'p-me',
  userId: 'me',
  displayName: 'Me',
  email: 'me@example.com',
  role: 'staff',
  avatarUrl: 'https://example.com/me.png',
  avatarPath: 'profile-avatars/me/avatar.png',
  avatarFile: { id: 'f-me', url: 'https://live/me.png' },
} as Profile;

const candidates: MentionCandidate[] = [
  {
    userId: 'user-actor',
    label: 'Actor Label',
    email: 'actor@example.com',
    profile: {
      displayName: 'Actor Live',
      email: 'actor@example.com',
      userId: 'user-actor',
      avatarUrl: 'https://example.com/actor.png',
      avatarPath: 'profile-avatars/user-actor/avatar.png',
      avatarFile: { id: 'f-actor', url: 'https://live/actor.png' },
    },
  },
];

describe('avatarFieldsForMessage', () => {
  it('returns live profile for own messages', () => {
    const result = avatarFieldsForMessage(
      baseMessage({ senderUserId: 'me' }),
      true,
      liveProfile,
      candidates,
    );
    expect(result).toBe(liveProfile);
  });

  it('prefers linked message.sender when present', () => {
    const result = avatarFieldsForMessage(
      baseMessage({
        sender: {
          id: 'p-linked',
          userId: 'user-actor',
          displayName: 'Linked Name',
          email: 'linked@example.com',
          avatarUrl: 'https://example.com/linked.png',
          avatarPath: 'profile-avatars/linked/avatar.png',
          avatarFile: { id: 'f-linked', url: 'https://live/linked.png' },
        },
      }),
      false,
      liveProfile,
      candidates,
    );
    expect(result).toEqual({
      displayName: 'Linked Name',
      email: 'linked@example.com',
      userId: 'user-actor',
      avatarUrl: 'https://example.com/linked.png',
      avatarPath: 'profile-avatars/linked/avatar.png',
      avatarFile: { id: 'f-linked', url: 'https://live/linked.png' },
    });
  });

  it('falls back to candidates by senderUserId when sender link missing', () => {
    const result = avatarFieldsForMessage(
      baseMessage({ sender: undefined, senderProfileId: '' }),
      false,
      liveProfile,
      candidates,
    );
    expect(result).toEqual({
      displayName: 'Actor Live',
      email: 'actor@example.com',
      userId: 'user-actor',
      avatarUrl: 'https://example.com/actor.png',
      avatarPath: 'profile-avatars/user-actor/avatar.png',
      avatarFile: { id: 'f-actor', url: 'https://live/actor.png' },
    });
  });

  it('uses name snapshot when no sender and no candidate', () => {
    const result = avatarFieldsForMessage(
      baseMessage({ senderUserId: 'unknown-user' }),
      false,
      liveProfile,
      candidates,
    );
    expect(result).toEqual({
      displayName: 'Actor Snap',
      email: '',
      userId: 'unknown-user',
    });
  });
});
