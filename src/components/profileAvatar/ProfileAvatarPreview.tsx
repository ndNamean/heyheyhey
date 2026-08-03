import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { BACK_PRIORITY, useNativeBack } from '../../lib/nativeBack';
import {
  type AvatarProfileFields,
  profileHasAvatar,
  profileWithoutAvatarDisplay,
  resolveAvatarUrl,
} from '../../lib/avatarDisplay';
import ProfileAvatar from './ProfileAvatar';

interface Props {
  profile: AvatarProfileFields;
  size?: number;
  previewEnabled?: boolean;
  desktopHoverPreview?: boolean;
  mobileTapPreview?: boolean;
  onTriggerClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

type Placement = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 180;
const PREVIEW_SIZE = 220;
const PREVIEW_OFFSET = 8;
const VIEWPORT_PADDING = 12;

const activeClosers = new Map<string, () => void>();
let activePreviewId: string | null = null;
let idCounter = 0;

function closeOtherPreview(id: string) {
  if (!activePreviewId || activePreviewId === id) return;
  const close = activeClosers.get(activePreviewId);
  close?.();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function getName(profile: Pick<AvatarProfileFields, 'displayName' | 'email'>) {
  return profile.displayName?.trim() || profile.email?.trim() || 'user';
}

function getPlacement(anchorRect: DOMRect): Placement {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const defaultTop = anchorRect.top + (anchorRect.height - PREVIEW_SIZE) / 2;
  const rightLeft = anchorRect.right + PREVIEW_OFFSET;
  const leftLeft = anchorRect.left - PREVIEW_OFFSET - PREVIEW_SIZE;
  const belowTop = anchorRect.bottom + PREVIEW_OFFSET;
  const aboveTop = anchorRect.top - PREVIEW_OFFSET - PREVIEW_SIZE;

  const fitsRight = rightLeft + PREVIEW_SIZE <= viewportWidth - VIEWPORT_PADDING;
  const fitsLeft = leftLeft >= VIEWPORT_PADDING;
  const fitsBelow = belowTop + PREVIEW_SIZE <= viewportHeight - VIEWPORT_PADDING;

  if (fitsRight || (!fitsLeft && anchorRect.left < viewportWidth * 0.72)) {
    return {
      top: clamp(defaultTop, VIEWPORT_PADDING, viewportHeight - PREVIEW_SIZE - VIEWPORT_PADDING),
      left: clamp(rightLeft, VIEWPORT_PADDING, viewportWidth - PREVIEW_SIZE - VIEWPORT_PADDING),
      width: PREVIEW_SIZE,
      height: PREVIEW_SIZE,
    };
  }

  if (fitsLeft) {
    return {
      top: clamp(defaultTop, VIEWPORT_PADDING, viewportHeight - PREVIEW_SIZE - VIEWPORT_PADDING),
      left: clamp(leftLeft, VIEWPORT_PADDING, viewportWidth - PREVIEW_SIZE - VIEWPORT_PADDING),
      width: PREVIEW_SIZE,
      height: PREVIEW_SIZE,
    };
  }

  if (fitsBelow) {
    return {
      top: clamp(belowTop, VIEWPORT_PADDING, viewportHeight - PREVIEW_SIZE - VIEWPORT_PADDING),
      left: clamp(anchorRect.left, VIEWPORT_PADDING, viewportWidth - PREVIEW_SIZE - VIEWPORT_PADDING),
      width: PREVIEW_SIZE,
      height: PREVIEW_SIZE,
    };
  }

  return {
    top: clamp(aboveTop, VIEWPORT_PADDING, viewportHeight - PREVIEW_SIZE - VIEWPORT_PADDING),
    left: clamp(anchorRect.left, VIEWPORT_PADDING, viewportWidth - PREVIEW_SIZE - VIEWPORT_PADDING),
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
  };
}

export default function ProfileAvatarPreview({
  profile,
  size = 34,
  previewEnabled = false,
  desktopHoverPreview = true,
  mobileTapPreview = true,
  onTriggerClick,
  className,
}: Props) {
  const previewId = useMemo(() => `profile-avatar-preview-${++idCounter}`, []);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const restoreFocusRef = useRef(false);
  const [isDesktopFinePointer, setIsDesktopFinePointer] = useState(false);
  const [isDesktopOpen, setIsDesktopOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [failedUrls, setFailedUrls] = useState<Record<string, true>>({});

  const avatarUrl = resolveAvatarUrl(profile);
  const hasAvatar = profileHasAvatar(profile) && !!avatarUrl && !failedUrls[avatarUrl];
  const previewDisabled = !previewEnabled || !hasAvatar;
  const effectiveProfile = previewDisabled ? profileWithoutAvatarDisplay(profile) : profile;
  const name = getName(profile);
  const triggerLabel = `View profile photo for ${name}`;
  const imageAlt = `Profile photo of ${name}`;

  const anyOpen = isDesktopOpen || isMobileOpen;

  useEffect(() => {
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setIsDesktopFinePointer(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const closeSelf = () => {
      setIsDesktopOpen(false);
      setIsMobileOpen(false);
    };
    activeClosers.set(previewId, closeSelf);
    return () => {
      activeClosers.delete(previewId);
      if (activePreviewId === previewId) activePreviewId = null;
    };
  }, [previewId]);

  useEffect(() => {
    if (!anyOpen || previewDisabled) return;
    activePreviewId = previewId;
    closeOtherPreview(previewId);
  }, [anyOpen, previewDisabled, previewId]);

  useEffect(() => {
    if (!isDesktopOpen || previewDisabled || !triggerRef.current) return;
    setPlacement(getPlacement(triggerRef.current.getBoundingClientRect()));
  }, [isDesktopOpen, previewDisabled]);

  useEffect(() => {
    if (!isDesktopOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      clearTimers();
      setIsDesktopOpen(false);
      if (activePreviewId === previewId) activePreviewId = null;
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDesktopOpen, previewId]);

  useEffect(() => {
    if (!isDesktopOpen && !isMobileOpen) return;
    const close = () => {
      setIsDesktopOpen(false);
      setIsMobileOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [isDesktopOpen, isMobileOpen]);

  useEffect(() => {
    if (!isDesktopOpen && !isMobileOpen) return;
    const close = () => {
      setIsDesktopOpen(false);
      setIsMobileOpen(false);
      if (activePreviewId === previewId) activePreviewId = null;
    };
    window.addEventListener('popstate', close);
    window.addEventListener('hashchange', close);
    return () => {
      window.removeEventListener('popstate', close);
      window.removeEventListener('hashchange', close);
    };
  }, [isDesktopOpen, isMobileOpen, previewId]);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isMobileOpen) return;
    modalRef.current?.focus();
  }, [isMobileOpen]);

  useEffect(() => {
    if (isMobileOpen || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [isMobileOpen]);

  useNativeBack(
    () => {
      if (!isMobileOpen) return false;
      setIsMobileOpen(false);
      restoreFocusRef.current = true;
      return true;
    },
    isMobileOpen,
    BACK_PRIORITY.MODAL,
  );

  function clearTimers() {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function queueOpenDesktop() {
    if (previewDisabled) return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (isDesktopOpen) return;
    if (openTimerRef.current) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      closeOtherPreview(previewId);
      activePreviewId = previewId;
      setIsDesktopOpen(true);
    }, OPEN_DELAY_MS);
  }

  function queueCloseDesktop() {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!isDesktopOpen || closeTimerRef.current) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setIsDesktopOpen(false);
      if (activePreviewId === previewId) activePreviewId = null;
    }, CLOSE_DELAY_MS);
  }

  function openMobile() {
    if (previewDisabled) return;
    clearTimers();
    closeOtherPreview(previewId);
    activePreviewId = previewId;
    setIsDesktopOpen(false);
    setIsMobileOpen(true);
  }

  function closeMobile() {
    setIsMobileOpen(false);
    if (activePreviewId === previewId) activePreviewId = null;
    restoreFocusRef.current = true;
  }

  function closeAllPreviews() {
    clearTimers();
    setIsDesktopOpen(false);
    setIsMobileOpen(false);
    if (activePreviewId === previewId) activePreviewId = null;
  }

  function onPreviewImageError() {
    if (!avatarUrl) return;
    setFailedUrls((prev) => (prev[avatarUrl] ? prev : { ...prev, [avatarUrl]: true }));
    setIsDesktopOpen(false);
    setIsMobileOpen(false);
    if (activePreviewId === previewId) activePreviewId = null;
  }

  if (previewDisabled) {
    return <ProfileAvatar profile={effectiveProfile} size={size} />;
  }

  const desktopPopover = isDesktopOpen && placement
    ? createPortal(
      <div
        ref={popoverRef}
        className="profile-avatar-preview-popover"
        style={{
          top: placement.top,
          left: placement.left,
          width: placement.width,
          height: placement.height,
        }}
        onMouseEnter={() => {
          if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }
        }}
        onMouseLeave={queueCloseDesktop}
      >
        <img src={avatarUrl} alt={imageAlt} onError={onPreviewImageError} />
      </div>,
      document.body,
    )
    : null;

  const mobileModal = isMobileOpen
    ? createPortal(
      <div
        className="profile-avatar-preview-modal-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeMobile();
        }}
      >
        <div
          ref={modalRef}
          className="profile-avatar-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={imageAlt}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeMobile();
              return;
            }
            if (event.key !== 'Tab') return;
            const roots = modalRef.current;
            if (!roots) return;
            const focusables = roots.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (!first || !last) return;
            const active = document.activeElement;
            if (event.shiftKey && active === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && active === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <div className="profile-avatar-preview-modal-image-wrap">
            <img src={avatarUrl} alt={imageAlt} onError={onPreviewImageError} />
          </div>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={className ? `profile-avatar-preview-trigger ${className}` : 'profile-avatar-preview-trigger'}
        aria-label={triggerLabel}
        aria-haspopup={isDesktopFinePointer ? 'true' : 'dialog'}
        aria-expanded={anyOpen}
        onMouseEnter={
          isDesktopFinePointer && desktopHoverPreview
            ? queueOpenDesktop
            : undefined
        }
        onMouseLeave={
          isDesktopFinePointer && desktopHoverPreview
            ? queueCloseDesktop
            : undefined
        }
        onFocus={
          isDesktopFinePointer && desktopHoverPreview
            ? queueOpenDesktop
            : undefined
        }
        onBlur={
          isDesktopFinePointer && desktopHoverPreview
            ? (event) => {
              const next = event.relatedTarget as Node | null;
              if (
                next &&
                (triggerRef.current?.contains(next) || popoverRef.current?.contains(next))
              ) {
                return;
              }
              queueCloseDesktop();
            }
            : undefined
        }
        onClick={(event) => {
          if (onTriggerClick) {
            closeAllPreviews();
            onTriggerClick(event);
            return;
          }
          if (!isDesktopFinePointer && mobileTapPreview) {
            openMobile();
          }
        }}
      >
        <ProfileAvatar profile={effectiveProfile} size={size} />
      </button>
      {desktopPopover}
      {mobileModal}
    </>
  );
}
