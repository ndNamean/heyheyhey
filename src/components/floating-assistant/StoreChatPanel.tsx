import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import {
  buildMentionCandidates,
  buildMentionMenuItems,
  expandMentionRecipients,
  getActiveMentionQuery,
  insertMentionToken,
  MENTION_ALL_TOKEN,
  parseMentionedUserIdsJson,
  resolveMentionPayload,
  segmentMentionBody,
  serializeMentionedUserIds,
  type MentionCandidate,
  type MentionMenuItem,
  type SelectedMention,
} from '../../lib/storeChatMentions';
import {
  buildStoreChatMentionNotifications,
} from '../../lib/notifications';
import { nowIso } from '../../lib/utils';
import type { Profile, Store, StoreChatMessage } from '../../types';
import ProfileAvatar from '../profileAvatar/ProfileAvatar';
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

function MentionBody({
  body,
  mentionedUserIdsJson,
  mentionAll,
  candidates,
}: {
  body: string;
  mentionedUserIdsJson?: string;
  mentionAll?: boolean;
  candidates: MentionCandidate[];
}) {
  const mentionedIds = parseMentionedUserIdsJson(mentionedUserIdsJson);
  const segments = segmentMentionBody(body, mentionedIds, Boolean(mentionAll), candidates);
  return (
    <p className="fa-msg-body">
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <span key={`m-${i}`} className="fa-msg-mention">
            {seg.value}
          </span>
        ) : (
          <span key={`t-${i}`}>{seg.value}</span>
        ),
      )}
    </p>
  );
}

function MessageBubble({
  message,
  isOwn,
  profile,
  candidates,
}: {
  message: StoreChatMessage;
  isOwn: boolean;
  profile: Profile;
  candidates: MentionCandidate[];
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
        <MentionBody
          body={message.body}
          mentionedUserIdsJson={message.mentionedUserIdsJson}
          mentionAll={message.mentionAll}
          candidates={candidates}
        />
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

  const { data: mentionData } = db.useQuery(
    storeId
      ? {
          profiles: {
            stores: {},
            avatarFile: {},
          },
        }
      : null,
  );

  const roomMembers = useMemo(() => {
    if (!storeId) return [] as MentionCandidate[];
    const profiles = (mentionData?.profiles ?? []) as Profile[];
    return buildMentionCandidates(profiles, storeId, '');
  }, [mentionData?.profiles, storeId]);

  const mentionCandidates = useMemo(
    () => roomMembers.filter((c) => c.userId !== profile.userId),
    [roomMembers, profile.userId],
  );

  const draftsRef = useRef<Record<string, string>>({});
  const [draft, setDraft] = useState(() => (storeId ? draftsRef.current[storeId] ?? '' : ''));
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingLock = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevStoreId = useRef<string | null>(storeId);

  const [trackedMentions, setTrackedMentions] = useState<SelectedMention[]>([]);
  const [mentionAllTracked, setMentionAllTracked] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caret, setCaret] = useState(0);

  const activeMention = useMemo(
    () => (mentionOpen ? getActiveMentionQuery(draft, caret) : null),
    [mentionOpen, draft, caret],
  );

  const menuItems = useMemo(() => {
    if (!activeMention) return [] as MentionMenuItem[];
    return buildMentionMenuItems(mentionCandidates, activeMention.query);
  }, [activeMention, mentionCandidates]);

  // Preserve draft per store when switching rooms.
  useEffect(() => {
    const prev = prevStoreId.current;
    if (prev && prev !== storeId) {
      draftsRef.current[prev] = draft;
    }
    prevStoreId.current = storeId;
    setDraft(storeId ? draftsRef.current[storeId] ?? '' : '');
    setSendError(null);
    setTrackedMentions([]);
    setMentionAllTracked(false);
    setMentionOpen(false);
    setMentionIndex(0);
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

  useEffect(() => {
    if (mentionIndex >= menuItems.length) {
      setMentionIndex(Math.max(0, menuItems.length - 1));
    }
  }, [menuItems.length, mentionIndex]);

  const trimmed = draft.trim();
  const canSubmit =
    canSend && Boolean(storeId) && trimmed.length > 0 && !sending && !sendingLock.current;

  function syncCaretFromTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    setCaret(el.selectionStart ?? 0);
  }

  function refreshMentionState(nextDraft: string, nextCaret: number) {
    const active = getActiveMentionQuery(nextDraft, nextCaret);
    if (active && canSend) {
      setMentionOpen(true);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
    setCaret(nextCaret);
  }

  function applyMentionItem(item: MentionMenuItem) {
    const el = textareaRef.current;
    const currentCaret = el?.selectionStart ?? caret;
    const label = item.kind === 'all' ? MENTION_ALL_TOKEN : item.candidate.label;
    const result = insertMentionToken(draft, currentCaret, label);
    if (!result) return;

    setDraft(result.text);
    setSendError(null);
    if (!hidden) composerVisual.onInput();

    if (item.kind === 'all') {
      setMentionAllTracked(true);
    } else {
      setTrackedMentions((prev) => {
        if (prev.some((m) => m.userId === item.candidate.userId)) return prev;
        return [...prev, { userId: item.candidate.userId, label: item.candidate.label }];
      });
    }

    setMentionOpen(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(result.caret, result.caret);
      setCaret(result.caret);
    });
  }

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
    const resolved = resolveMentionPayload(
      body,
      trackedMentions,
      mentionAllTracked,
      mentionCandidates,
    );
    const recipientIds = expandMentionRecipients(
      resolved.mentionedUserIds,
      resolved.mentionAll,
      mentionCandidates,
      profile.userId,
    );

    const messageTx = db.tx.storeChatMessages[msgId]
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
        mentionedUserIdsJson: serializeMentionedUserIds(resolved.mentionedUserIds),
        mentionAll: resolved.mentionAll,
      })
      .link({ store: storeId, sender: profile.id });

    const notifTxs =
      recipientIds.length > 0
        ? buildStoreChatMentionNotifications({
            messageId: msgId,
            storeId,
            storeLabel: store ? `${store.code} · ${store.name}` : storeId,
            body,
            actor: profile,
            recipientUserIds: recipientIds,
            mentionAll: resolved.mentionAll,
          })
        : [];

    try {
      await db.transact([messageTx, ...notifTxs]);
      setDraft('');
      if (storeId) draftsRef.current[storeId] = '';
      setTrackedMentions([]);
      setMentionAllTracked(false);
      setMentionOpen(false);
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

    if (mentionOpen && menuItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % menuItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + menuItems.length) % menuItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = menuItems[mentionIndex];
        if (item) applyMentionItem(item);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    setSendError(null);
    if (!hidden) composerVisual.onInput();
    const el = textareaRef.current;
    const nextCaret = el?.selectionStart ?? value.length;
    refreshMentionState(value, nextCaret);
  }

  const placeholder = !store
    ? 'Select a store to chat…'
    : !canSend
      ? 'View only — you cannot send in Store Chat'
      : 'Message this store… (@ to mention)';

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
              candidates={roomMembers}
            />
          </li>
        ))}
      </ul>
    );
  }

  const showMentionMenu = Boolean(canSend && mentionOpen && activeMention && menuItems.length > 0);

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

        <div className="fa-composer-input-wrap">
          {showMentionMenu ? (
            <ul className="fa-mention-menu" role="listbox" aria-label="Mention suggestions">
              {menuItems.map((item, i) => {
                const selected = i === mentionIndex;
                if (item.kind === 'all') {
                  return (
                    <li key="all" role="option" aria-selected={selected}>
                      <button
                        type="button"
                        className={`fa-mention-option${selected ? ' fa-mention-option--active' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyMentionItem(item);
                        }}
                      >
                        <span className="fa-mention-option-avatar fa-mention-option-avatar--all">
                          @
                        </span>
                        <span className="fa-mention-option-text">
                          <span className="fa-mention-option-name">Everyone</span>
                          <span className="fa-mention-option-meta">@all · notify this room</span>
                        </span>
                      </button>
                    </li>
                  );
                }
                const c = item.candidate;
                return (
                  <li key={c.userId} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={`fa-mention-option${selected ? ' fa-mention-option--active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyMentionItem(item);
                      }}
                    >
                      <span className="fa-mention-option-avatar">
                        <ProfileAvatar profile={c.profile} size={24} />
                      </span>
                      <span className="fa-mention-option-text">
                        <span className="fa-mention-option-name">{c.label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <label className="sr-only" htmlFor="fa-store-chat-composer">
            Store chat message
          </label>
          <textarea
            id="fa-store-chat-composer"
            ref={textareaRef}
            className="fa-composer-input"
            rows={2}
            disabled={hidden || !canSend || !store || sending}
            placeholder={placeholder}
            aria-disabled={hidden || !canSend || !store}
            aria-autocomplete="list"
            aria-expanded={showMentionMenu}
            maxLength={STORE_CHAT_MAX_BODY}
            value={draft}
            onChange={(e) => updateDraft(e.target.value)}
            onClick={() => {
              syncCaretFromTextarea();
              const el = textareaRef.current;
              if (el) refreshMentionState(draft, el.selectionStart ?? 0);
            }}
            onSelect={() => {
              syncCaretFromTextarea();
              const el = textareaRef.current;
              if (el) refreshMentionState(draft, el.selectionStart ?? 0);
            }}
            onFocus={() => {
              if (!hidden) composerVisual.onFocus();
            }}
            onBlur={() => {
              if (!hidden) composerVisual.onBlur();
              // Delay so option mousedown can fire first.
              window.setTimeout(() => setMentionOpen(false), 150);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
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
