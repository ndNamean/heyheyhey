// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProfileAvatarPreview from './ProfileAvatarPreview';

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
      removeListener: vi.fn(),
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

describe('ProfileAvatarPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('opens and closes on desktop hover/focus with delays', () => {
    setMatchMedia(true);
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Alice', email: 'alice@example.com', avatarUrl: 'https://cdn/a.png' }}
        previewEnabled
      />,
    );

    const trigger = getTrigger('Alice');
    fireEvent.mouseEnter(trigger);
    advance(249);
    expect(screen.queryByAltText('Profile photo of Alice')).toBeNull();
    advance(1);
    expect(screen.getByAltText('Profile photo of Alice')).toBeTruthy();

    fireEvent.mouseLeave(trigger);
    advance(179);
    expect(screen.getByAltText('Profile photo of Alice')).toBeTruthy();
    advance(1);
    expect(screen.queryByAltText('Profile photo of Alice')).toBeNull();

    fireEvent.focus(trigger);
    advance(250);
    expect(screen.getByAltText('Profile photo of Alice')).toBeTruthy();

    fireEvent.blur(trigger);
    advance(180);
    expect(screen.queryByAltText('Profile photo of Alice')).toBeNull();
  });

  it('keeps only one desktop preview open at a time', () => {
    setMatchMedia(true);
    render(
      <>
        <ProfileAvatarPreview
          profile={{ displayName: 'Alpha', email: 'alpha@example.com', avatarUrl: 'https://cdn/a.png' }}
          previewEnabled
        />
        <ProfileAvatarPreview
          profile={{ displayName: 'Beta', email: 'beta@example.com', avatarUrl: 'https://cdn/b.png' }}
          previewEnabled
        />
      </>,
    );

    fireEvent.mouseEnter(getTrigger('Alpha'));
    advance(250);
    expect(screen.getByAltText('Profile photo of Alpha')).toBeTruthy();

    fireEvent.mouseEnter(getTrigger('Beta'));
    advance(250);
    expect(screen.getByAltText('Profile photo of Beta')).toBeTruthy();
    expect(screen.queryByAltText('Profile photo of Alpha')).toBeNull();
  });

  it('opens mobile modal and closes via button and scrim', () => {
    setMatchMedia(false);
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Mina', email: 'mina@example.com', avatarUrl: 'https://cdn/m.png' }}
        previewEnabled
      />,
    );

    fireEvent.click(getTrigger('Mina'));
    expect(screen.getByRole('dialog', { name: 'Profile photo of Mina' })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Profile photo of Mina' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Profile photo of Mina' })).toBeNull();

    fireEvent.click(getTrigger('Mina'));
    const scrim = document.querySelector('.profile-avatar-preview-modal-scrim');
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim as Element);
    expect(screen.queryByRole('dialog', { name: 'Profile photo of Mina' })).toBeNull();
  });

  it('renders non-clickable avatar when avatarUrl is missing', () => {
    setMatchMedia(false);
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'No Photo', email: 'nophoto@example.com', avatarUrl: '' }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'View profile photo for No Photo' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('NP')).toBeTruthy();
  });

  it('disables preview and falls back after image error', () => {
    setMatchMedia(true);
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Broken', email: 'broken@example.com', avatarUrl: 'https://cdn/broken.png' }}
        previewEnabled
      />,
    );

    fireEvent.mouseEnter(getTrigger('Broken'));
    advance(250);
    const img = screen.getByAltText('Profile photo of Broken');
    fireEvent.error(img);

    expect(screen.queryByAltText('Profile photo of Broken')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View profile photo for Broken' })).toBeNull();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('does not interfere with sibling user row actions', () => {
    setMatchMedia(false);
    const onRowAction = vi.fn();
    render(
      <div>
        <ProfileAvatarPreview
          profile={{ displayName: 'Row User', email: 'row@example.com', avatarUrl: 'https://cdn/row.png' }}
          previewEnabled
        />
        <button type="button" onClick={onRowAction}>
          Revoke
        </button>
      </div>,
    );

    fireEvent.click(getTrigger('Row User'));
    expect(onRowAction).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Profile photo of Row User' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onRowAction).toHaveBeenCalledTimes(1);
  });

  it('stays non-interactive unless explicitly enabled', () => {
    setMatchMedia(true);
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Opt In', email: 'optin@example.com', avatarUrl: 'https://cdn/optin.png' }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'View profile photo for Opt In' })).toBeNull();
  });

  it('preserves click handler and does not open mobile modal when disabled', () => {
    setMatchMedia(false);
    const onTriggerClick = vi.fn();
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Nav User', email: 'nav@example.com', avatarUrl: 'https://cdn/nav.png' }}
        previewEnabled
        mobileTapPreview={false}
        onTriggerClick={onTriggerClick}
      />,
    );

    fireEvent.click(getTrigger('Nav User'));
    expect(onTriggerClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Profile photo of Nav User' })).toBeNull();
  });

  it('supports desktop hover preview while keeping nav click-to-profile behavior', () => {
    setMatchMedia(true);
    const onTriggerClick = vi.fn();
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Desktop Nav', email: 'desktop-nav@example.com', avatarUrl: 'https://cdn/desktop-nav.png' }}
        previewEnabled
        desktopHoverPreview
        mobileTapPreview={false}
        onTriggerClick={onTriggerClick}
      />,
    );

    const trigger = getTrigger('Desktop Nav');
    fireEvent.mouseEnter(trigger);
    advance(250);
    expect(screen.getByAltText('Profile photo of Desktop Nav')).toBeTruthy();

    fireEvent.click(trigger);
    expect(onTriggerClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('Profile photo of Desktop Nav')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Profile photo of Desktop Nav' })).toBeNull();
  });

  it('keeps mobile nav tap unchanged with no modal preview', () => {
    setMatchMedia(false);
    const onTriggerClick = vi.fn();
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Mobile Nav', email: 'mobile-nav@example.com', avatarUrl: 'https://cdn/mobile-nav.png' }}
        previewEnabled
        mobileTapPreview={false}
        onTriggerClick={onTriggerClick}
      />,
    );

    fireEvent.click(getTrigger('Mobile Nav'));
    expect(onTriggerClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Profile photo of Mobile Nav' })).toBeNull();
    expect(screen.queryByAltText('Profile photo of Mobile Nav')).toBeNull();
  });

  it('stays non-interactive when desktop and mobile preview are both disabled', () => {
    setMatchMedia(true);
    render(
      <ProfileAvatarPreview
        profile={{ displayName: 'Disabled Modes', email: 'disabled-modes@example.com', avatarUrl: 'https://cdn/disabled.png' }}
        previewEnabled
        desktopHoverPreview={false}
        mobileTapPreview={false}
      />,
    );

    const trigger = getTrigger('Disabled Modes');
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    advance(400);
    expect(screen.queryByAltText('Profile photo of Disabled Modes')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog', { name: 'Profile photo of Disabled Modes' })).toBeNull();
  });
});
