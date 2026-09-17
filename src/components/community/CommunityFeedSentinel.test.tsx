// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommunityFeedSentinel, {
  canStartCommunityLoadMore,
  shouldEnableFeedSentinel,
} from './CommunityFeedSentinel';

describe('community load-more lock', () => {
  const loadNextPage = () => {};

  it('allows a single start and blocks overlap', () => {
    expect(
      canStartCommunityLoadMore({
        canLoadNextPage: true,
        isLoadingMore: false,
        inFlight: false,
        loadNextPage,
      }),
    ).toBe(true);
    expect(
      canStartCommunityLoadMore({
        canLoadNextPage: true,
        isLoadingMore: true,
        inFlight: false,
        loadNextPage,
      }),
    ).toBe(false);
    expect(
      canStartCommunityLoadMore({
        canLoadNextPage: true,
        isLoadingMore: false,
        inFlight: true,
        loadNextPage,
      }),
    ).toBe(false);
    expect(
      canStartCommunityLoadMore({
        canLoadNextPage: false,
        isLoadingMore: false,
        inFlight: false,
        loadNextPage,
      }),
    ).toBe(false);
    expect(
      canStartCommunityLoadMore({
        canLoadNextPage: true,
        isLoadingMore: false,
        inFlight: false,
        loadNextPage: undefined,
      }),
    ).toBe(false);
  });
});

describe('shouldEnableFeedSentinel', () => {
  it('observes the feed only when more pages exist and the overlay is closed', () => {
    expect(
      shouldEnableFeedSentinel({
        overlayOpen: false,
        canLoadNextPage: true,
        isLoadingMore: false,
        loadMoreError: false,
      }),
    ).toBe(true);
    expect(
      shouldEnableFeedSentinel({
        overlayOpen: true,
        canLoadNextPage: true,
        isLoadingMore: false,
        loadMoreError: false,
      }),
    ).toBe(false);
    expect(
      shouldEnableFeedSentinel({
        overlayOpen: false,
        canLoadNextPage: true,
        isLoadingMore: false,
        loadMoreError: true,
      }),
    ).toBe(false);
    expect(
      shouldEnableFeedSentinel({
        overlayOpen: false,
        canLoadNextPage: false,
        isLoadingMore: true,
        loadMoreError: false,
      }),
    ).toBe(true);
    expect(
      shouldEnableFeedSentinel({
        overlayOpen: false,
        canLoadNextPage: false,
        isLoadingMore: false,
        loadMoreError: false,
      }),
    ).toBe(false);
  });
});

describe('CommunityFeedSentinel', () => {
  const observers: Array<{
    callback: IntersectionObserverCallback;
    options: IntersectionObserverInit | undefined;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];

  afterEach(() => {
    cleanup();
    observers.length = 0;
    vi.unstubAllGlobals();
  });

  function stubObserver() {
    observers.length = 0;
    class MockObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      callback: IntersectionObserverCallback;
      options: IntersectionObserverInit | undefined;
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = () => [];
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.callback = callback;
        this.options = options;
        observers.push(this);
      }
    }
    vi.stubGlobal('IntersectionObserver', MockObserver);
  }

  it('observes the window with a 400px root margin and notifies once per intersection', () => {
    stubObserver();
    const onVisible = vi.fn();
    render(<CommunityFeedSentinel enabled onVisible={onVisible} observeKey={15} />);
    expect(observers).toHaveLength(1);
    expect(observers[0].options).toEqual({ root: null, rootMargin: '400px 0px' });
    expect(observers[0].observe).toHaveBeenCalledTimes(1);
    observers[0].callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      observers[0] as unknown as IntersectionObserver,
    );
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it('does not observe while disabled', () => {
    stubObserver();
    render(<CommunityFeedSentinel enabled={false} onVisible={() => {}} />);
    expect(observers).toHaveLength(0);
  });
});
