// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExtendedPack, extraCommonEn } from '../../i18n/extra';
import type { CommunityBuilderMember } from './useCommunityBuilders';

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

vi.mock('../profileAvatar/ProfileAvatarPreview', () => ({
  default: ({
    profile,
    className,
    desktopHoverPreview,
    desktopClickPreview,
    mobileTapPreview,
  }: {
    profile: { displayName?: string };
    className?: string;
    desktopHoverPreview?: boolean;
    desktopClickPreview?: boolean;
    mobileTapPreview?: boolean;
  }) => (
    <button
      type="button"
      className={className}
      data-testid="avatar-preview"
      data-desktop-hover={String(desktopHoverPreview)}
      data-desktop-click={String(desktopClickPreview)}
      data-mobile-tap={String(mobileTapPreview)}
    >
      {profile.displayName || 'avatar'}
    </button>
  ),
}));

import CommunityBuilderItem from './CommunityBuilderItem';

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

function member(partial: Partial<CommunityBuilderMember> = {}): CommunityBuilderMember {
  return {
    userId: 'u1',
    displayName: 'Ann',
    email: 'ann@example.com',
    postCount: 3,
    commentCount: 4,
    supportCount: 8,
    contributionCount: 15,
    ...partial,
  };
}

afterEach(() => {
  cleanup();
});

describe('CommunityBuilderItem', () => {
  beforeEach(() => {
    setMatchMedia(true);
  });

  it('shows name and raw contribution count on hover, not weighted score', () => {
    const { container } = render(
      <ul>
        <CommunityBuilderItem
          member={member()}
          itemLabel="Community Builder: Ann, 15 contributions"
        />
      </ul>,
    );

    const item = screen.getByLabelText('Community Builder: Ann, 15 contributions');
    expect(container.querySelector('.community-builder-tooltip')).toBeNull();

    fireEvent.mouseEnter(item);
    const tip = container.querySelector('.community-builder-tooltip');
    expect(tip).toBeTruthy();
    expect(tip?.getAttribute('aria-hidden')).toBe('true');
    expect(tip?.getAttribute('role')).toBe('tooltip');
    expect(tip?.textContent).toContain('Ann');
    expect(tip?.textContent).toContain('15 contributions');
    // Weighted score would be 25 — must not appear
    expect(tip?.textContent).not.toMatch(/\b25\b/);
    expect(container.querySelector('.fa-panel-action--focus')).toBeNull();
  });

  it('shows tip on focus and hides on blur', () => {
    const { container } = render(
      <ul>
        <CommunityBuilderItem
          member={member({ contributionCount: 1, postCount: 1, commentCount: 0, supportCount: 0 })}
          itemLabel="Community Builder: Ann, 1 contribution"
        />
      </ul>,
    );

    const item = screen.getByLabelText('Community Builder: Ann, 1 contribution');
    fireEvent.focus(item);
    expect(container.querySelector('.community-builder-tooltip')?.textContent).toContain(
      '1 contribution',
    );

    fireEvent.blur(item);
    expect(container.querySelector('.community-builder-tooltip')).toBeNull();
  });

  it('does not open tip on coarse pointer', () => {
    setMatchMedia(false);
    const { container } = render(
      <ul>
        <CommunityBuilderItem
          member={member()}
          itemLabel="Community Builder: Ann, 15 contributions"
        />
      </ul>,
    );

    fireEvent.mouseEnter(screen.getByLabelText('Community Builder: Ann, 15 contributions'));
    expect(container.querySelector('.community-builder-tooltip')).toBeNull();
  });

  it('omits tip when contributionCount is zero', () => {
    const { container } = render(
      <ul>
        <CommunityBuilderItem
          member={member({
            contributionCount: 0,
            postCount: 0,
            commentCount: 0,
            supportCount: 0,
          })}
          itemLabel="Community Builder: Ann, 0 contributions"
        />
      </ul>,
    );

    fireEvent.mouseEnter(screen.getByLabelText('Community Builder: Ann, 0 contributions'));
    expect(container.querySelector('.community-builder-tooltip')).toBeNull();
  });

  it('closes tip on click and wires preview flags for click-vs-hover', () => {
    const { container } = render(
      <ul>
        <CommunityBuilderItem
          member={member()}
          itemLabel="Community Builder: Ann, 15 contributions"
        />
      </ul>,
    );

    const item = screen.getByLabelText('Community Builder: Ann, 15 contributions');
    fireEvent.mouseEnter(item);
    expect(container.querySelector('.community-builder-tooltip')).toBeTruthy();

    fireEvent.click(screen.getByTestId('avatar-preview'));
    expect(container.querySelector('.community-builder-tooltip')).toBeNull();

    const preview = screen.getByTestId('avatar-preview');
    expect(preview.getAttribute('data-desktop-hover')).toBe('false');
    expect(preview.getAttribute('data-desktop-click')).toBe('true');
    expect(preview.getAttribute('data-mobile-tap')).toBe('true');
  });

  it('keeps recognition glow and never applies Focus class', () => {
    const { container } = render(
      <ul>
        <CommunityBuilderItem
          member={member()}
          itemLabel="Community Builder: Ann, 15 contributions"
        />
      </ul>,
    );

    expect(container.querySelector('.community-builder-avatar--recognized')).toBeTruthy();
    expect(container.querySelector('.fa-panel-action--focus')).toBeNull();
  });
});
