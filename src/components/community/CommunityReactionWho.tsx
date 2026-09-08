import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import { reactionPersonLabel } from '../../lib/communityReactionPeople';
import ProfileAvatar from '../profileAvatar/ProfileAvatar';

const OPEN_DELAY_MS = 220;
const CLOSE_DELAY_MS = 160;
const LONG_PRESS_MS = 420;
const MOVE_CANCEL_PX = 10;

let activeCloser: (() => void) | null = null;

function claimPopover(close: () => void) {
  if (activeCloser && activeCloser !== close) activeCloser();
  activeCloser = close;
}

function releasePopover(close: () => void) {
  if (activeCloser === close) activeCloser = null;
}

function placePopover(anchor: DOMRect, size: { width: number; height: number }): { top: number; left: number } {
  const gap = 8;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = anchor.top - size.height - gap;
  if (top < pad) top = anchor.bottom + gap;
  if (top + size.height > vh - pad) top = Math.max(pad, vh - size.height - pad);
  let left = anchor.left;
  if (left + size.width > vw - pad) left = vw - size.width - pad;
  if (left < pad) left = pad;
  return { top, left };
}

interface Props {
  userIds: string[];
  profilesByUserId: ReadonlyMap<string, AvatarProfileFields>;
  heading: string;
  unknownLabel: string;
  children: ReactNode;
}

export default function CommunityReactionWho({
  userIds,
  profilesByUserId,
  heading,
  unknownLabel,
  children,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);

  const people = userIds.map((userId) => {
    const profile = profilesByUserId.get(userId);
    return {
      userId,
      profile,
      name: reactionPersonLabel(profile, unknownLabel),
    };
  });

  function clearHoverTimers() {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function clearPressTimer() {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  }

  function closeNow() {
    clearHoverTimers();
    clearPressTimer();
    setOpen(false);
    releasePopover(closeNow);
  }

  function openNow() {
    clearHoverTimers();
    clearPressTimer();
    claimPopover(closeNow);
    setOpen(true);
  }

  function queueOpen() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) return;
    if (openTimer.current) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      openNow();
    }, OPEN_DELAY_MS);
  }

  function queueClose() {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (!open || closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      closeNow();
    }, CLOSE_DELAY_MS);
  }

  const closeRef = useRef(closeNow);
  closeRef.current = closeNow;

  useEffect(() => () => closeRef.current(), []);

  useEffect(() => {
    if (!open) return;
    const close = () => closeRef.current();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const anchor = wrapRef.current.getBoundingClientRect();
    const size = popoverRef.current?.getBoundingClientRect();
    setPlacement(placePopover(anchor, { width: size?.width ?? 200, height: size?.height ?? 80 }));
  }, [open, people.length]);

  function onPointerEnter(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') return;
    queueOpen();
  }

  function onPointerLeave(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') return;
    queueClose();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') return;
    clearPressTimer();
    pressOrigin.current = { x: event.clientX, y: event.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      suppressClick.current = true;
      openNow();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = pressOrigin.current;
    if (!origin || !pressTimer.current) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) clearPressTimer();
  }

  function onPointerUp() {
    clearPressTimer();
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
  }

  const popover =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            className="community-reaction-who"
            role="tooltip"
            aria-label={heading}
            style={
              placement
                ? { top: placement.top, left: placement.left }
                : { visibility: 'hidden', top: 0, left: 0 }
            }
            onPointerEnter={(event) => {
              if (event.pointerType === 'touch') return;
              queueOpen();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'touch') return;
              queueClose();
            }}
          >
            <p className="community-reaction-who-heading">{heading}</p>
            <ul className="community-reaction-who-list">
              {people.map((person) => (
                <li key={person.userId} className="community-reaction-who-row">
                  <ProfileAvatar
                    profile={
                      person.profile ?? {
                        userId: person.userId,
                        displayName: person.name,
                        email: '',
                      }
                    }
                    size={22}
                    title={person.name}
                  />
                  <span className="community-reaction-who-name">{person.name}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={wrapRef}
      className="community-reaction-chip-wrap"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onFocusCapture={queueOpen}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        if (wrapRef.current?.contains(next) || popoverRef.current?.contains(next)) return;
        queueClose();
      }}
      onClickCapture={onClickCapture}
    >
      {children}
      {popover}
    </div>
  );
}

