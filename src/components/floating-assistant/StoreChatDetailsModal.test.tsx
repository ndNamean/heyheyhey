// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile, Store } from '../../types';

const useQueryMock = vi.fn(() => ({
  data: {
    profiles: [
      {
        id: 'p1',
        userId: 'u1',
        email: 'ada@ex.com',
        displayName: 'Ada',
        role: 'manager',
        approvalStatus: 'approved',
        stores: [{ id: 's1' }],
      },
      {
        id: 'p2',
        userId: 'u2',
        email: 'owner@ex.com',
        displayName: 'Oz',
        role: 'owner',
        approvalStatus: 'approved',
        stores: [],
      },
    ] as Profile[],
  },
  isLoading: false,
  error: null,
}));

vi.mock('../../db', () => ({
  db: {
    useQuery: (...args: unknown[]) => useQueryMock(...args),
  },
}));

vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: () => null,
}));

import StoreChatDetailsModal from './StoreChatDetailsModal';

const store: Store = {
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
};

describe('StoreChatDetailsModal', () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockClear();
  });

  it('lists store chat members with roles and skips the query when closed', () => {
    const { rerender } = render(
      <StoreChatDetailsModal open={false} onClose={vi.fn()} store={store} />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useQueryMock).toHaveBeenCalledWith(null);

    rerender(<StoreChatDetailsModal open onClose={vi.fn()} store={store} />);

    expect(screen.getByRole('dialog', { name: 'Store details' })).toBeTruthy();
    expect(screen.getByText('A1 · Alpha')).toBeTruthy();
    expect(screen.getByText('Store chat · 2 members')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.getByText('Ada · manager')).toBeTruthy();
    expect(screen.getByText('Oz · owner')).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: expect.objectContaining({
          stores: {},
          avatarFile: {},
        }),
      }),
    );
  });

  it('closes on backdrop, Close, and Escape', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <StoreChatDetailsModal open onClose={onClose} store={store} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);

    rerender(<StoreChatDetailsModal open={false} onClose={onClose} store={store} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
