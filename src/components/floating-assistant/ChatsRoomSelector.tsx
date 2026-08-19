import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { BACK_PRIORITY, useNativeBack } from '../../lib/nativeBack';
import type { ChatRoomRef } from '../../lib/chatRoomKeys';
import type { GroupChatInvite, GroupChatRoom, Store } from '../../types';
import ProfileAvatarPreview from '../profileAvatar/ProfileAvatarPreview';
import type { UnreadSenderSummary } from './useUnreadStoreChat';
import {
  STORE_OPS_LEADERSHIP_LIST_SUBTITLE,
  STORE_OPS_LEADERSHIP_LIST_TITLE,
  leadershipRoomForStore,
  privateGroupRooms,
} from '../../lib/storeOpsLeadership';

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

function leadershipTitle(store: Store): string {
  const code = String(store.code || '').trim();
  return code
    ? `${STORE_OPS_LEADERSHIP_LIST_TITLE} · ${code}`
    : STORE_OPS_LEADERSHIP_LIST_TITLE;
}

function isSameRoom(
  a: { kind: string; id: string } | null | undefined,
  b: { kind: string; id: string } | null | undefined,
): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

function useSheetPresentation(): boolean {
  const [sheet, setSheet] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return (
      window.matchMedia('(max-width: 720px)').matches ||
      window.matchMedia('(hover: none), (pointer: coarse)').matches
    );
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const narrow = window.matchMedia('(max-width: 720px)');
    const coarse = window.matchMedia('(hover: none), (pointer: coarse)');
    const sync = () => setSheet(narrow.matches || coarse.matches);
    sync();
    narrow.addEventListener('change', sync);
    coarse.addEventListener('change', sync);
    return () => {
      narrow.removeEventListener('change', sync);
      coarse.removeEventListener('change', sync);
    };
  }, []);

  return sheet;
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
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef(false);
  const listboxId = useId();
  const searchId = useId();
  const useSheet = useSheetPresentation();

  const roomOptions = useMemo((): RoomOption[] => {
    const list: RoomOption[] = [];
    const usedLeadership = new Set<string>();
    for (const s of stores) {
      list.push({
        kind: 'store',
        id: s.id,
        title: storeTitle(s),
        subtitle: 'Store chat',
        unread: unreadByStore[s.id] || 0,
        senders: unreadSendersByStore[s.id] ?? [],
      });
      const lead = leadershipRoomForStore(groups, s.id);
      if (lead) {
        usedLeadership.add(lead.id);
        list.push({
          kind: 'group',
          id: lead.id,
          title: leadershipTitle(s),
          subtitle: STORE_OPS_LEADERSHIP_LIST_SUBTITLE,
          unread: unreadByGroup[lead.id] || 0,
          senders: [],
        });
      }
    }
    for (const g of privateGroupRooms(groups)) {
      if (usedLeadership.has(g.id)) continue;
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

  const needle = query.trim().toLowerCase();

  const matchingOptions = useMemo(() => {
    if (!needle) return roomOptions;
    return roomOptions.filter((o) => {
      return o.title.toLowerCase().includes(needle) || o.subtitle.toLowerCase().includes(needle);
    });
  }, [roomOptions, needle]);

  const filteredOptions = useMemo(() => {
    const current =
      matchingOptions.find((o) => selected && isSameRoom(o, selected)) ?? null;
    const unread = matchingOptions.filter(
      (o) => o.unread > 0 && !isSameRoom(o, current),
    );
    const unreadIds = new Set(unread.map((o) => `${o.kind}:${o.id}`));
    const rest = matchingOptions.filter(
      (o) =>
        !isSameRoom(o, current) &&
        !unreadIds.has(`${o.kind}:${o.id}`),
    );
    return [...(current ? [current] : []), ...unread, ...rest];
  }, [matchingOptions, selected]);

  const filteredInvites = useMemo(() => {
    if (!needle) return pendingInvites;
    return pendingInvites.filter((inv) => {
      const { title, subtitle } = inviteLabels(inv);
      return title.toLowerCase().includes(needle) || subtitle.toLowerCase().includes(needle);
    });
  }, [pendingInvites, needle]);

  const selectedOption = useMemo(() => {
    if (!selected) return null;
    return (
      roomOptions.find((o) => o.kind === selected.kind && o.id === selected.id) ?? null
    );
  }, [roomOptions, selected]);

  const selectedUnread = selectedOption?.unread ?? 0;
  const selectedSenders = selectedOption?.senders ?? [];
  const isLocked = disabled || (roomOptions.length <= 1 && !pendingInvites.length && !canCreate);

  const exitSearchMode = useCallback(() => {
    setSearchMode(false);
    setQuery('');
    searchRef.current?.blur();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSearchMode(false);
    restoreFocusRef.current = true;
  }, []);

  const enterSearchMode = useCallback(() => {
    setSearchMode(true);
  }, []);

  const selectRoom = useCallback(
    (ref: ChatRoomRef) => {
      if (isSameRoom(ref, selected)) {
        close();
        return;
      }
      onSelect(ref);
      setOpen(false);
      setQuery('');
      setSearchMode(false);
      restoreFocusRef.current = true;
    },
    [onSelect, selected, close],
  );

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      filteredOptions.findIndex(
        (o) => selected && o.kind === selected.kind && o.id === selected.id,
      ),
    );
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [open, filteredOptions, selected]);

  useEffect(() => {
    if (!open || !searchMode) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, searchMode]);

  useEffect(() => {
    if (!open) {
      setSearchMode(false);
      setQuery('');
    }
  }, [open]);

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
        if (searchMode) {
          exitSearchMode();
          return;
        }
        close();
        return;
      }
      if (e.key === '/' && !searchMode && !useSheet) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        enterSearchMode();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, searchMode, exitSearchMode, enterSearchMode, useSheet]);

  useNativeBack(
    () => {
      if (!open) return false;
      if (searchMode) {
        exitSearchMode();
        return true;
      }
      close();
      return true;
    },
    open && !isLocked,
    BACK_PRIORITY.MODAL,
  );

  function moveActive(delta: number) {
    if (!filteredOptions.length) return;
    setActiveIndex((prev) => (prev + delta + filteredOptions.length) % filteredOptions.length);
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
          const opt = filteredOptions[activeIndex];
          if (opt) selectRoom({ kind: opt.kind, id: opt.id });
        }
        break;
      case 'Home':
        if (open && filteredOptions.length) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (open && filteredOptions.length) {
          e.preventDefault();
          setActiveIndex(filteredOptions.length - 1);
        }
        break;
      default:
        break;
    }
  }

  function onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        exitSearchMode();
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Enter':
        e.preventDefault();
        {
          const opt = filteredOptions[activeIndex];
          if (opt) selectRoom({ kind: opt.kind, id: opt.id });
        }
        break;
      case 'Home':
        if (filteredOptions.length) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (filteredOptions.length) {
          e.preventDefault();
          setActiveIndex(filteredOptions.length - 1);
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
        {isSelected ? (
          <span className="fa-chats-room-option-check" aria-hidden="true">
            ✓
          </span>
        ) : null}
      </li>
    );
  }

  const currentOpt =
    filteredOptions[0] && selected && isSameRoom(filteredOptions[0], selected)
      ? filteredOptions[0]
      : null;
  const afterCurrent = currentOpt ? filteredOptions.slice(1) : filteredOptions;
  const unreadOpts = afterCurrent.filter((o) => o.unread > 0);
  const unreadIdSet = new Set(unreadOpts.map((o) => `${o.kind}:${o.id}`));
  const restStoreOpts = afterCurrent.filter(
    (o) => o.kind === 'store' && !unreadIdSet.has(`${o.kind}:${o.id}`),
  );
  const restGroupOpts = afterCurrent.filter(
    (o) => o.kind === 'group' && !unreadIdSet.has(`${o.kind}:${o.id}`),
  );

  function optionIndex(opt: RoomOption): number {
    return filteredOptions.findIndex((o) => isSameRoom(o, opt));
  }

  const menuClass = [
    'fa-chats-room-selector-menu',
    useSheet ? 'fa-chats-room-selector-menu--sheet' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`fa-chats-room-selector${open && !isLocked ? ' fa-chats-room-selector--open' : ''}${
        useSheet && open && !isLocked ? ' fa-chats-room-selector--sheet' : ''
      }`}
      ref={rootRef}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`fa-chats-room-selector-trigger${selectedUnread > 0 ? ' has-unread' : ''}`}
        disabled={isLocked}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && filteredOptions[activeIndex]
            ? `${id}-option-${filteredOptions[activeIndex].kind}-${filteredOptions[activeIndex].id}`
            : undefined
        }
        aria-label={triggerAria}
        onClick={() => {
          if (isLocked) return;
          setOpen((prev) => {
            if (prev) {
              setQuery('');
              setSearchMode(false);
              restoreFocusRef.current = true;
            }
            return !prev;
          });
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
        <>
          {useSheet ? (
            <div
              className="fa-chats-room-selector-backdrop"
              role="presentation"
              onClick={close}
            />
          ) : null}
          <div
            className={menuClass}
            id={listboxId}
            role={useSheet ? 'dialog' : undefined}
            aria-label={useSheet ? 'Select conversation' : undefined}
          >
            {useSheet ? (
              <div className="fa-chats-room-selector-sheet-handle" aria-hidden="true">
                <span className="fa-chats-room-selector-sheet-handle-bar" />
              </div>
            ) : null}

            <div className="fa-chats-room-selector-header">
              {useSheet ? (
                <div className="fa-chats-room-selector-sheet-title">Select conversation</div>
              ) : (
                <div className="fa-chats-room-selector-header-title">Conversations</div>
              )}
              <div className="fa-chats-room-selector-header-actions">
                {!searchMode ? (
                  <button
                    type="button"
                    className="fa-chats-room-selector-search-btn"
                    aria-label="Search chats"
                    title="Search chats"
                    onClick={enterSearchMode}
                  >
                    🔍
                  </button>
                ) : null}
                {canCreate ? (
                  <button
                    type="button"
                    className="fa-chats-room-selector-add"
                    aria-label="New group"
                    title="New group"
                    onClick={() => {
                      close();
                      onCreateClick();
                    }}
                  >
                    +
                  </button>
                ) : null}
              </div>
            </div>

            {searchMode ? (
              <div className="fa-chats-room-selector-toolbar">
                <label className="sr-only" htmlFor={searchId}>
                  Search chats
                </label>
                <input
                  ref={searchRef}
                  id={searchId}
                  type="search"
                  className="fa-chats-room-selector-search"
                  placeholder="Search chats…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  autoComplete="off"
                />
              </div>
            ) : null}

            {filteredInvites.length ? (
              <div className="fa-chats-room-selector-section" role="group" aria-label="Pending invites">
                <div className="fa-chats-room-selector-section-label">Invites</div>
                <ul className="fa-chats-room-selector-invites">
                  {filteredInvites.map((inv) => {
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
              {currentOpt ? renderRoomOption(currentOpt, optionIndex(currentOpt)) : null}
              {unreadOpts.map((opt) => renderRoomOption(opt, optionIndex(opt)))}
              {restStoreOpts.length ? (
                <>
                  <li className="fa-chats-room-selector-section-label" role="presentation">
                    Stores
                  </li>
                  {restStoreOpts.map((opt) => renderRoomOption(opt, optionIndex(opt)))}
                </>
              ) : null}
              {restGroupOpts.length ? (
                <>
                  <li className="fa-chats-room-selector-section-label" role="presentation">
                    Groups
                  </li>
                  {restGroupOpts.map((opt) => renderRoomOption(opt, optionIndex(opt)))}
                </>
              ) : null}
              {!filteredOptions.length ? (
                <li className="fa-chats-list-empty" role="presentation">
                  {needle ? 'No matching chats.' : 'No chats yet.'}
                </li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
