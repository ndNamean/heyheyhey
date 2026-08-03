// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import IdentityWithAvatar from './IdentityWithAvatar';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';

vi.mock('../../lib/avatarClient', () => ({
  resolveAvatar: vi.fn(async () => ({ url: '', repaired: false })),
}));

function withFile(url: string) {
  return { id: `file-${url}`, url, path: `profile-avatars/u/avatar.png` };
}

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(hover: hover) and (pointer: fine)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function getTrigger(name: string) {
  return screen.getByRole('button', { name: `View profile photo for ${name}` });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const alice: AvatarProfileFields = {
  userId: 'u-alice',
  displayName: 'Alice Chen',
  email: 'alice@example.com',
  avatarFile: withFile('https://cdn/alice.png'),
};

const bob: AvatarProfileFields = {
  userId: 'u-bob',
  displayName: 'Bob Lee',
  email: 'bob@example.com',
  avatarFile: withFile('https://cdn/bob.png'),
};

const noPhoto: AvatarProfileFields = {
  displayName: 'No Photo',
  email: 'nophoto@example.com',
  avatarUrl: '',
};

describe('IdentityWithAvatar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders children only when profile is null', () => {
    const { container } = render(
      <IdentityWithAvatar profile={null}>Plain name</IdentityWithAvatar>,
    );

    expect(screen.getByText('Plain name')).toBeTruthy();
    expect(container.querySelector('.identity-with-avatar')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders children only when profile is undefined', () => {
    const { container } = render(
      <IdentityWithAvatar profile={undefined}>Missing profile</IdentityWithAvatar>,
    );

    expect(screen.getByText('Missing profile')).toBeTruthy();
    expect(container.querySelector('.identity-with-avatar')).toBeNull();
  });

  it('renders compact avatar + text and opens preview on hover after delay', () => {
    setMatchMedia(true);
    const { container } = render(
      <IdentityWithAvatar profile={alice}>Alice Chen</IdentityWithAvatar>,
    );

    expect(container.querySelector('.identity-with-avatar')).toBeTruthy();
    expect(container.querySelector('.identity-with-avatar-text')?.textContent).toBe('Alice Chen');
    expect(getTrigger('Alice Chen')).toBeTruthy();

    const trigger = getTrigger('Alice Chen');
    fireEvent.mouseEnter(trigger);
    advance(249);
    expect(screen.queryByAltText('Profile photo of Alice Chen')).toBeNull();
    advance(1);
    expect(screen.getByAltText('Profile photo of Alice Chen')).toBeTruthy();
  });

  it('shows initials and no empty preview when avatar file is missing', () => {
    setMatchMedia(true);
    render(<IdentityWithAvatar profile={noPhoto}>No Photo</IdentityWithAvatar>);

    expect(screen.getByText('No Photo')).toBeTruthy();
    expect(screen.getByText('NP')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View profile photo for No Photo' })).toBeNull();

    const avatar = document.querySelector('.avatar-circle');
    expect(avatar).toBeTruthy();
    fireEvent.mouseEnter(avatar as Element);
    advance(400);
    expect(screen.queryByAltText('Profile photo of No Photo')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('smoke: assignee chip list resolves profiles and skips missing ones', () => {
    setMatchMedia(true);
    const profiles = [alice, bob];
    const ids = ['u-alice', 'u-missing', 'u-bob'];

    const { container } = render(
      <span>
        {ids.map((uid, i) => {
          const p = profiles.find((x) => x.userId === uid);
          const label = p?.displayName || p?.email || uid;
          return (
            <span key={uid}>
              {i > 0 ? ', ' : ''}
              <IdentityWithAvatar profile={p}>{label}</IdentityWithAvatar>
            </span>
          );
        })}
        {' (manager)'}
      </span>,
    );

    expect(screen.getByText('Alice Chen')).toBeTruthy();
    expect(container.textContent).toContain('u-missing');
    expect(screen.getByText('Bob Lee')).toBeTruthy();
    expect(container.querySelectorAll('.identity-with-avatar')).toHaveLength(2);
    expect(getTrigger('Alice Chen')).toBeTruthy();
    expect(getTrigger('Bob Lee')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /u-missing/ })).toBeNull();
  });

  it('smoke: FeedbackInbox actor avatar tap does not fire parent item click', () => {
    setMatchMedia(false);
    const onItemClick = vi.fn();

    // Mirrors FeedbackInbox: stopPropagation wrapper around IdentityWithAvatar
    // inside a clickable item (div avoids nested <button> warning in jsdom).
    render(
      <div
        role="button"
        tabIndex={0}
        className="feedback-item"
        onClick={onItemClick}
        onKeyDown={() => undefined}
      >
        <div className="feedback-item-body">Open item</div>
        <div className="feedback-item-actor">
          Reviewed by{' '}
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <IdentityWithAvatar profile={alice}>{alice.displayName}</IdentityWithAvatar>{' '}
          </span>
          manager
        </div>
      </div>,
    );

    fireEvent.click(getTrigger('Alice Chen'));
    expect(onItemClick).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Profile photo of Alice Chen' })).toBeTruthy();

    fireEvent.click(screen.getByText('Open item'));
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });
});
