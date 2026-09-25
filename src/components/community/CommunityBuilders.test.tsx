// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  default: ({
    profile,
    className,
    desktopHoverPreview,
    desktopClickPreview,
  }: {
    profile: { displayName?: string };
    className?: string;
    desktopHoverPreview?: boolean;
    desktopClickPreview?: boolean;
  }) => (
    <button
      type="button"
      className={className}
      data-testid="avatar-preview"
      data-desktop-hover={String(desktopHoverPreview)}
      data-desktop-click={String(desktopClickPreview)}
    >
      {profile.displayName || 'avatar'}
    </button>
  ),
}));

import CommunityBuilders from './CommunityBuilders';

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

afterEach(() => {
  cleanup();
});

describe('CommunityBuilders', () => {
  beforeEach(() => {
    setMatchMedia(true);
  });

  it('returns null when there are no members', () => {
    const { container } = render(<CommunityBuilders members={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the builders strip with enriched labels, without Focus class or score digits in tip', () => {
    const { container } = render(
      <CommunityBuilders
        members={[
          {
            userId: 'u1',
            displayName: 'Ann',
            email: 'ann@example.com',
            postCount: 3,
            commentCount: 4,
            supportCount: 8,
            contributionCount: 15,
          },
          {
            userId: 'u2',
            displayName: 'Bob',
            email: 'bob@example.com',
            postCount: 1,
            commentCount: 0,
            supportCount: 0,
            contributionCount: 1,
          },
        ]}
      />,
    );

    expect(screen.getByRole('region', { name: 'Community Builders' })).toBeTruthy();
    expect(screen.getByText('Community Builders')).toBeTruthy();
    expect(screen.getByLabelText('Community Builder: Ann, 15 contributions')).toBeTruthy();
    expect(screen.getByLabelText('Community Builder: Bob, 1 contribution')).toBeTruthy();
    expect(screen.getAllByTestId('avatar-preview')).toHaveLength(2);

    expect(container.querySelector('.fa-panel-action--focus')).toBeNull();
    // Tip closed by default — contribution digits live only in aria-label until hover
    expect(container.querySelector('.community-builder-tooltip')).toBeNull();
    expect(container.querySelector('.community-builder-avatar--recognized')).toBeTruthy();

    const preview = screen.getAllByTestId('avatar-preview')[0];
    expect(preview.getAttribute('data-desktop-hover')).toBe('false');
    expect(preview.getAttribute('data-desktop-click')).toBe('true');
  });

  it('keeps Preview mountable via ProfileAvatarPreview wrapper', () => {
    render(
      <CommunityBuilders
        members={[
          {
            userId: 'u1',
            displayName: 'Chris',
            email: 'c@example.com',
            postCount: 2,
            commentCount: 1,
            supportCount: 1,
            contributionCount: 4,
          },
        ]}
      />,
    );
    expect(screen.getByTestId('avatar-preview')).toBeTruthy();
    expect(screen.getByText('Chris')).toBeTruthy();
  });
});
