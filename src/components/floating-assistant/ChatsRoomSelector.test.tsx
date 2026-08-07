// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupChatRoom, Store } from '../../types';
import ChatsRoomSelector from './ChatsRoomSelector';

vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: () => null,
}));

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
  {
    id: 's2',
    code: 'B2',
    name: 'Beta',
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

const groups: GroupChatRoom[] = [
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
];

function renderSelector(overrides: Partial<Parameters<typeof ChatsRoomSelector>[0]> = {}) {
  const onSelect = vi.fn();
  const onCreateClick = vi.fn();
  const result = render(
    <ChatsRoomSelector
      stores={stores}
      groups={groups}
      pendingInvites={[]}
      selected={{ kind: 'store', id: 's1' }}
      onSelect={onSelect}
      unreadByStore={{}}
      unreadByGroup={{}}
      canCreate
      onCreateClick={onCreateClick}
      onAcceptInvite={vi.fn()}
      onDeclineInvite={vi.fn()}
      {...overrides}
    />,
  );
  return { ...result, onSelect, onCreateClick };
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /A1 · Alpha/ }));
}

describe('ChatsRoomSelector', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens in browse mode without focusing search', () => {
    renderSelector();
    openMenu();

    expect(screen.queryByPlaceholderText('Search chats…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search chats' })).toBeTruthy();
    expect(document.activeElement).not.toBe(
      screen.queryByPlaceholderText('Search chats…'),
    );
  });

  it('enters search mode from the search icon and focuses the input', async () => {
    renderSelector();
    openMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Search chats' }));

    const search = screen.getByPlaceholderText('Search chats…');
    expect(search).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(search);
    });
  });

  it('filters rooms by search query', () => {
    renderSelector();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Search chats' }));

    const search = screen.getByPlaceholderText('Search chats…');
    fireEvent.change(search, { target: { value: 'ops' } });

    const list = screen.getByRole('listbox', { name: 'Chat rooms' });
    expect(within(list).getByText('Ops huddle')).toBeTruthy();
    expect(within(list).queryByText('A1 · Alpha')).toBeNull();
    expect(within(list).queryByText('B2 · Beta')).toBeNull();
  });

  it('Escape exits search mode first, then closes the menu', () => {
    const { onSelect } = renderSelector();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Search chats' }));
    expect(screen.getByPlaceholderText('Search chats…')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Search chats…')).toBeNull();
    expect(screen.getByRole('listbox', { name: 'Chat rooms' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Chat rooms' })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selecting a room closes the menu and clears search', () => {
    const { onSelect } = renderSelector();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Search chats' }));
    fireEvent.change(screen.getByPlaceholderText('Search chats…'), {
      target: { value: 'Beta' },
    });

    fireEvent.click(screen.getByRole('option', { name: /B2 · Beta/ }));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'store', id: 's2' });
    expect(screen.queryByRole('listbox', { name: 'Chat rooms' })).toBeNull();
    expect(screen.queryByPlaceholderText('Search chats…')).toBeNull();
  });

  it('orders current room before unread and remaining rooms', () => {
    renderSelector({
      selected: { kind: 'store', id: 's1' },
      unreadByStore: { s2: 3 },
      unreadByGroup: { g1: 1 },
    });
    openMenu();

    const list = screen.getByRole('listbox', { name: 'Chat rooms' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('A1 · Alpha'),
      expect.stringContaining('B2 · Beta'),
      expect.stringContaining('Ops huddle'),
    ]);
  });

  it('hides New group when canCreate is false', () => {
    renderSelector({ canCreate: false });
    openMenu();

    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
  });

  it('opens New group from header + when canCreate', () => {
    const { onCreateClick } = renderSelector();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));

    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });
});
