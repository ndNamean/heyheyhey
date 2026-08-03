import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { LauncherSide } from './useFloatingLauncherPosition';

export const FLOATING_ASSISTANT_PANEL_ID = 'floating-assistant-panel';

interface Props {
  open: boolean;
  side: LauncherSide;
  dragging: boolean;
  dragX: number | null;
  dragEnabled: boolean;
  unreadCount?: number;
  hasUnread?: boolean;
  onToggle: () => void;
  onDockLeft: () => void;
  onDockRight: () => void;
  onReset: () => void;
  beginPointerDrag: (clientX: number, onClick: () => void) => () => void;
  buttonRef: RefObject<HTMLButtonElement>;
}

export default function FloatingAssistantLauncher({
  open,
  side,
  dragging,
  dragX,
  dragEnabled,
  unreadCount = 0,
  hasUnread = false,
  onToggle,
  onDockLeft,
  onDockRight,
  onReset,
  beginPointerDrag,
  buttonRef,
}: Props) {
  const cleanupRef = useRef<(() => void) | null>(null);

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    if (!dragEnabled) return;
    e.preventDefault();
    cleanupRef.current?.();
    cleanupRef.current = beginPointerDrag(e.clientX, onToggle);
  }

  function handleClick() {
    if (dragEnabled) return;
    onToggle();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onDockLeft();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onDockRight();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      onReset();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  }

  const style: CSSProperties = {};
  if (dragging && dragX != null) {
    style.left = Math.min(Math.max(dragX - 24, 8), window.innerWidth - 56);
    style.right = 'auto';
    style.transform = 'none';
  }

  const unreadLabel =
    hasUnread && unreadCount > 0
      ? `, ${unreadCount} unread store chat ${unreadCount === 1 ? 'message' : 'messages'}`
      : '';

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`fa-launcher fa-launcher--${side}${dragEnabled ? ' fa-launcher--draggable' : ''}${dragging ? ' is-dragging' : ''}${open ? ' is-open' : ''}${hasUnread ? ' has-unread' : ''}`}
      style={style}
      aria-label={`Open assistant and store chat${unreadLabel}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={FLOATING_ASSISTANT_PANEL_ID}
      title={
        dragEnabled
          ? 'Open assistant. Drag to dock left/right. Keys: ← → dock, Home reset.'
          : 'Open assistant and store chat'
      }
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="fa-launcher-icon" aria-hidden="true">
        💭
      </span>
      {hasUnread ? (
        <span className="fa-launcher-badge" aria-hidden="true">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
