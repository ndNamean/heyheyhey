import { useLang } from '../../i18n';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import CommunityBuilderItem from './CommunityBuilderItem';
import { useCommunityBuilders, type CommunityBuilderMember } from './useCommunityBuilders';

type Props = {
  /** When set, skips the live hook (tests / Story overrides). */
  members?: CommunityBuilderMember[] | AvatarProfileFields[];
};

function displayName(profile: AvatarProfileFields): string {
  return profile.displayName?.trim() || profile.email?.trim() || 'member';
}

function asBuilderMember(
  member: CommunityBuilderMember | AvatarProfileFields,
  index: number,
): CommunityBuilderMember {
  const base = member as CommunityBuilderMember;
  return {
    ...member,
    userId: base.userId || `builder-${index}`,
    postCount: base.postCount ?? 0,
    commentCount: base.commentCount ?? 0,
    supportCount: base.supportCount ?? 0,
    contributionCount: base.contributionCount ?? 0,
  };
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

  return (
    <section className="community-builders-wrap" aria-label={title}>
      <div className="community-builders-label">{title}</div>
      <ul className="community-builders-row" role="list">
        {members.map((raw, index) => {
          const member = asBuilderMember(raw, index);
          const name = displayName(member);
          const count = member.contributionCount;
          const contributions =
            count === 1
              ? t.community.builderContributionSingular.replace('{count}', String(count))
              : t.community.builderContributionPlural.replace('{count}', String(count));
          const itemLabel = t.community.builderItemLabel
            .replace('{name}', name)
            .replace('{contributions}', contributions);
          return (
            <CommunityBuilderItem
              key={member.userId}
              member={member}
              itemLabel={itemLabel}
            />
          );
        })}
      </ul>
    </section>
  );
}
