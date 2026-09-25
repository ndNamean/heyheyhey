// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExtendedPack, extraCommonEn } from '../../i18n/extra';

const pack = buildExtendedPack('en');

vi.mock('../../i18n', () => ({
  useLang: () => ({
    lang: 'en',
    isRtl: false,
    setLang: () => {},
    t: {
      common: extraCommonEn,
      community: pack.community,
    },
  }),
}));

vi.mock('./useCommunityBuilders', () => ({
  useCommunityBuilders: () => ({ members: [] }),
}));

vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: ({ profile, className }: { profile: { displayName?: string }; className?: string }) => (
    <button type="button" className={className} data-testid="avatar-preview">
      {profile.displayName || 'avatar'}
    </button>
  ),
}));

import CommunityBuilders from './CommunityBuilders';

afterEach(() => {
  cleanup();
});

describe('CommunityBuilders', () => {
  it('returns null when there are no members', () => {
    const { container } = render(<CommunityBuilders members={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the builders strip with title and avatars, without scores or Focus class', () => {
    const { container } = render(
      <CommunityBuilders
        members={[
          { userId: 'u1', displayName: 'Ann', email: 'ann@example.com' },
          { userId: 'u2', displayName: 'Bob', email: 'bob@example.com' },
        ]}
      />,
    );

    expect(screen.getByRole('region', { name: 'Community Builders' })).toBeTruthy();
    expect(screen.getByText('Community Builders')).toBeTruthy();
    expect(screen.getByLabelText('Community Builder: Ann')).toBeTruthy();
    expect(screen.getByLabelText('Community Builder: Bob')).toBeTruthy();
    expect(screen.getAllByTestId('avatar-preview')).toHaveLength(2);

    expect(container.querySelector('.fa-panel-action--focus')).toBeNull();
    expect(container.textContent).not.toMatch(/\b\d+\b/);
    expect(container.querySelector('.community-builder-avatar--recognized')).toBeTruthy();
  });

  it('keeps Preview mountable via ProfileAvatarPreview wrapper', () => {
    render(
      <CommunityBuilders
        members={[{ userId: 'u1', displayName: 'Chris', email: 'c@example.com' }]}
      />,
    );
    expect(screen.getByTestId('avatar-preview')).toBeTruthy();
    expect(screen.getByText('Chris')).toBeTruthy();
  });
});
