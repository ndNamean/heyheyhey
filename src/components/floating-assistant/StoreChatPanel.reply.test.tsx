// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreChatPanel from './StoreChatPanel';

const transactMock = vi.fn(async () => undefined);
const useQueryMock = vi.fn(() => ({ data: { profiles: [] } }));

vi.mock('@instantdb/react', () => ({ id: () => 'msg-new' }));
vi.mock('../../db', () => ({
  db: {
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    queryOnce: vi.fn(async () => ({ data: { storeChatMessages: [] } })),
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
          get: () => ({
            update: (value: Record<string, unknown>) => ({
              link: () => ({ type: 'reactionTx', value }),
            }),
            delete: () => ({ type: 'reactionDelete' }),
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
vi.mock('./useStoreChatRoom', () => ({
  useStoreChatRoom: () => ({
    messages: currentMessages,
    reactions: [],
    reactionsByMessageId: new Map(),
    reactionGroupsByMessageId: new Map(),
    giphyReactionGroupsByMessageId: new Map(),
    bookmarks: [],
    bookmarkByMessageId: new Map(),
    isLoading: false,
    error: null,
  }),
}));

let currentMessages: Array<Record<string, any>> = [];

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

describe('StoreChatPanel reply flow', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
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
      {
        id: 'm2',
        storeId: 's1',
        senderUserId: 'me',
        senderProfileId: 'p-me',
        senderNameSnapshot: 'Me',
        senderRoleSnapshot: 'manager',
        messageType: 'text',
        body: 'Replying here',
        createdAt: '2026-08-04T00:01:00.000Z',
        editedAt: '',
        deletedAt: '',
        status: 'active',
        replyToMessageId: 'm1',
      },
      {
        id: 'm3',
        storeId: 's1',
        senderUserId: 'u2',
        senderProfileId: 'p2',
        senderNameSnapshot: 'Bob',
        senderRoleSnapshot: 'staff',
        messageType: 'text',
        body: 'Orphan reply',
        createdAt: '2026-08-04T00:02:00.000Z',
        editedAt: '',
        deletedAt: '',
        status: 'active',
        replyToMessageId: 'missing-parent',
      },
    ];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('opens reply preview and sends replyToMessageId', async () => {
    renderPanel();

    fireEvent.click(screen.getAllByRole('button', { name: /Reply to/i })[0]);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getAllByText(/Replying to Alice/i).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Store chat message'), { target: { value: 'Thanks!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await act(async () => undefined);
    expect(transactMock).toHaveBeenCalledTimes(1);
    const [txs] = transactMock.mock.calls[0];
    expect(txs[0].value.replyToMessageId).toBe('m1');
  });

  it('renders quote block with missing-parent fallback', () => {
    renderPanel();
    expect(screen.getAllByText('Replying to Alice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hello world').length).toBeGreaterThan(0);
    expect(screen.getByText('Replying to missing message')).toBeTruthy();
    expect(screen.getByText('Original message unavailable')).toBeTruthy();
  });

  it('supports keyboard reply and initial target highlight handling', () => {
    const handled = vi.fn();
    renderPanel({ initialTargetMessageId: 'm1', onInitialTargetHandled: handled });
    expect(handled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();

    const row = document.querySelector('[data-msg-id="m1"]') as HTMLElement;
    fireEvent.keyDown(row, { key: 'r' });
    expect(screen.getAllByText(/Replying to Alice/i).length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(1800);
    });
  });

  it('opens reply preview when initialTargetMessageId and initialStartReply', () => {
    const handled = vi.fn();
    renderPanel({
      initialTargetMessageId: 'm1',
      initialStartReply: true,
      onInitialTargetHandled: handled,
    });
    expect(handled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getAllByText(/Replying to Alice/i).length).toBeGreaterThan(0);
  });

  it('does not auto-reply for mention-style focus without initialStartReply', () => {
    const handled = vi.fn();
    renderPanel({ initialTargetMessageId: 'm1', onInitialTargetHandled: handled });
    expect(handled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
