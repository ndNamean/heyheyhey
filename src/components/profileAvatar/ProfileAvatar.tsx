import type { Profile } from '../../types';
import { profileInitials } from '../../lib/avatarCompose';

interface Props {
  profile: Pick<Profile, 'displayName' | 'email' | 'avatarUrl'>;
  size?: number;
  className?: string;
  /** Show image when available; otherwise initials. */
  title?: string;
}

export default function ProfileAvatar({ profile, size = 40, className = '', title }: Props) {
  const url = profile.avatarUrl?.trim();
  const initials = profileInitials(profile.displayName || '', profile.email || '');
  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.4)) };

  if (url) {
    return (
      <div
        className={`avatar-circle avatar-circle--photo ${className}`.trim()}
        style={style}
        title={title || profile.displayName || profile.email}
      >
        <img src={url} alt="" draggable={false} />
      </div>
    );
  }

  return (
    <div
      className={`avatar-circle ${className}`.trim()}
      style={style}
      title={title || profile.displayName || profile.email}
      aria-hidden={!title}
    >
      {initials}
    </div>
  );
}
