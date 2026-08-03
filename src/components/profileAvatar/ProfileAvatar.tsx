import { useEffect, useRef, useState } from 'react';
import { profileInitials } from '../../lib/avatarCompose';
import {
  type AvatarProfileFields,
  resolveAvatarUrl,
} from '../../lib/avatarDisplay';
import { resolveAvatar } from '../../lib/avatarClient';

interface Props {
  profile: AvatarProfileFields;
  size?: number;
  className?: string;
  /** Show image when available; otherwise initials. */
  title?: string;
}

function canAttemptResolve(profile: AvatarProfileFields): boolean {
  const userId = profile.userId?.trim();
  if (!userId) return false;
  return !!(
    profile.avatarPath?.trim() ||
    profile.avatarUrl?.trim() ||
    profile.avatarFile?.id
  );
}

export default function ProfileAvatar({ profile, size = 40, className = '', title }: Props) {
  const liveUrl = resolveAvatarUrl(profile);
  const userId = profile.userId?.trim() || '';
  const avatarPath = profile.avatarPath?.trim() || '';
  const legacyUrl = profile.avatarUrl?.trim() || '';
  const fileId = profile.avatarFile?.id || '';
  const [displayUrl, setDisplayUrl] = useState(liveUrl);
  const [failed, setFailed] = useState(false);
  const resolveAttemptedRef = useRef(false);

  useEffect(() => {
    setDisplayUrl(liveUrl);
    setFailed(false);
    resolveAttemptedRef.current = false;
  }, [liveUrl, userId, avatarPath, legacyUrl, fileId]);

  // Recover legacy / unlinked avatars: no live URL yet but storage likely still exists.
  useEffect(() => {
    if (liveUrl || resolveAttemptedRef.current || !userId) return;
    if (!avatarPath && !legacyUrl && !fileId) return;
    resolveAttemptedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { url } = await resolveAvatar(userId);
        if (!cancelled && url) {
          setDisplayUrl(url);
          setFailed(false);
        }
      } catch {
        /* keep initials */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveUrl, userId, avatarPath, legacyUrl, fileId]);

  const initials = profileInitials(profile.displayName || '', profile.email || '');
  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.4)) };
  const showPhoto = !!displayUrl && !failed;

  async function onImageError() {
    if (!resolveAttemptedRef.current && canAttemptResolve(profile)) {
      resolveAttemptedRef.current = true;
      try {
        const { url } = await resolveAvatar(userId);
        if (url && url !== displayUrl) {
          setDisplayUrl(url);
          setFailed(false);
          return;
        }
      } catch {
        /* fall through */
      }
    }
    setFailed(true);
  }

  if (showPhoto) {
    return (
      <div
        className={`avatar-circle avatar-circle--photo ${className}`.trim()}
        style={style}
        title={title || profile.displayName || profile.email}
      >
        <img src={displayUrl} alt="" draggable={false} onError={() => void onImageError()} />
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
