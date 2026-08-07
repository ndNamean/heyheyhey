import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SELECTED_CHAT_ROOM_STORAGE_KEY,
  toChatRoomKey,
  migrateSelectedChatRoomKey,
  type ChatRoomRef,
} from '../../lib/chatRoomKeys';
import { groupChatApi } from '../../lib/groupChatApi';
import { canCreateCrossStoreGroupChat, canCreateGroupChat, canSendGroupChat } from '../../lib/roles';
import { useRoleDefinitions } from '../../contexts/RoleDefinitionsContext';
import type { Profile, Store } from '../../types';
import ChatsRoomList from './ChatsRoomList';
import ChatsRoomSelector from './ChatsRoomSelector';
import CreateGroupModal from './CreateGroupModal';
import GroupChatPanel from './GroupChatPanel';
import StoreChatPanel from './StoreChatPanel';
import { useGroupChatRoomsSummary } from './useGroupChatRoomsSummary';
import { useGroupChatUnread } from './useGroupChatUnread';
import type { ComposerVisualHandlers } from './useComposerVisualState';
import type { UnreadSenderSummary } from './useUnreadStoreChat';
import type { AssistantPanelMode } from './assistantPanelLayout';

interface Props {
  profile: Profile;
  stores: Store[];
  /** Knowledge / legacy store selection — updated when a store room is chosen. */
  selectedStoreId: string;
  onStoreChange: (storeId: string) => void;
  selectedStore: Store | null;
  storesLoading: boolean;
  canSendStore: boolean;
  composerVisual: ComposerVisualHandlers;
  panelId: string;
  labelledBy: string;
  hidden: boolean;
  mode: AssistantPanelMode;
  unreadByStore: Record<string, number>;
  unreadSendersByStore: Record<string, UnreadSenderSummary[]>;
  initialStoreChatMessageId: string;
  onInitialStoreChatMessageHandled: () => void;
  onConversationUnreadChange?: (conversationUnread: number) => void;
}

function readStoredRoom(legacyStoreId: string): ChatRoomRef | null {
  try {
    const raw = localStorage.getItem(SELECTED_CHAT_ROOM_STORAGE_KEY);
    return migrateSelectedChatRoomKey(legacyStoreId, raw);
  } catch {
    return migrateSelectedChatRoomKey(legacyStoreId, null);
  }
}

function writeStoredRoom(ref: ChatRoomRef | null) {
  try {
    if (!ref) localStorage.removeItem(SELECTED_CHAT_ROOM_STORAGE_KEY);
    else localStorage.setItem(SELECTED_CHAT_ROOM_STORAGE_KEY, toChatRoomKey(ref));
  } catch {
    /* ignore */
  }
}

export default function ChatsTabBody({
  profile,
  stores,
  selectedStoreId,
  onStoreChange,
  selectedStore,
  storesLoading,
  canSendStore,
  composerVisual,
  panelId,
  labelledBy,
  hidden,
  mode,
  unreadByStore,
  unreadSendersByStore,
  initialStoreChatMessageId,
  onInitialStoreChatMessageHandled,
  onConversationUnreadChange,
}: Props) {
  const { defs } = useRoleDefinitions();
  const [selected, setSelected] = useState<ChatRoomRef | null>(() =>
    readStoredRoom(selectedStoreId),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);

  const { rooms, memberships, pendingInvites, isLoading: groupsLoading } =
    useGroupChatRoomsSummary(profile.userId);

  const viewingGroupId =
    !hidden && selected?.kind === 'group' ? selected.id : null;

  const { unreadByRoom, unreadConversationCount } = useGroupChatUnread({
    memberships,
    currentUserId: profile.userId,
    viewingRoomId: viewingGroupId,
  });

  const storeUnreadConversations = useMemo(
    () => Object.values(unreadByStore).filter((n) => n > 0).length,
    [unreadByStore],
  );

  useEffect(() => {
    onConversationUnreadChange?.(
      storeUnreadConversations + unreadConversationCount + pendingInvites.length,
    );
  }, [
    storeUnreadConversations,
    unreadConversationCount,
    pendingInvites.length,
    onConversationUnreadChange,
  ]);

  const selectRoom = useCallback(
    (ref: ChatRoomRef) => {
      setSelected(ref);
      writeStoredRoom(ref);
      if (ref.kind === 'store') onStoreChange(ref.id);
    },
    [onStoreChange],
  );

  const fallbackAfterLeave = useCallback(() => {
    if (selectedStoreId) {
      selectRoom({ kind: 'store', id: selectedStoreId });
      return;
    }
    const first = stores[0];
    if (first) {
      selectRoom({ kind: 'store', id: first.id });
      return;
    }
    setSelected(null);
    writeStoredRoom(null);
  }, [selectedStoreId, stores, selectRoom]);

  useEffect(() => {
    if (!selected && selectedStoreId) {
      const ref: ChatRoomRef = { kind: 'store', id: selectedStoreId };
      setSelected(ref);
      writeStoredRoom(ref);
    }
  }, [selected, selectedStoreId]);

  const isCompact = mode === 'compact';

  const canCreate = canCreateGroupChat(profile.role, defs);
  const canCross = canCreateCrossStoreGroupChat(profile.role, defs);
  const canSendGroup =
    canSendGroupChat(profile.role, defs) && profile.role !== 'viewer';

  async function acceptInvite(inviteId: string) {
    setInviteBusyId(inviteId);
    try {
      const res = await groupChatApi<{ roomId: string }>('groupChatAccept', { inviteId });
      selectRoom({ kind: 'group', id: res.roomId });
    } catch {
      /* surfaced via list refresh */
    } finally {
      setInviteBusyId(null);
    }
  }

  async function declineInvite(inviteId: string) {
    setInviteBusyId(inviteId);
    try {
      await groupChatApi('groupChatDecline', { inviteId });
    } catch {
      /* ignore */
    } finally {
      setInviteBusyId(null);
    }
  }

  const roomsLoading = storesLoading || groupsLoading;

  return (
    <section
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={hidden}
      className={`fa-chats-body${isCompact ? ' is-compact' : ' is-split'}`}
    >
      {/* Always render one nav slot so conversation stays a stable sibling (mount contract). */}
      {isCompact ? (
        <div className="fa-chats-room-bar" hidden={hidden}>
          {roomsLoading ? (
            <p className="small">Loading chats…</p>
          ) : (
            <ChatsRoomSelector
              stores={stores}
              groups={rooms}
              pendingInvites={pendingInvites}
              selected={selected}
              onSelect={selectRoom}
              unreadByStore={unreadByStore}
              unreadSendersByStore={unreadSendersByStore}
              unreadByGroup={unreadByRoom}
              canCreate={canCreate}
              onCreateClick={() => setCreateOpen(true)}
              onAcceptInvite={(id) => void acceptInvite(id)}
              onDeclineInvite={(id) => void declineInvite(id)}
              inviteBusyId={inviteBusyId}
            />
          )}
        </div>
      ) : (
        <div className="fa-chats-pane fa-chats-pane--list" aria-label="Chat room list" hidden={hidden}>
          {roomsLoading ? (
            <p className="small">Loading chats…</p>
          ) : (
            <ChatsRoomList
              stores={stores}
              groups={rooms}
              pendingInvites={pendingInvites}
              selected={selected}
              onSelect={selectRoom}
              unreadByStore={unreadByStore}
              unreadSendersByStore={unreadSendersByStore}
              unreadByGroup={unreadByRoom}
              canCreate={canCreate}
              onCreateClick={() => setCreateOpen(true)}
              onAcceptInvite={(id) => void acceptInvite(id)}
              onDeclineInvite={(id) => void declineInvite(id)}
              inviteBusyId={inviteBusyId}
            />
          )}
        </div>
      )}

      <div
        className="fa-chats-pane fa-chats-pane--conversation"
        aria-label="Conversation"
        hidden={hidden}
      >
        {selected?.kind === 'group' ? (
          <GroupChatPanel
            roomId={selected.id}
            profile={profile}
            panelId={`${panelId}-group`}
            labelledBy={labelledBy}
            hidden={hidden}
            canSend={canSendGroup}
            composerVisual={composerVisual}
            showBack={false}
            onBack={fallbackAfterLeave}
          />
        ) : (
          <StoreChatPanel
            store={selectedStore}
            profile={profile}
            panelId={`${panelId}-store`}
            labelledBy={labelledBy}
            hidden={hidden}
            canSend={canSendStore}
            authorizedStores={stores}
            composerVisual={composerVisual}
            initialTargetMessageId={initialStoreChatMessageId}
            onInitialTargetHandled={onInitialStoreChatMessageHandled}
          />
        )}
      </div>

      <CreateGroupModal
        open={createOpen && !hidden}
        onClose={() => setCreateOpen(false)}
        profile={profile}
        authorizedStores={stores}
        canCrossStore={canCross}
        existingGroupNames={rooms.map((r) => r.name)}
        onCreated={(roomId) => selectRoom({ kind: 'group', id: roomId })}
      />
    </section>
  );
}
