import { useMemo, useState } from 'react';
import type { ChatRoomRef } from '../../lib/chatRoomKeys';
import type { GroupChatInvite, GroupChatRoom, Store } from '../../types';
import type { UnreadSenderSummary } from './useUnreadStoreChat';
import {
  STORE_OPS_LEADERSHIP_LIST_SUBTITLE,
  STORE_OPS_LEADERSHIP_LIST_TITLE,
  leadershipRoomForStore,
  privateGroupRooms,
} from '../../lib/storeOpsLeadership';

/** Show always-visible search when room count exceeds this. */
const SEARCH_VISIBLE_THRESHOLD = 6;

export type ChatListItem =
  | {
      kind: 'store';
      id: string;
      key: string;
      title: string;
      subtitle: string;
      unread: number;
      senders?: UnreadSenderSummary[];
    }
  | {
      kind: 'group';
      id: string;
      key: string;
      title: string;
      subtitle: string;
      unread: number;
    }
  | {
      kind: 'invite';
      id: string;
      key: string;
      title: string;
      subtitle: string;
      invite: GroupChatInvite;
    };

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
}

export default function ChatsRoomList({
  stores,
  groups,
  pendingInvites,
  selected,
  onSelect,
  unreadByStore,
  unreadSendersByStore,
  unreadByGroup,
  canCreate,
  onCreateClick,
  onAcceptInvite,
  onDeclineInvite,
  inviteBusyId,
}: Props) {
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const totalRooms = stores.length + groups.length + pendingInvites.length;
  const showSearchInput =
    searchOpen || q.trim().length > 0 || totalRooms > SEARCH_VISIBLE_THRESHOLD;

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list: ChatListItem[] = [];

    for (const inv of pendingInvites) {
      const room = Array.isArray(inv.room) ? inv.room[0] : inv.room;
      const inviter = Array.isArray(inv.inviter) ? inv.inviter[0] : inv.inviter;
      const title = inv.roomNameSnapshot || room?.name || 'Group invite';
      const inviterLabel =
        inv.inviterNameSnapshot || inviter?.displayName || inviter?.email || 'someone';
      const subtitle = `Invite from ${inviterLabel} · full history after accept`;
      if (needle && !title.toLowerCase().includes(needle) && !subtitle.toLowerCase().includes(needle)) {
        continue;
      }
      list.push({
        kind: 'invite',
        id: inv.id,
        key: `invite:${inv.id}`,
        title,
        subtitle,
        invite: inv,
      });
    }

    for (const s of stores) {
      const title = `${s.code} · ${s.name}`;
      if (!needle || title.toLowerCase().includes(needle)) {
        list.push({
          kind: 'store',
          id: s.id,
          key: `store:${s.id}`,
          title,
          subtitle: 'Store chat',
          unread: unreadByStore[s.id] || 0,
          senders: unreadSendersByStore?.[s.id],
        });
      }
      const lead = leadershipRoomForStore(groups, s.id);
      if (lead) {
        const leadTitle = STORE_OPS_LEADERSHIP_LIST_TITLE;
        const leadSub = STORE_OPS_LEADERSHIP_LIST_SUBTITLE;
        if (
          !needle ||
          leadTitle.toLowerCase().includes(needle) ||
          leadSub.toLowerCase().includes(needle) ||
          title.toLowerCase().includes(needle) ||
          (lead.name || '').toLowerCase().includes(needle)
        ) {
          list.push({
            kind: 'group',
            id: lead.id,
            key: `group:${lead.id}`,
            title: leadTitle,
            subtitle: leadSub,
            unread: unreadByGroup[lead.id] || 0,
          });
        }
      }
    }

    for (const g of privateGroupRooms(groups)) {
      if (needle && !g.name.toLowerCase().includes(needle)) continue;
      list.push({
        kind: 'group',
        id: g.id,
        key: `group:${g.id}`,
        title: g.name,
        subtitle: 'Private group',
        unread: unreadByGroup[g.id] || 0,
      });
    }

    return list;
  }, [stores, groups, pendingInvites, q, unreadByStore, unreadSendersByStore, unreadByGroup]);

  return (
    <div className="fa-chats-list" role="navigation" aria-label="Chat rooms">
      <div className="fa-chats-list-toolbar">
        {showSearchInput ? (
          <label className="fa-chats-search">
            <span className="sr-only">Search chats</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              autoFocus={searchOpen && totalRooms <= SEARCH_VISIBLE_THRESHOLD}
            />
          </label>
        ) : (
          <button
            type="button"
            className="fa-chats-search-toggle"
            onClick={() => setSearchOpen(true)}
            aria-label="Search chats"
          >
            ⌕
          </button>
        )}
        {canCreate ? (
          <button
            type="button"
            className="fa-chats-new-group fa-chats-new-group--compact"
            onClick={onCreateClick}
            aria-label="New group"
            title="New group"
          >
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
      </div>

      <ul className="fa-chats-list-items">
        {items.map((item) => {
          if (item.kind === 'invite') {
            return (
              <li key={item.key} className="fa-chats-list-item fa-chats-list-item--invite">
                <div className="fa-chats-list-item-main">
                  <div className="fa-chats-list-title">{item.title}</div>
                  <div className="fa-chats-list-sub">{item.subtitle}</div>
                </div>
                <div className="fa-chats-invite-actions">
                  <button
                    type="button"
                    className="fa-chats-invite-accept"
                    disabled={inviteBusyId === item.id}
                    onClick={() => onAcceptInvite(item.id)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="fa-chats-invite-decline"
                    disabled={inviteBusyId === item.id}
                    onClick={() => onDeclineInvite(item.id)}
                  >
                    Decline
                  </button>
                </div>
              </li>
            );
          }

          const isSelected =
            selected &&
            ((item.kind === 'store' && selected.kind === 'store' && selected.id === item.id) ||
              (item.kind === 'group' && selected.kind === 'group' && selected.id === item.id));

          return (
            <li key={item.key}>
              <button
                type="button"
                className={`fa-chats-list-item${isSelected ? ' is-selected' : ''}`}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => onSelect({ kind: item.kind, id: item.id })}
              >
                <span className="fa-chats-list-item-main">
                  <span className="fa-chats-list-title">{item.title}</span>
                  <span className="fa-chats-list-sub">{item.subtitle}</span>
                </span>
                {item.unread > 0 ? (
                  <span className="fa-chats-list-badge" aria-label={`${item.unread} unread`}>
                    {item.unread > 99 ? '99+' : item.unread}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {!items.length ? (
          <li className="fa-chats-list-empty">No chats match.</li>
        ) : null}
      </ul>
    </div>
  );
}
