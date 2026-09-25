import { useEffect, useState } from 'react';
import type { FocusEvent, MouseEvent } from 'react';
import { useLang } from '../../i18n';
import ProfileAvatarPreview from '../profileAvatar/ProfileAvatarPreview';
import CommunityBuilderTooltip from './CommunityBuilderTooltip';
import type { CommunityBuilderMember } from './useCommunityBuilders';

type Props = {
  member: CommunityBuilderMember;
  itemLabel: string;
};

function displayName(member: CommunityBuilderMember): string {
  return member.displayName?.trim() || member.email?.trim() || 'member';
}

/**
 * Glow wrapper + contribution tip (fine pointer hover/focus) + avatar preview.
 * Tip and photo are mutually exclusive on desktop via preview prop flags.
 */
export default function CommunityBuilderItem({ member, itemLabel }: Props) {
  const { t } = useLang();
  const [isFinePointer, setIsFinePointer] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);

  const name = displayName(member);
  const count = member.contributionCount ?? 0;
  const showTip = count > 0;
  const contributionLine =
    count === 1
      ? t.community.builderContributionSingular.replace('{count}', String(count))
      : t.community.builderContributionPlural.replace('{count}', String(count));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setIsFinePointer(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function openTip() {
    if (!isFinePointer || !showTip) return;
    setTipOpen(true);
  }

  function closeTip() {
    setTipOpen(false);
  }

  function onBlur(event: FocusEvent<HTMLLIElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    closeTip();
  }

  function onClickCapture(_event: MouseEvent<HTMLLIElement>) {
    // Clear tip when photo popover opens via click.
    closeTip();
  }

  return (
    <li
      className="community-builders-item"
      aria-label={itemLabel}
      onMouseEnter={openTip}
      onMouseLeave={closeTip}
      onFocus={openTip}
      onBlur={onBlur}
      onClickCapture={onClickCapture}
    >
      <div className="community-builder-avatar community-builder-avatar--recognized">
        {showTip ? (
          <CommunityBuilderTooltip
            name={name}
            contributionLine={contributionLine}
            open={tipOpen}
          />
        ) : null}
        <ProfileAvatarPreview
          profile={member}
          size={36}
          previewEnabled
          desktopHoverPreview={false}
          desktopClickPreview
          mobileTapPreview
          className="community-builder-avatar-trigger"
        />
      </div>
    </li>
  );
}
