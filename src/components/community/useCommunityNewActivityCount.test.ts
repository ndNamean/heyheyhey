/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_LAST_SEEN_KEY, COMMUNITY_NEW_ACTIVITY_LIMIT } from '../../lib/communityNewActivity';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: {
    useQuery: (query: unknown) => useQueryMock(query),
  },
}));

import {
  notifyCommunityLastSeenChanged,
  useCommunityNewActivityCount,
} from './useCommunityNewActivityCount';

const ME = 'user-me';
const OTHER = 'user-other';
const CURSOR = '2026-01-01T00:00:00.000Z';

function setCursor(userId: string, iso: string) {
  localStorage.setItem(COMMUNITY_LAST_SEEN_KEY, JSON.stringify({ [userId]: iso }));
  notifyCommunityLastSeenChanged();
}

function clearCursor() {
  localStorage.removeItem(COMMUNITY_LAST_SEEN_KEY);
  notifyCommunityLastSeenChanged();
}

type QueryResult = {
  data?: {
    communityPosts?: Array<Record<string, unknown>>;
    communityComments?: Array<Record<string, unknown>>;
  };
  error?: unknown;
  isLoading?: boolean;
};

/**
 * Route Instant-style queries: live activity (createdAt $gt) vs parent $in resolve.
 */
function mockQueries(opts: {
  posts?: Array<Record<string, unknown>>;
  comments?: Array<Record<string, unknown>>;
  parents?: Array<Record<string, unknown>>;
  liveError?: unknown;
}) {
  useQueryMock.mockImplementation((query: unknown) => {
    if (query == null) {
      return { data: undefined, error: null, isLoading: false } satisfies QueryResult;
    }
    const q = query as {
      communityPosts?: { $?: { where?: { createdAt?: unknown; id?: unknown } } };
      communityComments?: unknown;
    };
    const where = q.communityPosts?.$?.where;
    if (where && 'createdAt' in where) {
      return {
        data: {
          communityPosts: opts.posts ?? [],
          communityComments: opts.comments ?? [],
        },
        error: opts.liveError ?? null,
        isLoading: false,
      } satisfies QueryResult;
    }
    if (where && 'id' in where) {
      return {
        data: { communityPosts: opts.parents ?? [] },
        error: null,
        isLoading: false,
      } satisfies QueryResult;
    }
    return { data: undefined, error: null, isLoading: false };
  });
}

describe('useCommunityNewActivityCount', () => {
  beforeEach(() => {
    localStorage.clear();
    useQueryMock.mockReset();
    mockQueries({});
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('no cursor → no badge', () => {
    clearCursor();
    const { result } = renderHook(() => useCommunityNewActivityCount(ME));
    expect(result.current.enabled).toBe(true);
    expect(result.current.count).toBe(0);
    expect(result.current.showBadge).toBe(false);
    expect(result.current.badgeLabel).toBe('0');
  });

  it('other-user post after cursor → show badge', () => {
    setCursor(ME, CURSOR);
    mockQueries({
      posts: [
        {
          id: 'p1',
          authorUserId: OTHER,
          createdAt: '2026-01-02T00:00:00.000Z',
          status: 'active',
        },
      ],
      comments: [],
      parents: [{ id: 'p1', status: 'active' }],
    });

    const { result } = renderHook(() => useCommunityNewActivityCount(ME));
    expect(result.current.count).toBe(1);
    expect(result.current.capped).toBe(false);
    expect(result.current.showBadge).toBe(true);
    expect(result.current.badgeLabel).toBe('1');
  });

  it('own post after cursor → count 0, no badge', () => {
    setCursor(ME, CURSOR);
    mockQueries({
      posts: [
        {
          id: 'p-mine',
          authorUserId: ME,
          createdAt: '2026-01-02T00:00:00.000Z',
          status: 'active',
        },
      ],
      comments: [],
      parents: [{ id: 'p-mine', status: 'active' }],
    });

    const { result } = renderHook(() => useCommunityNewActivityCount(ME));
    expect(result.current.count).toBe(0);
    expect(result.current.showBadge).toBe(false);
  });

  it('capped live page → badgeLabel uses n+', () => {
    setCursor(ME, CURSOR);
    const posts = Array.from({ length: COMMUNITY_NEW_ACTIVITY_LIMIT }, (_, i) => ({
      id: `p${i}`,
      authorUserId: OTHER,
      createdAt: `2026-01-02T00:${String(i).padStart(2, '0')}:00.000Z`,
      status: 'active',
    }));
    mockQueries({
      posts,
      comments: [],
      parents: posts.map((p) => ({ id: p.id, status: 'active' })),
    });

    const { result } = renderHook(() => useCommunityNewActivityCount(ME));
    expect(result.current.capped).toBe(true);
    expect(result.current.count).toBe(COMMUNITY_NEW_ACTIVITY_LIMIT);
    expect(result.current.badgeLabel).toBe(`${COMMUNITY_NEW_ACTIVITY_LIMIT}+`);
    expect(result.current.showBadge).toBe(true);
  });

  it('does not write baseline / last-seen on mount', () => {
    clearCursor();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderHook(() => useCommunityNewActivityCount(ME));
    expect(setItem).not.toHaveBeenCalledWith(
      COMMUNITY_LAST_SEEN_KEY,
      expect.anything(),
    );
    setItem.mockRestore();
  });
});
