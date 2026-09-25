import { useLang } from '../../i18n';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import ProfileAvatarPreview from '../profileAvatar/ProfileAvatarPreview';
import { useCommunityBuilders, type CommunityBuilderMember } from './useCommunityBuilders';

type Props = {
  /** When set, skips the live hook (tests / Story overrides). */
  members?: CommunityBuilderMember[] | AvatarProfileFields[];
};

function displayName(profile: AvatarProfileFields): string {
  return profile.displayName?.trim() || profile.email?.trim() || 'member';
}

/**
 * Optional, fail-open recognition strip. Renders null when empty/loading/error.
 * Never applies Focus classes; scores stay out of the UI.
 */
export default function CommunityBuilders({ members: membersOverride }: Props = {}) {
  const { t } = useLang();
  const live = useCommunityBuilders();
  const members = membersOverride ?? live.members;

  if (!members.length) return null;

  const title = t.community.buildersTitle;
  const labelTemplate = t.community.builderAvatarLabel;

  return (
    <section className="community-builders-wrap" aria-label={title}>
      <div className="community-builders-label">{title}</div>
      <ul className="community-builders-row" role="list">
        {members.map((member, index) => {
          const name = displayName(member);
          const aria = labelTemplate.replace('{name}', name);
          return (
            <li
              key={(member as CommunityBuilderMember).userId || `builder-${index}`}
              className="community-builders-item"
              aria-label={aria}
            >
              <div className="community-builder-avatar community-builder-avatar--recognized">
                <ProfileAvatarPreview
                  profile={member}
                  size={36}
                  previewEnabled
                  desktopHoverPreview
                  mobileTapPreview
                  className="community-builder-avatar-trigger"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
