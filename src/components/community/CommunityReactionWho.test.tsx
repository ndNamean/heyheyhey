// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunityReactionWho from './CommunityReactionWho';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';

vi.mock('../../lib/avatarClient', () => ({
  resolveAvatar: vi.fn(async () => ({ url: '', repaired: false })),
}));

const alice: AvatarProfileFields = {
  userId: 'u-alice',
  displayName: 'Alice Chen',
  email: 'alice@example.com',
};

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('CommunityReactionWho', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows names and avatars after hovering a chip', () => {
    const profiles = new Map<string, AvatarProfileFields>([['u-alice', alice]]);
    render(
      <CommunityReactionWho
        userIds={['u-alice']}
        profilesByUserId={profiles}
        heading="Who reacted"
        unknownLabel="Someone"
      >
        <button type="button">❤️ 1</button>
      </CommunityReactionWho>,
    );

    const wrap = screen.getByRole('button', { name: '❤️ 1' }).closest('.community-reaction-chip-wrap');
    fireEvent.pointerEnter(wrap as Element, { pointerType: 'mouse' });
    advance(220);

    expect(screen.getByRole('tooltip', { name: 'Who reacted' })).toBeTruthy();
    expect(screen.getByText('Alice Chen')).toBeTruthy();
  });

  it('still lets the chip click fire on a short press', () => {
    const onClick = vi.fn();
    render(
      <CommunityReactionWho
        userIds={['u-alice']}
        profilesByUserId={new Map()}
        heading="Who reacted"
        unknownLabel="Someone"
      >
        <button type="button" onClick={onClick}>
          ❤️ 1
        </button>
      </CommunityReactionWho>,
    );

    fireEvent.click(screen.getByRole('button', { name: '❤️ 1' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
