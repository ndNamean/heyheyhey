// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, Store } from '../../types';

vi.mock('../../db', () => ({
  db: {
    useQuery: () => ({ data: null, isLoading: false, error: null }),
    transact: vi.fn(),
  },
}));

vi.mock('../../contexts/RoleDefinitionsContext', () => ({
  useRoleDefinitions: () => ({ defs: [], isLoading: false }),
}));

vi.mock('../../lib/groupChatApi', () => ({
  groupChatApi: vi.fn(),
}));

vi.mock('./useGroupChatRoomsSummary', () => ({
  useGroupChatRoomsSummary: () => ({
    rooms: [
      {
        id: 'g1',
        name: 'Ops huddle',
        description: '',
        icon: '',
        privacy: 'private',
        status: 'active',
        createdByUserId: 'u1',
        createdByProfileId: 'p1',
        createdAt: '',
        updatedAt: '',
        lastMessageAt: '',
        similarNameKey: 'ops huddle',
      },
    ],
    memberships: [],
    pendingInvites: [],
    membershipByRoomId: new Map(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('./useGroupChatUnread', () => ({
  useGroupChatUnread: () => ({
    unreadByRoom: {},
    unreadConversationCount: 0,
  }),
}));

vi.mock('./StoreChatPanel', () => ({
  default: ({ hidden }: { hidden: boolean }) => (
    <div data-testid="store-chat-panel" hidden={hidden}>
      StoreChat
    </div>
  ),
}));

vi.mock('./GroupChatPanel', () => ({
  default: ({ hidden }: { hidden: boolean }) => (
    <div data-testid="group-chat-panel" hidden={hidden}>
      GroupChat
    </div>
  ),
}));

vi.mock('./CreateGroupModal', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-group-modal">Create</div> : null,
}));

vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: () => null,
}));

import ChatsTabBody from './ChatsTabBody';

const profile = {
  id: 'p1',
  userId: 'u1',
  email: 'a@b.co',
  displayName: 'Ada',
  role: 'manager',
  approvalStatus: 'approved',
  approvedAt: '',
  approvedByEmail: '',
  createdAt: '',
  updatedAt: '',
} as Profile;

const stores: Store[] = [
  {
    id: 's1',
    code: 'A1',
    name: 'Alpha',
    address: '',
    area: '',
    lat: 0,
    lng: 0,
    geofenceRadiusM: 100,
    active: true,
    createdAt: '',
    updatedAt: '',
  },
];

const composerVisual = {
  onFocus: vi.fn(),
  onBlur: vi.fn(),
  onInput: vi.fn(),
  setSending: vi.fn(),
  setSuccess: vi.fn(),
  setFailure: vi.fn(),
  resetFlash: vi.fn(),
} as any;

function renderBody(mode: 'compact' | 'expanded' | 'focus', hidden = false) {
  return render(
    <ChatsTabBody
      profile={profile}
      stores={stores}
      selectedStoreId="s1"
      onStoreChange={vi.fn()}
      selectedStore={stores[0]}
      storesLoading={false}
      canSendStore
      composerVisual={composerVisual}
      panelId="fa-panel-store-chat"
      labelledBy="fa-tab-store-chat"
      hidden={hidden}
      mode={mode}
      unreadByStore={{}}
      unreadSendersByStore={{}}
      initialStoreChatMessageId=""
      onInitialStoreChatMessageHandled={vi.fn()}
    />,
  );
}

describe('ChatsTabBody room navigation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('compact: shows room selector and hides list pane', () => {
    renderBody('compact');

    expect(screen.getByRole('button', { name: /A1 · Alpha/ })).toBeTruthy();
    expect(document.getElementById('fa-chats-room-selector')).toBeTruthy();
    expect(screen.queryByLabelText('Chat room list')).toBeNull();
    expect(screen.getByTestId('store-chat-panel')).toBeTruthy();
    expect(screen.queryByLabelText('Back to chats')).toBeNull();
  });

  it('compact: New group opens from selector menu', () => {
    renderBody('compact');

    fireEvent.click(screen.getByRole('button', { name: /A1 · Alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ New group' }));

    expect(screen.getByTestId('create-group-modal')).toBeTruthy();
  });

  it('expanded: shows room selector and hides list pane', () => {
    renderBody('expanded');

    expect(screen.getByRole('button', { name: /A1 · Alpha/ })).toBeTruthy();
    expect(document.getElementById('fa-chats-room-selector')).toBeTruthy();
    expect(screen.queryByLabelText('Chat room list')).toBeNull();
    expect(screen.getByTestId('store-chat-panel')).toBeTruthy();
  });

  it('focus: shows room selector and hides list pane', () => {
    renderBody('focus');

    expect(document.getElementById('fa-chats-room-selector')).toBeTruthy();
    expect(screen.queryByLabelText('Chat room list')).toBeNull();
  });

  it('keeps conversation panels mounted when hidden (tab switch)', () => {
    const { rerender } = renderBody('compact', false);
    const storePanel = screen.getByTestId('store-chat-panel');

    rerender(
      <ChatsTabBody
        profile={profile}
        stores={stores}
        selectedStoreId="s1"
        onStoreChange={vi.fn()}
        selectedStore={stores[0]}
        storesLoading={false}
        canSendStore
        composerVisual={composerVisual}
        panelId="fa-panel-store-chat"
        labelledBy="fa-tab-store-chat"
        hidden
        mode="compact"
        unreadByStore={{}}
        unreadSendersByStore={{}}
        initialStoreChatMessageId=""
        onInitialStoreChatMessageHandled={vi.fn()}
      />,
    );

    expect(screen.getByTestId('store-chat-panel')).toBe(storePanel);
  });

  it('keeps conversation panels mounted across mode changes', () => {
    const { rerender } = renderBody('compact');
    const storePanel = screen.getByTestId('store-chat-panel');

    rerender(
      <ChatsTabBody
        profile={profile}
        stores={stores}
        selectedStoreId="s1"
        onStoreChange={vi.fn()}
        selectedStore={stores[0]}
        storesLoading={false}
        canSendStore
        composerVisual={composerVisual}
        panelId="fa-panel-store-chat"
        labelledBy="fa-tab-store-chat"
        hidden={false}
        mode="expanded"
        unreadByStore={{}}
        unreadSendersByStore={{}}
        initialStoreChatMessageId=""
        onInitialStoreChatMessageHandled={vi.fn()}
      />,
    );

    expect(screen.getByTestId('store-chat-panel')).toBe(storePanel);
    expect(document.getElementById('fa-chats-room-selector')).toBeTruthy();
    expect(screen.queryByLabelText('Chat room list')).toBeNull();
  });
});
