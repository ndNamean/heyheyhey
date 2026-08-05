// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ambientMediaEffects } from '../../config/ambientMediaEffects';
import AmbientGlowMedia from './AmbientGlowMedia';

describe('AmbientGlowMedia', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('stays sustained-only under reduced motion (no flash/breathe)', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(
      <AmbientGlowMedia breathe flashToken={1} cacheKey="test-media">
        <img
          alt="gif"
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
        />
      </AmbientGlowMedia>,
    );

    const root = document.querySelector('.ambient-glow-media');
    expect(root).not.toBeNull();
    expect(root!.getAttribute('data-ambient-motion')).toBe('sustained-only');
    expect(root!.getAttribute('data-ambient-breathe')).toBe('false');
    expect(root!.getAttribute('data-ambient-flash')).toBe('false');
    expect(screen.getByAltText('gif')).toBeTruthy();
  });

  it('enables breathe when motion is allowed', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(
      <AmbientGlowMedia breathe cacheKey="ok">
        <img
          alt="sticker"
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
        />
      </AmbientGlowMedia>,
    );

    const root = document.querySelector('.ambient-glow-media');
    expect(root!.getAttribute('data-ambient-motion')).toBe('full');
    expect(root!.getAttribute('data-ambient-breathe')).toBe('true');
  });

  it('triggers one-shot flash when flashToken changes and motion is allowed', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const onFlashComplete = vi.fn();
    const { rerender } = render(
      <AmbientGlowMedia flashToken={null} onFlashComplete={onFlashComplete}>
        <img
          alt="m"
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
        />
      </AmbientGlowMedia>,
    );

    rerender(
      <AmbientGlowMedia flashToken={1} onFlashComplete={onFlashComplete}>
        <img
          alt="m"
          src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
        />
      </AmbientGlowMedia>,
    );

    expect(document.querySelector('.ambient-glow-media')!.getAttribute('data-ambient-flash')).toBe(
      'true',
    );

    act(() => {
      vi.advanceTimersByTime(ambientMediaEffects.brightFlash.durationMs);
    });
    expect(onFlashComplete).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ambient-glow-media')!.getAttribute('data-ambient-flash')).toBe(
      'false',
    );
  });
});
