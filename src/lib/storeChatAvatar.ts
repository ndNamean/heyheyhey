import type { AvatarProfileFields } from './avatarDisplay';
import type { MentionCandidate } from './storeChatMentions';
import type { Profile, StoreChatMessage } from '../types';

/**
 * Avatar fields for a Store Chat row.
 * Prefer linked `message.sender`; else room candidates by senderUserId
 * (covers historical unlinked logbook_system rows); else name snapshot.
 */
export function avatarFieldsForMessage(
  message: StoreChatMessage,
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
