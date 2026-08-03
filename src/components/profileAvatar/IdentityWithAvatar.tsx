import type { ReactNode } from 'react';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import ProfileAvatarPreview from './ProfileAvatarPreview';

interface Props {
  profile: AvatarProfileFields | null | undefined;
  children: ReactNode;
  size?: number;
  className?: string;
}

/**
 * Compact inline identity: avatar (with full hover/tap preview) + text.
 * Missing profile → children only. Missing/broken avatar → initials, no empty preview.
 */
export default function IdentityWithAvatar({
  profile,
  children,
  size = 18,
  className,
}: Props) {
  if (!profile) {
    return <>{children}</>;
  }

  return (
    <span className={['identity-with-avatar', className].filter(Boolean).join(' ')}>
      <ProfileAvatarPreview
        profile={profile}
        size={size}
        previewEnabled
        desktopHoverPreview
        mobileTapPreview
        className="identity-with-avatar-trigger"
      />
      <span className="identity-with-avatar-text">{children}</span>
    </span>
  );
}
