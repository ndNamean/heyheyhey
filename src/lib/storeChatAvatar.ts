import type { AvatarProfileFields } from './avatarDisplay';
import type { MentionCandidate } from './storeChatMentions';
import type { Profile } from '../types';

/** Minimal message shape for avatar resolution (Store Chat + Group Chat). */
export type MessageAvatarSource = {
  senderUserId: string;
  senderNameSnapshot: string;
  sender?: Pick<
    Profile,
    'id' | 'userId' | 'displayName' | 'email' | 'avatarUrl' | 'avatarPath' | 'avatarFile'
  >;
};

/**
 * Avatar fields for a chat message row.
 * Prefer linked `message.sender`; else room candidates by senderUserId
 * (covers historical unlinked system rows); else name snapshot.
 */
export function avatarFieldsForMessage(
  message: MessageAvatarSource,
  isOwn: boolean,
  liveProfile: Profile,
  candidates?: MentionCandidate[],
): AvatarProfileFields {
  if (isOwn) return liveProfile;
  const sender = message.sender;
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
  // Historical unlinked system/human rows: resolve photo from room members.
  const byUserId = message.senderUserId
    ? candidates?.find((c) => c.userId === message.senderUserId)
    : undefined;
  if (byUserId) {
    return {
      displayName:
        byUserId.profile.displayName ||
        message.senderNameSnapshot ||
        byUserId.label ||
        'Unknown',
      email: byUserId.profile.email || byUserId.email || '',
      userId: byUserId.userId,
      avatarUrl: byUserId.profile.avatarUrl,
      avatarPath: byUserId.profile.avatarPath,
      avatarFile: byUserId.profile.avatarFile,
    };
  }
  return {
    displayName: message.senderNameSnapshot || 'Unknown',
    email: '',
    userId: message.senderUserId,
  };
}
