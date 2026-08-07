// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('filters rooms by search query', () => {
    renderSelector();

    fireEvent.click(screen.getByRole('button', { name: /A1 · Alpha/ }));
    const search = screen.getByPlaceholderText('Search chats…');
    fireEvent.change(search, { target: { value: 'ops' } });

    const list = screen.getByRole('listbox', { name: 'Chat rooms' });
    expect(within(list).getByText('Ops huddle')).toBeTruthy();
    expect(within(list).queryByText('A1 · Alpha')).toBeNull();
    expect(within(list).queryByText('B2 · Beta')).toBeNull();
  });

  it('closes on Escape and restores current selection', () => {
    const { onSelect } = renderSelector();

    fireEvent.click(screen.getByRole('button', { name: /A1 · Alpha/ }));
    expect(screen.getByPlaceholderText('Search chats…')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Search chats…')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hides New group when canCreate is false', () => {
    renderSelector({ canCreate: false });

    fireEvent.click(screen.getByRole('button', { name: /A1 · Alpha/ }));

    expect(screen.queryByRole('button', { name: '+ New group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
  });

  it('opens New group from footer when canCreate', () => {
    const { onCreateClick } = renderSelector();

    fireEvent.click(screen.getByRole('button', { name: /A1 · Alpha/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ New group' }));

    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });
});
