// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreChatPanel from './StoreChatPanel';

const transactMock = vi.fn(async () => undefined);
const useQueryMock = vi.fn(() => ({ data: { profiles: [] } }));
const messageUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: (links: Record<string, unknown>) => ({ type: 'messageTx', value, links }),
  value,
}));
const bookmarkUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: (links: Record<string, unknown>) => ({ type: 'bookmarkTx', value, links }),
}));
const bookmarkDeleteMock = vi.fn(() => ({ type: 'bookmarkDelete' }));
const softDeleteUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  type: 'softDelete',
  value,
}));

let idCounter = 0;
vi.mock('@instantdb/react', () => ({
  id: () => {
    idCounter += 1;
    return `id-${idCounter}`;
  },
}));
vi.mock('../../db', () => ({
  db: {
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    transact: (...args: unknown[]) => transactMock(...args),
    tx: {
      storeChatMessages: new Proxy(
        {},
        {
          get: (_target, prop: string) => ({
            update: (value: Record<string, unknown>) => {
              if (value.status === 'deleted') {
                return softDeleteUpdateMock(value);
              }
              return messageUpdateMock(value);
            },
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
      storeChatBookmarks: new Proxy(
        {},
        {
          get: (_target, prop: string) => ({
            update: bookmarkUpdateMock,
            delete: () => bookmarkDeleteMock(prop),
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
vi.mock('../../lib/storeChatTranslation', async () => {
  const actual = await vi.importActual<typeof import('../../lib/storeChatTranslation')>(
    '../../lib/storeChatTranslation',
  );
  return {
    ...actual,
    isStoreChatTranslationEnabled: () => translationFlag,
    probeStoreChatTranslationCapability: async () =>
      translationFlag
        ? { configured: true, status: 'ready' as const }
        : { configured: false, status: 'unsupported' as const },
    runStoreChatTranslation: async (
      params: { text: string; targetLang: string },
      onState: (state: any) => void,
    ) => {
      onState({
        status: 'loading',
        originalText: params.text,
        translatedText: null,
        targetLang: params.targetLang,
        sourceLang: null,
        errorMessage: null,
        showingOriginal: false,
      });
      const next = {
        status: 'success',
        originalText: params.text,
        translatedText: `ES:${params.text}`,
        targetLang: params.targetLang,
        sourceLang: null,
        errorMessage: null,
        showingOriginal: false,
      };
      onState(next);
      return next;
    },
  };
});
vi.mock('../profileAvatar/ProfileAvatar', () => ({
  default: () => <span data-testid="avatar" />,
}));
vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: () => <span data-testid="avatar-preview" />,
}));

let translationFlag = false;
let currentMessages: Array<Record<string, any>> = [];
let currentBookmarkByMessageId = new Map<string, any>();

vi.mock('./useStoreChatRoom', () => ({
  useStoreChatRoom: () => ({
    messages: currentMessages,
    reactions: [],
    reactionsByMessageId: new Map(),
    reactionGroupsByMessageId: new Map(),
    bookmarks: [],
    bookmarkByMessageId: currentBookmarkByMessageId,
    giphyReactionGroupsByMessageId: new Map(),
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

const storeTwo = {
  ...store,
  id: 's2',
  code: 'S2',
  name: 'Store Two',
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

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
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
    forwardedFromMessageId: '',
    forwardedFromUserId: '',
    ...overrides,
  };
}

function renderPanel(props?: Partial<ComponentProps<typeof StoreChatPanel>>) {
  return render(
    <StoreChatPanel
      store={store}
      profile={profile as any}
      panelId="panel"
      labelledBy="label"
      hidden={false}
      canSend
      authorizedStores={[store, storeTwo]}
      composerVisual={composerVisual}
      {...props}
    />,
  );
}

describe('StoreChatPanel message actions', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
    idCounter = 0;
    translationFlag = false;
    currentBookmarkByMessageId = new Map();
    currentMessages = [baseMessage()];
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('shows desktop More menu with copy/forward/favorite/delete for own message', () => {
    currentMessages = [baseMessage({ senderUserId: 'me', senderProfileId: 'p-me' })];
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    const menu = screen.getByRole('menu', { name: /More message actions/i });
    expect(within(menu).getByRole('menuitem', { name: 'Copy' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Forward' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Favorite' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Translate' })).toBeNull();
  });

  it('copies message body and announces via live region', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    await act(async () => undefined);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello world');
    expect(screen.getByText('Message copied')).toBeTruthy();
  });

  it('supports keyboard copy shortcut and Escape closes more menu', () => {
    renderPanel();
    const row = document.querySelector('[data-msg-id="m1"]') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(row, { key: 'c' });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello world');
  });

  it('favorites and unfavorites via bookmark entity', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Favorite' }));
    await act(async () => undefined);
    expect(bookmarkUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 's1',
        messageId: 'm1',
        userId: 'me',
      }),
    );

    currentBookmarkByMessageId = new Map([
      ['m1', { id: 'bm1', storeId: 's1', messageId: 'm1', userId: 'me', createdAt: 't' }],
    ]);
    cleanup();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove favorite' }));
    await act(async () => undefined);
    expect(bookmarkDeleteMock).toHaveBeenCalledWith('bm1');
  });

  it('forwards into an authorized store without impersonating author', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forward' }));
    fireEvent.click(screen.getByRole('button', { name: /S2 · Store Two/i }));
    await act(async () => undefined);

    expect(messageUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 's2',
        senderUserId: 'me',
        senderProfileId: 'p-me',
        body: 'Hello world',
        forwardedFromMessageId: 'm1',
        forwardedFromUserId: 'u1',
        replyToMessageId: '',
        mentionAll: false,
      }),
    );
  });

  it('soft-deletes own messages only', async () => {
    currentMessages = [baseMessage({ senderUserId: 'me', senderProfileId: 'p-me' })];
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await act(async () => undefined);
    expect(softDeleteUpdateMock).toHaveBeenCalledWith({
      status: 'deleted',
      deletedAt: '2026-08-04T00:00:00.000Z',
    });
  });

  it('opens mobile action sheet from coarse-pointer More and closes on Escape', () => {
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      matches: true,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    expect(screen.getByRole('dialog', { name: 'Message actions' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Message actions' })).toBeNull();
  });

  it('wires Translate when flag+probe are ready and supports show original', async () => {
    translationFlag = true;
    renderPanel();
    await act(async () => undefined);

    fireEvent.click(screen.getByRole('button', { name: /More actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Translate' }));
    await act(async () => undefined);

    expect(screen.getByText('ES:Hello world')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('preserves reply strip and react tray alongside More', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /Reply to Alice/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /React to Alice/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /More actions/i })).toBeTruthy();
  });
});
