import type { ReactNode } from 'react';
import type { Profile } from '../../types';
import ProfileAvatarPreview from './ProfileAvatarPreview';

interface Props {
  profile: Pick<Profile, 'displayName' | 'email' | 'avatarUrl'> | null | undefined;
  children: ReactNode;
  size?: number;
  className?: string;
}

/**
 * Compact inline identity: avatar (with full hover/tap preview) + text.
 * Missing profile → children only. Missing/broken avatarUrl → initials, no empty preview.
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
