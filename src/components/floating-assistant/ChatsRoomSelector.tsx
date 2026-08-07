import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { ChatRoomRef } from '../../lib/chatRoomKeys';
import type { GroupChatInvite, GroupChatRoom, Store } from '../../types';
import ProfileAvatarPreview from '../profileAvatar/ProfileAvatarPreview';
import type { UnreadSenderSummary } from './useUnreadStoreChat';

const MAX_VISIBLE_SENDERS = 3;

function stopAvatarTriggerClick(event: ReactMouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

function formatUnreadDisplay(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function storeTitle(store: Store): string {
  return `${store.code} · ${store.name}`;
}

type RoomOption =
  | { kind: 'store'; id: string; title: string; subtitle: string; unread: number; senders: UnreadSenderSummary[] }
  | { kind: 'group'; id: string; title: string; subtitle: string; unread: number; senders: UnreadSenderSummary[] };

function UnreadSenderAvatarStack({ senders }: { senders: UnreadSenderSummary[] }) {
  if (!senders.length) return null;
  const visible = senders.slice(0, MAX_VISIBLE_SENDERS);
  const overflow = senders.length - visible.length;

  return (
    <span className="fa-store-unread-avatars">
      {visible.map((sender) => (
        <span key={sender.userId} className="fa-store-sender-avatar">
          <ProfileAvatarPreview
            profile={sender.profile}
            size={18}
            previewEnabled
            onTriggerClick={stopAvatarTriggerClick}
          />
          <span className="fa-store-sender-count" aria-hidden="true">
            {formatUnreadDisplay(sender.count)}
          </span>
        </span>
      ))}
      {overflow > 0 ? (
        <span className="fa-store-sender-overflow" aria-hidden="true">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

function inviteLabels(inv: GroupChatInvite): { title: string; subtitle: string } {
  const room = Array.isArray(inv.room) ? inv.room[0] : inv.room;
  const inviter = Array.isArray(inv.inviter) ? inv.inviter[0] : inv.inviter;
  const title = inv.roomNameSnapshot || room?.name || 'Group invite';
  const inviterLabel =
    inv.inviterNameSnapshot || inviter?.displayName || inviter?.email || 'someone';
  return {
    title,
    subtitle: `Invite from ${inviterLabel} · full history after accept`,
  };
}

interface Props {
  stores: Store[];
  groups: GroupChatRoom[];
  pendingInvites: GroupChatInvite[];
  selected: ChatRoomRef | null;
  onSelect: (ref: ChatRoomRef) => void;
  unreadByStore: Record<string, number>;
  unreadSendersByStore?: Record<string, UnreadSenderSummary[]>;
  unreadByGroup: Record<string, number>;
  canCreate: boolean;
  onCreateClick: () => void;
  onAcceptInvite: (inviteId: string) => void;
  onDeclineInvite: (inviteId: string) => void;
  inviteBusyId?: string | null;
  disabled?: boolean;
  id?: string;
}

export default function ChatsRoomSelector({
  stores,
  groups,
  pendingInvites,
  selected,
  onSelect,
  unreadByStore,
  unreadSendersByStore = {},
  unreadByGroup,
  canCreate,
  onCreateClick,
  onAcceptInvite,
  onDeclineInvite,
  inviteBusyId,
  disabled = false,
  id = 'fa-chats-room-selector',
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const roomOptions = useMemo((): RoomOption[] => {
    const list: RoomOption[] = [];
    for (const s of stores) {
      list.push({
        kind: 'store',
        id: s.id,
        title: storeTitle(s),
        subtitle: 'Store chat',
        unread: unreadByStore[s.id] || 0,
        senders: unreadSendersByStore[s.id] ?? [],
      });
    }
    for (const g of groups) {
      list.push({
        kind: 'group',
        id: g.id,
        title: g.name,
        subtitle: 'Private group',
        unread: unreadByGroup[g.id] || 0,
        senders: [],
      });
    }
    return list;
  }, [stores, groups, unreadByStore, unreadSendersByStore, unreadByGroup]);

  const selectedOption = useMemo(() => {
    if (!selected) return null;
    return (
      roomOptions.find((o) => o.kind === selected.kind && o.id === selected.id) ?? null
    );
  }, [roomOptions, selected]);

  const selectedUnread = selectedOption?.unread ?? 0;
  const selectedSenders = selectedOption?.senders ?? [];
  const isLocked = disabled || (roomOptions.length <= 1 && !pendingInvites.length && !canCreate);

  const close = useCallback(() => setOpen(false), []);

  const selectRoom = useCallback(
    (ref: ChatRoomRef) => {
      onSelect(ref);
      setOpen(false);
    },
    [onSelect],
  );

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      roomOptions.findIndex(
        (o) => selected && o.kind === selected.kind && o.id === selected.id,
      ),
    );
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, roomOptions, selected]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  function moveActive(delta: number) {
    if (!roomOptions.length) return;
    setActiveIndex((prev) => (prev + delta + roomOptions.length) % roomOptions.length);
  }

  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (isLocked) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        moveActive(e.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        {
          const opt = roomOptions[activeIndex];
          if (opt) selectRoom({ kind: opt.kind, id: opt.id });
        }
        break;
      case 'Home':
        if (open && roomOptions.length) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open && roomOptions.length) {
          e.preventDefault();
          setActiveIndex(roomOptions.length - 1);
        }
        break;
      default:
        break;
    }
  }

  const triggerTitle = selectedOption?.title ?? 'Select chat';
  const triggerSubtitle = selectedOption?.subtitle ?? '';
  const triggerAria = [
    triggerTitle,
    triggerSubtitle,
    selectedUnread > 0
      ? `${selectedUnread} unread ${selectedUnread === 1 ? 'message' : 'messages'}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  function renderRoomOption(opt: RoomOption, index: number) {
    const isSelected =
      selected != null && opt.kind === selected.kind && opt.id === selected.id;
    const active = index === activeIndex;
    const optionId = `${id}-option-${opt.kind}-${opt.id}`;

    return (
      <li
        key={`${opt.kind}:${opt.id}`}
        id={optionId}
        role="option"
        aria-selected={isSelected}
        aria-label={
          opt.unread > 0
            ? `${opt.title}, ${opt.subtitle}, ${opt.unread} unread`
            : `${opt.title}, ${opt.subtitle}`
        }
        className={[
          'fa-chats-room-option',
          opt.unread > 0 ? 'has-unread' : '',
          isSelected ? 'is-selected' : '',
          active ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => selectRoom({ kind: opt.kind, id: opt.id })}
      >
        <span className="fa-chats-room-option-main">
          <span className="fa-chats-room-option-title">{opt.title}</span>
          <span className="fa-chats-room-option-sub">{opt.subtitle}</span>
        </span>
        {opt.kind === 'store' && opt.unread > 0 && opt.senders.length ? (
          <UnreadSenderAvatarStack senders={opt.senders} />
        ) : null}
        {opt.unread > 0 ? (
          <span className="fa-chats-list-badge" aria-hidden="true">
            {formatUnreadDisplay(opt.unread)}
          </span>
        ) : null}
      </li>
    );
  }

  const storeOptions = roomOptions.filter((o) => o.kind === 'store');
  const groupOptions = roomOptions.filter((o) => o.kind === 'group');
  const storeStartIndex = 0;
  const groupStartIndex = storeOptions.length;

  return (
    <div
      className={`fa-chats-room-selector${open && !isLocked ? ' fa-chats-room-selector--open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        id={id}
        className={`fa-chats-room-selector-trigger${selectedUnread > 0 ? ' has-unread' : ''}`}
        disabled={isLocked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && roomOptions[activeIndex]
            ? `${id}-option-${roomOptions[activeIndex].kind}-${roomOptions[activeIndex].id}`
            : undefined
        }
        aria-label={triggerAria}
        onClick={() => {
          if (isLocked) return;
          setOpen((prev) => !prev);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="fa-chats-room-selector-trigger-text">
          <span className="fa-chats-room-selector-trigger-title">{triggerTitle}</span>
          {triggerSubtitle ? (
            <span className="fa-chats-room-selector-trigger-sub">{triggerSubtitle}</span>
          ) : null}
        </span>
        {selectedUnread > 0 && selectedSenders.length ? (
          <UnreadSenderAvatarStack senders={selectedSenders} />
        ) : selectedUnread > 0 ? (
          <span className="fa-chats-list-badge" aria-hidden="true">
            {formatUnreadDisplay(selectedUnread)}
          </span>
        ) : null}
        {!isLocked ? (
          <span className="fa-chats-room-selector-chevron" aria-hidden="true">
            ▾
          </span>
        ) : null}
      </button>

      {open && !isLocked ? (
        <div className="fa-chats-room-selector-menu" id={listboxId}>
          {pendingInvites.length ? (
            <div className="fa-chats-room-selector-section" role="group" aria-label="Pending invites">
              <div className="fa-chats-room-selector-section-label">Invites</div>
              <ul className="fa-chats-room-selector-invites">
                {pendingInvites.map((inv) => {
                  const { title, subtitle } = inviteLabels(inv);
                  return (
                    <li key={inv.id} className="fa-chats-list-item--invite fa-chats-room-invite">
                      <div className="fa-chats-list-item-main">
                        <div className="fa-chats-list-title">{title}</div>
                        <div className="fa-chats-list-sub">{subtitle}</div>
                      </div>
                      <div className="fa-chats-invite-actions">
                        <button
                          type="button"
                          className="fa-chats-invite-accept"
                          disabled={inviteBusyId === inv.id}
                          onClick={() => onAcceptInvite(inv.id)}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="fa-chats-invite-decline"
                          disabled={inviteBusyId === inv.id}
                          onClick={() => onDeclineInvite(inv.id)}
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <ul
            className="fa-chats-room-selector-list"
            role="listbox"
            aria-label="Chat rooms"
            tabIndex={-1}
          >
            {storeOptions.length ? (
              <>
                <li className="fa-chats-room-selector-section-label" role="presentation">
                  Stores
                </li>
                {storeOptions.map((opt, i) => renderRoomOption(opt, storeStartIndex + i))}
              </>
            ) : null}
            {groupOptions.length ? (
              <>
                <li className="fa-chats-room-selector-section-label" role="presentation">
                  Groups
                </li>
                {groupOptions.map((opt, i) => renderRoomOption(opt, groupStartIndex + i))}
              </>
            ) : null}
            {!roomOptions.length ? (
              <li className="fa-chats-list-empty" role="presentation">
                No chats yet.
              </li>
            ) : null}
          </ul>

          {canCreate ? (
            <button
              type="button"
              className="fa-chats-room-selector-new-group"
              onClick={() => {
                setOpen(false);
                onCreateClick();
              }}
            >
              New group
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
