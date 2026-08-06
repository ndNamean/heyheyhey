// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreChatPanel from './StoreChatPanel';
import { OPEN_LOGBOOK_EVENT } from '../../lib/logbookDeepLink';

const transactMock = vi.fn(async () => undefined);
const useQueryMock = vi.fn(() => ({ data: { profiles: [] } }));

vi.mock('@instantdb/react', () => ({ id: () => 'msg-new' }));
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
          get: () => ({
            update: () => ({ link: () => ({ type: 'bookmarkTx' }) }),
            delete: () => ({ type: 'bookmarkDelete' }),
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

describe('StoreChatPanel logbook_system row', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentMessages = [
      {
        id: 'lb1',
        storeId: 's1',
        senderUserId: 'actor',
        senderProfileId: 'p-actor',
        senderNameSnapshot: 'Ada',
        senderRoleSnapshot: 'manager',
        messageType: 'logbook_system',
        sourceType: 'logbook',
        body: 'New issue assigned\n@all',
        createdAt: '2026-08-04T00:00:00.000Z',
        editedAt: '',
        deletedAt: '',
        status: 'active',
        replyToMessageId: '',
        mentionAll: true,
        mentionedUserIdsJson: '[]',
        logbookEntryId: 'entry-99',
        logbookEventType: 'issue_assigned',
        deepLinkJson: '',
        statusSnapshot: 'open',
      },
    ];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('renders @all as a mention segment', () => {
    renderPanel();
    const mention = document.querySelector('.fa-msg-mention');
    expect(mention?.textContent).toMatch(/@all/i);
  });

  it('dispatches OPEN_LOGBOOK_EVENT with fallback deep link on Open Logbook', () => {
    const seen: unknown[] = [];
    const handler = (event: Event) => {
      seen.push((event as CustomEvent).detail);
    };
    window.addEventListener(OPEN_LOGBOOK_EVENT, handler);
    try {
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: /open logbook/i }));
      expect(seen).toEqual([
        { entryId: 'entry-99', filter: 'my-assigned', storeId: 's1' },
      ]);
    } finally {
      window.removeEventListener(OPEN_LOGBOOK_EVENT, handler);
    }
  });

  it('exposes Reply and React actions without Delete', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /reply to logbook/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /react to logbook/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull();
  });
});
