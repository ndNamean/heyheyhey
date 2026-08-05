import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GIPHY_DEFAULT_RATING,
  GIPHY_POWERED_BY_MARK,
  GiphyClientError,
  createDebouncedAsync,
  isGiphyConfigured,
} from './giphyClient';

describe('giphyClient config + attribution constants', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes attribution mark and default pg rating', () => {
    expect(GIPHY_POWERED_BY_MARK).toBe('Powered by GIPHY');
    expect(GIPHY_DEFAULT_RATING).toBe('pg');
  });

  it('gates on VITE_GIPHY_API_KEY', () => {
    vi.stubEnv('VITE_GIPHY_API_KEY', '');
    expect(isGiphyConfigured()).toBe(false);
    vi.stubEnv('VITE_GIPHY_API_KEY', 'gk_test');
    expect(isGiphyConfigured()).toBe(true);
  });
});

describe('createDebouncedAsync generation cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('isPending reflects timer and clears after cancel', async () => {
    const debounced = createDebouncedAsync(async () => 'ok', 50);
    expect(debounced.isPending()).toBe(false);
    const p = debounced.schedule();
    const rejected = expect(p).rejects.toBeInstanceOf(GiphyClientError);
    expect(debounced.isPending()).toBe(true);
    debounced.cancel();
    expect(debounced.isPending()).toBe(false);
    await rejected;
  });
});
