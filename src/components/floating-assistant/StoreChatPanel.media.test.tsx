// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreChatPanel from './StoreChatPanel';

const messageUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: () => ({ type: 'messageTx', value }),
}));
const reactionUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: () => ({ type: 'reactionTx', value }),
}));
const deleteMock = vi.fn(() => ({ type: 'reactionDelete' }));
const transactMock = vi.fn(async () => undefined);
const useQueryMock = vi.fn(() => ({ data: { profiles: [] } }));

vi.mock('@instantdb/react', () => ({ id: () => 'generated-id' }));
vi.mock('../../db', () => ({
  db: {
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    transact: (...args: unknown[]) => transactMock(...args),
    tx: {
      storeChatMessages: new Proxy(
        {},
        {
          get: () => ({
            update: messageUpdateMock,
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
vi.mock('../../lib/giphyClient', async () => {
  const actual = await vi.importActual<typeof import('../../lib/giphyClient')>(
    '../../lib/giphyClient',
  );
  return {
    ...actual,
    isGiphyConfigured: () => true,
  };
});
vi.mock('./GiphyPicker', () => ({
  GiphyPicker: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (item: {
      id: string;
      kind: 'gif';
      title: string;
      width: number;
      height: number;
      url: string;
      previewUrl: string;
      username: string;
      itemUrl: string;
    }) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onSelect({
            id: 'gif-abc',
            kind: 'gif',
            title: 'Celebration',
            width: 200,
            height: 150,
            url: 'https://media.giphy.com/media/gif-abc/200.gif',
            previewUrl: 'https://media.giphy.com/media/gif-abc/100.gif',
            username: 'tester',
            itemUrl: 'https://giphy.com/gifs/gif-abc',
          })
        }
      >
        Confirm staged GIF
      </button>
    ) : null,
}));
vi.mock('./GiphyMediaPreview', () => ({
  GiphyMediaPreview: ({
    item,
    onClear,
  }: {
    item: { title: string };
    onClear?: () => void;
  }) => (
    <div role="group" aria-label="GIF preview">
      <span>{item.title}</span>
      {onClear ? (
        <button type="button" aria-label="Remove GIF" onClick={onClear}>
          ×
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock('./AmbientGlowMedia', () => ({
  AmbientGlowMedia: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../profileAvatar/ProfileAvatar', () => ({
  default: () => <span data-testid="avatar" />,
}));
vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: () => <span data-testid="avatar-preview" />,
}));

let currentMessages: Array<Record<string, any>> = [];
let currentReactionsByMessageId = new Map<string, any[]>();
let currentReactionGroupsByMessageId = new Map<string, any[]>();
let currentGiphyReactionGroupsByMessageId = new Map<string, any[]>();

vi.mock('./useStoreChatRoom', () => ({
  useStoreChatRoom: () => ({
    messages: currentMessages,
    reactions: [],
    reactionsByMessageId: currentReactionsByMessageId,
    reactionGroupsByMessageId: currentReactionGroupsByMessageId,
    giphyReactionGroupsByMessageId: currentGiphyReactionGroupsByMessageId,
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

describe('StoreChatPanel GIPHY media + reaction wiring', () => {
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
        giphyId: '',
        giphyUrl: '',
      },
      {
        id: 'm-gif',
        storeId: 's1',
        senderUserId: 'u1',
        senderProfileId: 'p1',
        senderNameSnapshot: 'Alice',
        senderRoleSnapshot: 'staff',
        messageType: 'giphy_media',
        body: '',
        createdAt: '2026-08-04T00:01:00.000Z',
        editedAt: '',
        deletedAt: '',
        status: 'active',
        replyToMessageId: '',
        giphyId: 'existing-gif',
        giphyKind: 'gif',
        giphyTitle: 'Existing',
        giphyWidth: '200',
        giphyHeight: '150',
        giphyUrl: 'https://media.giphy.com/media/existing-gif/200.gif',
        giphyPreviewUrl: 'https://media.giphy.com/media/existing-gif/100.gif',
      },
    ];
    currentReactionsByMessageId = new Map();
    currentReactionGroupsByMessageId = new Map();
    currentGiphyReactionGroupsByMessageId = new Map();
  });

  it('writes empty giphy defaults on text-only send', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Store chat message/i), {
      target: { value: 'plain text' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    await act(async () => undefined);

    expect(messageUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'text',
        body: 'plain text',
        giphyId: '',
        giphyUrl: '',
        giphyPreviewUrl: '',
        clientMutationId: 'generated-id',
        forwardedFromMessageId: '',
      }),
    );
  });

  it('stages GIPHY selection then sends media payload and clears preview', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Add GIF/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm staged GIF/i }));
    expect(screen.getByRole('group', { name: /GIF preview/i })).toBeTruthy();
    expect(screen.getByText('Celebration')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));
    await act(async () => undefined);

    expect(messageUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'giphy_media',
        body: '',
        giphyId: 'gif-abc',
        giphyKind: 'gif',
        giphyTitle: 'Celebration',
        giphyUrl: 'https://media.giphy.com/media/gif-abc/200.gif',
        giphyPreviewUrl: 'https://media.giphy.com/media/gif-abc/100.gif',
        clientMutationId: 'generated-id',
      }),
    );
    expect(screen.queryByRole('group', { name: /GIF preview/i })).toBeNull();
  });

  it('renders giphy media in the message list', () => {
    renderPanel();
    const img = document.querySelector('img.fa-msg-giphy') as HTMLImageElement | null;
    expect(img?.src).toContain('existing-gif');
    expect(img?.alt).toBe('Existing');
  });

  it('adds a giphy reaction from on-demand picker', async () => {
    renderPanel();
    const reactButtons = screen.getAllByRole('button', { name: /React to Alice/i });
    fireEvent.click(reactButtons[0]!);
    fireEvent.click(screen.getByRole('button', { name: /Search GIPHY reactions/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm staged GIF/i }));
    await act(async () => undefined);

    expect(reactionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reactionType: 'giphy',
        unicode: '',
        giphyId: 'gif-abc',
        giphyUrl: 'https://media.giphy.com/media/gif-abc/200.gif',
        messageId: 'm1',
        userId: 'me',
      }),
    );
  });

  it('toggles off own giphy reaction chip with rollback-safe lock', async () => {
    currentReactionsByMessageId = new Map([
      [
        'm1',
        [
          {
            id: 'r-gif-mine',
            storeId: 's1',
            messageId: 'm1',
            userId: 'me',
            reactionType: 'giphy',
            unicode: '',
            giphyId: 'gif-abc',
            giphyKind: 'gif',
            giphyTitle: 'Celebration',
            giphyUrl: 'https://media.giphy.com/media/gif-abc/200.gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/gif-abc/100.gif',
            createdAt: '2026-08-04T00:00:10.000Z',
            clientMutationId: 'c-gif',
          },
        ],
      ],
    ]);
    currentGiphyReactionGroupsByMessageId = new Map([
      [
        'm1',
        [
          {
            giphyId: 'gif-abc',
            giphyKind: 'gif',
            giphyTitle: 'Celebration',
            giphyUrl: 'https://media.giphy.com/media/gif-abc/200.gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/gif-abc/100.gif',
            count: 1,
            userIds: ['me'],
            reactedByMe: true,
            myReactionId: 'r-gif-mine',
            reactions: currentReactionsByMessageId.get('m1'),
          },
        ],
      ],
    ]);

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Celebration, 1 reaction/i }));
    await act(async () => undefined);

    expect(deleteMock).toHaveBeenCalledWith('r-gif-mine');
  });
});
