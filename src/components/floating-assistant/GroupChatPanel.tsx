import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import { groupChatApi } from '../../lib/groupChatApi';
import { nowIso } from '../../lib/utils';
import type { Profile } from '../../types';
import FloatingAssistantLoader from './FloatingAssistantLoader';
import { useGroupChatRoom } from './useGroupChatRoom';
import type { ComposerVisualHandlers } from './useComposerVisualState';

export const GROUP_CHAT_MAX_BODY = 2000;

interface Props {
  roomId: string | null;
  profile: Profile;
  panelId: string;
  labelledBy: string;
  hidden: boolean;
  canSend: boolean;
  composerVisual: ComposerVisualHandlers;
  onBack?: () => void;
  showBack?: boolean;
}

export default function GroupChatPanel({
  roomId,
  profile,
  panelId,
  labelledBy,
  hidden,
  canSend,
  composerVisual,
  onBack,
  showBack = false,
}: Props) {
  const { room, messages, members, myMembership, isLoading } = useGroupChatRoom(
    hidden ? null : roomId,
    profile.userId,
  );
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sendingLock = useRef(false);

  useEffect(() => {
    if (hidden || !roomId) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, roomId, hidden]);

  if (hidden) {
    return (
      <section
        id={panelId}
        role="tabpanel"
        aria-labelledby={labelledBy}
        hidden
        className="fa-group-chat-panel"
      />
    );
  }

  async function sendMessage(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend || !roomId || !room || room.status === 'archived') return;
    const body = draft.trim().slice(0, GROUP_CHAT_MAX_BODY);
    if (!body || sendingLock.current) return;
    sendingLock.current = true;
    setSendError(null);
    composerVisual.setSending();
    const msgId = id();
    const createdAt = nowIso();
    try {
      await db.transact([
        db.tx.groupChatMessages[msgId]
          .update({
            roomId,
            senderUserId: profile.userId,
            senderProfileId: profile.id,
            senderNameSnapshot: profile.displayName || profile.email || 'You',
            senderRoleSnapshot: profile.role || '',
            messageType: 'text',
            body,
            createdAt,
            editedAt: '',
            deletedAt: '',
            status: 'active',
            replyToMessageId: '',
            mentionedUserIdsJson: '[]',
            mentionAll: false,
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            giphyWidth: '',
            giphyHeight: '',
            giphyUrl: '',
            giphyPreviewUrl: '',
            clientMutationId: id(),
          })
          .link({ room: roomId, sender: profile.id }),
        db.tx.groupChatRooms[roomId].update({
          lastMessageAt: createdAt,
          updatedAt: createdAt,
        }),
      ]);
      setDraft('');
      composerVisual.setSuccess();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
      composerVisual.setFailure();
    } finally {
      sendingLock.current = false;
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  async function leaveOrArchive() {
    if (!roomId || !myMembership) return;
    setBusy(true);
    setManageError(null);
    try {
      if (myMembership.roomRole === 'owner') {
        await groupChatApi('groupChatArchive', { roomId });
      } else {
        await groupChatApi('groupChatLeave', { roomId });
      }
      setDetailsOpen(false);
      onBack?.();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="fa-group-chat-panel"
      data-room-id={roomId || undefined}
    >
      <header className="fa-group-chat-header">
        {showBack ? (
          <button type="button" className="fa-chats-back" onClick={onBack} aria-label="Back to chats">
            ←
          </button>
        ) : null}
        <div className="fa-group-chat-header-text">
          <h3 className="fa-group-chat-title">{room?.name || 'Group'}</h3>
          <p className="small">{members.length} members · private</p>
        </div>
        <button
          type="button"
          className="fa-panel-action"
          aria-label="Group details"
          onClick={() => setDetailsOpen(true)}
        >
          ℹ
        </button>
      </header>

      {isLoading && !room ? (
        <FloatingAssistantLoader label="Loading group…" />
      ) : (
        <div className="fa-group-chat-messages" ref={listRef} role="log" aria-live="polite">
          {messages.map((m) => {
            const mine = m.senderUserId === profile.userId;
            const deleted = m.status === 'deleted' || !!m.deletedAt;
            return (
              <div
                key={m.id}
                className={`fa-group-msg${mine ? ' is-mine' : ''}${m.messageType === 'system' ? ' is-system' : ''}`}
              >
                {m.messageType === 'system' ? (
                  <p className="fa-group-msg-system">{m.body}</p>
                ) : (
                  <>
                    {!mine ? (
                      <div className="fa-group-msg-meta small">
                        {m.senderNameSnapshot || 'Member'}
                      </div>
                    ) : null}
                    <div className="fa-group-msg-bubble">
                      {deleted ? <em>Message deleted</em> : m.body}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {!messages.length ? (
            <p className="fa-chats-list-empty">No messages yet. Say hello.</p>
          ) : null}
        </div>
      )}

      {canSend && room?.status !== 'archived' ? (
        <form className="fa-group-chat-composer" onSubmit={sendMessage}>
          <label className="sr-only" htmlFor={`${panelId}-composer`}>
            Message
          </label>
          <textarea
            id={`${panelId}-composer`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              composerVisual.onInput();
            }}
            onFocus={composerVisual.onFocus}
            onBlur={composerVisual.onBlur}
            onKeyDown={onComposerKey}
            rows={2}
            maxLength={GROUP_CHAT_MAX_BODY}
            placeholder="Message the group…"
          />
          <button type="submit" disabled={!draft.trim()}>
            Send
          </button>
          {sendError ? (
            <p className="fa-create-group-error" role="alert">
              {sendError}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="fa-group-chat-readonly small">
          {room?.status === 'archived' ? 'This group is archived.' : 'Read-only in this group.'}
        </p>
      )}

      {detailsOpen ? (
        <div className="fa-modal-backdrop" onClick={() => setDetailsOpen(false)}>
          <div
            className="fa-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Group details"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="fa-modal-header">
              <h3>{room?.name}</h3>
              <button
                type="button"
                className="fa-panel-close"
                aria-label="Close"
                onClick={() => setDetailsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="fa-modal-body">
              <p className="small">{room?.description || 'No description.'}</p>
              <h4 className="fa-group-members-heading">Members</h4>
              <ul className="fa-group-members-list">
                {members.map((m) => {
                  const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
                  return (
                    <li key={m.id}>
                      {(p?.displayName || p?.email || m.userId) + ` · ${m.roomRole}`}
                    </li>
                  );
                })}
              </ul>
              <div className="fa-modal-actions">
                <button
                  type="button"
                  className="fa-btn-secondary"
                  disabled={busy}
                  onClick={() => void leaveOrArchive()}
                >
                  {myMembership?.roomRole === 'owner' ? 'Archive group' : 'Leave group'}
                </button>
              </div>
              {manageError ? (
                <p className="fa-create-group-error" role="alert">
                  {manageError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
