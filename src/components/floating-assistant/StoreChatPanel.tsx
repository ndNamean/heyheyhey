import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import { nowIso } from '../../lib/utils';
import type { Profile, Store, StoreChatMessage } from '../../types';
import ProfileAvatarPreview from '../profileAvatar/ProfileAvatarPreview';
import FloatingAssistantLoader from './FloatingAssistantLoader';
import { useStoreChatRoom } from './useStoreChatRoom';
import type { ComposerVisualHandlers } from './useComposerVisualState';

export const STORE_CHAT_MAX_BODY = 2000;

interface Props {
  store: Store | null;
  profile: Profile;
  panelId: string;
  labelledBy: string;
  hidden: boolean;
  canSend: boolean;
  composerVisual: ComposerVisualHandlers;
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isDeleted(m: StoreChatMessage): boolean {
  return m.status === 'deleted' || Boolean(m.deletedAt);
}

function avatarFieldsForMessage(
  message: StoreChatMessage,
  isOwn: boolean,
  liveProfile: Profile,
): AvatarProfileFields {
  if (isOwn) return liveProfile;
  const sender = message.sender;
  if (sender) {
    return {
      displayName: sender.displayName,
      email: sender.email,
      userId: sender.userId,
      avatarUrl: sender.avatarUrl,
      avatarPath: sender.avatarPath,
      avatarFile: sender.avatarFile,
    };
  }
  return {
    displayName: message.senderNameSnapshot || 'Unknown',
    email: '',
    userId: message.senderUserId,
  };
}

function MessageBubble({
  message,
  isOwn,
  profile,
}: {
  message: StoreChatMessage;
  isOwn: boolean;
  profile: Profile;
}) {
  const avatarProfile = avatarFieldsForMessage(message, isOwn, profile);
  const rowClass = `fa-msg-row${isOwn ? ' fa-msg-row--own' : ''}`;

  if (isDeleted(message)) {
    if (!isOwn) return null;
    return (
      <div className={rowClass} data-msg-id={message.id}>
        <span className="fa-msg-avatar">
          <ProfileAvatarPreview profile={avatarProfile} size={28} previewEnabled />
        </span>
        <div className="fa-msg fa-msg--own fa-msg--deleted">
          <p className="fa-msg-deleted">Message deleted</p>
        </div>
      </div>
    );
  }

  const name = isOwn ? 'You' : message.senderNameSnapshot || 'Unknown';
  const role = message.senderRoleSnapshot?.trim();

  return (
    <div className={rowClass} data-msg-id={message.id}>
      <span className="fa-msg-avatar">
        <ProfileAvatarPreview profile={avatarProfile} size={28} previewEnabled />
      </span>
      <div className={`fa-msg${isOwn ? ' fa-msg--own' : ' fa-msg--other'}`}>
        <div className="fa-msg-meta">
          <span className="fa-msg-name">{name}</span>
          {role && !isOwn ? <span className="fa-msg-role">{role}</span> : null}
          <time className="fa-msg-time" dateTime={message.createdAt}>
            {formatMessageTime(message.createdAt)}
          </time>
        </div>
        <p className="fa-msg-body">{message.body}</p>
      </div>
    </div>
  );
}

export default function StoreChatPanel({
  store,
  profile,
  panelId,
  labelledBy,
  hidden,
  canSend,
  composerVisual,
}: Props) {
  const storeId = store?.id ?? null;
  const { messages, isLoading, error } = useStoreChatRoom(storeId);

  const draftsRef = useRef<Record<string, string>>({});
  const [draft, setDraft] = useState(() => (storeId ? draftsRef.current[storeId] ?? '' : ''));
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingLock = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevStoreId = useRef<string | null>(storeId);

  // Preserve draft per store when switching rooms.
  useEffect(() => {
    const prev = prevStoreId.current;
    if (prev && prev !== storeId) {
      draftsRef.current[prev] = draft;
    }
    prevStoreId.current = storeId;
    setDraft(storeId ? draftsRef.current[storeId] ?? '' : '');
    setSendError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to storeId
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    draftsRef.current[storeId] = draft;
  }, [draft, storeId]);

  // Stick to bottom on new messages while active.
  useEffect(() => {
    if (hidden || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, hidden, storeId]);

  const trimmed = draft.trim();
  const canSubmit =
    canSend && Boolean(storeId) && trimmed.length > 0 && !sending && !sendingLock.current;

  async function sendMessage() {
    if (hidden || !canSend || !storeId || !trimmed) return;
    if (sendingLock.current) return;

    sendingLock.current = true;
    setSending(true);
    setSendError(null);
    composerVisual.setSending();

    const body = trimmed.slice(0, STORE_CHAT_MAX_BODY);
    const msgId = id();
    const createdAt = nowIso();

    try {
      await db.transact(
        db.tx.storeChatMessages[msgId]
          .update({
            storeId,
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
          })
          .link({ store: storeId, sender: profile.id }),
      );
      setDraft('');
      if (storeId) draftsRef.current[storeId] = '';
      setSendError(null);
      composerVisual.setSuccess();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not send message. Try again.';
      setSendError(message);
      composerVisual.setFailure();
    } finally {
      sendingLock.current = false;
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (hidden) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    setSendError(null);
    if (!hidden) composerVisual.onInput();
  }

  const placeholder = !store
    ? 'Select a store to chat…'
    : !canSend
      ? 'View only — you cannot send in Store Chat'
      : 'Message this store…';

  const visibleMessages = messages.filter((m) => !isDeleted(m) || m.senderUserId === profile.userId);

  let bodyContent: ReactNode;
  if (!store) {
    bodyContent = (
      <div className="fa-store-chat-empty">
        <p className="fa-store-chat-empty-title">Store Chat</p>
        <p className="fa-store-chat-empty-body">Select an authorized store to open its room.</p>
      </div>
    );
  } else if (isLoading && messages.length === 0) {
    bodyContent = <FloatingAssistantLoader label="Loading messages…" />;
  } else if (error && messages.length === 0) {
    bodyContent = (
      <div className="fa-store-chat-empty" role="alert">
        <p className="fa-store-chat-empty-title">Couldn’t load chat</p>
        <p className="fa-store-chat-empty-body">
          {error.message || 'Check your connection and try again.'}
        </p>
      </div>
    );
  } else if (visibleMessages.length === 0) {
    bodyContent = (
      <div className="fa-store-chat-empty">
        <p className="fa-store-chat-empty-title">{store.code}</p>
        <p className="fa-store-chat-empty-body">No messages yet. Say hello to the store team.</p>
      </div>
    );
  } else {
    bodyContent = (
      <ul className="fa-msg-list" aria-live="polite">
        {visibleMessages.map((m) => (
          <li key={m.id}>
            <MessageBubble
              message={m}
              isOwn={m.senderUserId === profile.userId}
              profile={profile}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={hidden}
      className="fa-tab-panel fa-store-chat-panel"
      data-store-id={storeId ?? undefined}
    >
      <div className="fa-tab-panel-body fa-store-chat-messages" ref={listRef}>
        {bodyContent}
      </div>

      <form
        className="fa-composer fa-composer--store-chat"
        data-composer-enabled={canSend ? 'true' : 'false'}
        onSubmit={handleSubmit}
      >
        {sendError ? (
          <div className="fa-composer-error" role="alert">
            <span>{sendError}</span>
            <button type="button" className="fa-composer-retry" onClick={() => void sendMessage()}>
              Retry
            </button>
          </div>
        ) : null}
        {sending ? (
          <div className="fa-composer-status" aria-live="polite">
            <FloatingAssistantLoader label="Sending…" />
          </div>
        ) : null}
        <label className="sr-only" htmlFor="fa-store-chat-composer">
          Store chat message
        </label>
        <textarea
          id="fa-store-chat-composer"
          className="fa-composer-input"
          rows={2}
          disabled={hidden || !canSend || !store || sending}
          placeholder={placeholder}
          aria-disabled={hidden || !canSend || !store}
          maxLength={STORE_CHAT_MAX_BODY}
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
          onFocus={() => {
            if (!hidden) composerVisual.onFocus();
          }}
          onBlur={() => {
            if (!hidden) composerVisual.onBlur();
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="submit"
          className="fa-composer-send"
          disabled={hidden || !canSubmit}
          aria-disabled={hidden || !canSubmit}
        >
          Send
        </button>
      </form>
    </div>
  );
}
