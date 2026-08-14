// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ZoomableImage from './ZoomableImage';
import { IMAGE_ZOOM } from './useImageZoom';

function installMatchMedia(opts: { fineHover?: boolean; reducedMotion?: boolean } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => {
      const isMotion = query.includes('prefers-reduced-motion');
      const isHover = query.includes('pointer: fine');
      return {
        matches: isMotion ? Boolean(opts.reducedMotion) : isHover ? Boolean(opts.fineHover) : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

function mockBox(el: HTMLElement, size = 100) {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: size,
      bottom: size,
      width: size,
      height: size,
      toJSON: () => {},
    }) as DOMRect;
}

describe('ZoomableImage', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a button with zoom aria-label wrapping visual content', () => {
    installMatchMedia({ fineHover: true });
    render(
      <ZoomableImage alt="Storefront" ariaLabel="Zoom image: Storefront">
        <img alt="Storefront" src="about:blank" />
      </ZoomableImage>,
    );
    const btn = screen.getByRole('button', { name: 'Zoom image: Storefront' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.querySelector('img')?.alt).toBe('Storefront');
  });

  it('stops click and pointerdown on the button (checkbox-label)', () => {
    installMatchMedia({ fineHover: true });
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <label onClick={onClick} onPointerDown={onPointerDown}>
        <ZoomableImage alt="thumb">
          <img alt="thumb" src="about:blank" />
        </ZoomableImage>
      </label>,
    );
    const btn = screen.getByRole('button', { name: 'Zoom image: thumb' });
    fireEvent.pointerDown(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it('does not stop pointerdown when isolation is disabled (chat swipe)', () => {
    installMatchMedia({ fineHover: false });
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <ZoomableImage alt="chat" stopPointerDownPropagation={false}>
          <img alt="chat" src="about:blank" />
        </ZoomableImage>
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Zoom image: chat' }));
    expect(onPointerDown).toHaveBeenCalled();
  });

  it('desktop hover writes focal CSS variables without resting on move', () => {
    installMatchMedia({ fineHover: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(
      <ZoomableImage alt="desk">
        <img alt="desk" src="about:blank" />
      </ZoomableImage>,
    );
    const btn = screen.getByRole('button', { name: 'Zoom image: desk' });
    mockBox(btn);
    fireEvent.pointerEnter(btn, { clientX: 25, clientY: 25 });
    expect(btn.getAttribute('data-zoom-state')).toBe('base');
    expect(btn.getAttribute('data-will-change')).toBe('true');
    expect(btn.style.getPropertyValue('--media-zoom-ox')).toBe('25%');

    actTimers(IMAGE_ZOOM.IDLE_MS);
    expect(btn.getAttribute('data-zoom-state')).toBe('enhanced');

    fireEvent.pointerMove(btn, { clientX: 80, clientY: 20 });
    expect(btn.getAttribute('data-zoom-state')).toBe('base');
    expect(btn.style.getPropertyValue('--media-zoom-ox')).toBe('80%');

    fireEvent.pointerLeave(btn);
    expect(btn.getAttribute('data-zoom-state')).toBe('resting');
    actTimers(IMAGE_ZOOM.WILL_CHANGE_CLEAR_MS);
    expect(btn.getAttribute('data-will-change')).toBe('false');
  });

  it('touch tap toggles; reduced motion still zooms', () => {
    installMatchMedia({ fineHover: false, reducedMotion: true });
    render(
      <ZoomableImage alt="tap">
        <img alt="tap" src="about:blank" />
      </ZoomableImage>,
    );
    const btn = screen.getByRole('button', { name: 'Zoom image: tap' });
    expect(btn.getAttribute('data-reduced-motion')).toBe('true');
    mockBox(btn);
    fireEvent.pointerDown(btn, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(btn.getAttribute('data-zoom-state')).toBe('zoomed');
    fireEvent.pointerDown(btn, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(btn.getAttribute('data-zoom-state')).toBe('resting');
  });

  it('Escape preventDefault so native back does not also fire', () => {
    installMatchMedia({ fineHover: false });
    render(
      <ZoomableImage alt="esc">
        <img alt="esc" src="about:blank" />
      </ZoomableImage>,
    );
    const btn = screen.getByRole('button', { name: 'Zoom image: esc' });
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(btn.getAttribute('data-zoom-state')).toBe('base');
    const esc = createEvent.keyDown(btn, { key: 'Escape' });
    fireEvent(btn, esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(btn.getAttribute('data-zoom-state')).toBe('resting');
  });
});

function actTimers(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
