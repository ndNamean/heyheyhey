// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreChatPanel from './StoreChatPanel';

const transactMock = vi.fn(async () => undefined);
const useQueryMock = vi.fn(() => ({ data: { profiles: [] } }));
const deleteMock = vi.fn(() => ({ type: 'reactionDelete' }));
const reactionUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: (links: Record<string, unknown>) => ({ type: 'reactionTx', value, links }),
}));

vi.mock('@instantdb/react', () => ({ id: () => 'reaction-new' }));
vi.mock('../../db', () => ({
  db: {
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    transact: (...args: unknown[]) => transactMock(...args),
    tx: {
      storeChatMessages: new Proxy(
        {},
        {
          get: () => ({
            update: (value: Record<string, unknown>) => ({
              link: () => ({ type: 'messageTx', value }),
            }),
          }),
        },
      ),
      storeChatReactions: new Proxy(
        {},
        {
          get: (_target, prop: string) => ({
            update: reactionUpdateMock,
            delete: () => deleteMock(prop),
          }),
        },
      ),
    },
  },
}));
vi.mock('../../lib/utils', () => ({ nowIso: () => '2026-08-04T00:00:00.000Z' }));
vi.mock('../../lib/notifications', () => ({
  buildStoreChatMentionNotifications: () => [],
}));
vi.mock('../../i18n', async () => {
  const { mockUseLang } = await import('./storeChatTestI18n');
  return { useLang: () => mockUseLang() };
});
vi.mock('../profileAvatar/ProfileAvatar', () => ({
  default: () => <span data-testid="avatar" />,
}));
vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: () => <span data-testid="avatar-preview" />,
}));

let currentMessages: Array<Record<string, any>> = [];
let currentReactionsByMessageId = new Map<string, any[]>();
let currentReactionGroupsByMessageId = new Map<string, any[]>();

vi.mock('./useStoreChatRoom', () => ({
  useStoreChatRoom: () => ({
    messages: currentMessages,
    reactions: [],
    reactionsByMessageId: currentReactionsByMessageId,
    reactionGroupsByMessageId: currentReactionGroupsByMessageId,
    giphyReactionGroupsByMessageId: new Map(),
    bookmarks: [],
    bookmarkByMessageId: new Map(),
    isLoading: false,
    error: null,
  }),
}));

const profile = {
  id: 'p-me',
  userId: 'me',
  email: 'me@example.com',
  displayName: 'Me',
  role: 'manager',
  approvalStatus: 'approved',
  approvedAt: '',
  approvedByEmail: '',
  createdAt: '',
  updatedAt: '',
};

const store = {
  id: 's1',
  code: 'S1',
  name: 'Store One',
  address: '',
  area: '',
  lat: 0,
  lng: 0,
  geofenceRadiusM: 0,
  active: true,
  createdAt: '',
  updatedAt: '',
};

const composerVisual = {
  onFocus: vi.fn(),
  onBlur: vi.fn(),
  onInput: vi.fn(),
  setSending: vi.fn(),
  setSuccess: vi.fn(),
  setFailure: vi.fn(),
  resetFlash: vi.fn(),
};

function renderPanel(props?: Partial<ComponentProps<typeof StoreChatPanel>>) {
  return render(
    <StoreChatPanel
      store={store}
      profile={profile as any}
      panelId="panel"
      labelledBy="label"
      hidden={false}
      canSend
      composerVisual={composerVisual}
      {...props}
    />,
  );
}

describe('StoreChatPanel unicode reactions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentMessages = [
      {
        id: 'm1',
        storeId: 's1',
        senderUserId: 'u1',
        senderProfileId: 'p1',
        senderNameSnapshot: 'Alice',
        senderRoleSnapshot: 'staff',
        messageType: 'text',
        body: 'Hello world',
        createdAt: '2026-08-04T00:00:00.000Z',
        editedAt: '',
        deletedAt: '',
        status: 'active',
        replyToMessageId: '',
      },
    ];
    currentReactionsByMessageId = new Map([
      [
        'm1',
        [
          {
            id: 'r-existing',
            storeId: 's1',
            messageId: 'm1',
            userId: 'u1',
            reactionType: 'unicode',
            unicode: '👍',
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            createdAt: '2026-08-04T00:00:10.000Z',
            clientMutationId: 'c1',
          },
        ],
      ],
    ]);
    currentReactionGroupsByMessageId = new Map([
      [
        'm1',
        [
          {
            unicode: '👍',
            count: 1,
            userIds: ['u1'],
            reactedByMe: false,
            myReactionId: null,
            reactions: currentReactionsByMessageId.get('m1'),
          },
        ],
      ],
    ]);
  });

  it('adds a unicode reaction from the quick tray', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /React to Alice/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add ❤️ reaction/i }));

    await act(async () => undefined);
    expect(transactMock).toHaveBeenCalledTimes(1);
    expect(reactionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 's1',
        messageId: 'm1',
        userId: 'me',
        reactionType: 'unicode',
        unicode: '❤️',
        giphyId: '',
      }),
    );
  });

  it('removes own reaction when chip is toggled', async () => {
    currentReactionsByMessageId = new Map([
      [
        'm1',
        [
          {
            id: 'r-mine',
            storeId: 's1',
            messageId: 'm1',
            userId: 'me',
            reactionType: 'unicode',
            unicode: '👍',
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            createdAt: '2026-08-04T00:00:10.000Z',
            clientMutationId: 'c-mine',
          },
        ],
      ],
    ]);
    currentReactionGroupsByMessageId = new Map([
      [
        'm1',
        [
          {
            unicode: '👍',
            count: 1,
            userIds: ['me'],
            reactedByMe: true,
            myReactionId: 'r-mine',
            reactions: currentReactionsByMessageId.get('m1'),
          },
        ],
      ],
    ]);

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /👍, 1 reaction/i }));
    await act(async () => undefined);

    expect(transactMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith('r-mine');
  });

  it('opens who-reacted viewer and keeps reply keyboard shortcut', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Who reacted/i }));
    const whoRegion = screen.getByRole('region', { name: /Who reacted/i });
    expect(whoRegion).toBeTruthy();
    expect(whoRegion.querySelector('.fa-who-reacted-names')?.textContent).toBe('Alice');

    const row = document.querySelector('[data-msg-id="m1"]') as HTMLElement;
    fireEvent.keyDown(row, { key: 'r' });
    expect(screen.getAllByText(/Replying to Alice/i).length).toBeGreaterThan(0);
  });

  it('supports keyboard traversal across quick tray buttons', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /React to Alice/i }));

    const first = screen.getByRole('button', { name: /Add 👍 reaction/i });
    const second = screen.getByRole('button', { name: /Add ❤️ reaction/i });
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab' });
    second.focus();
    expect(document.activeElement).toBe(second);
  });
});
