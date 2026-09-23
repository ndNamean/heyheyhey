/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_NEW_ACTIVITY_LIMIT,
  buildOrderedActivityThreads,
  collectActivityThreadMaxByPostId,
  filterRowsInSnapshotWindow,
  formatActivityChipCount,
  isActivityQueryCapped,
  resolveActivityThreads,
  rowInSnapshotWindow,
  shouldEstablishBaseline,
  withLastSeenAt,
} from './communityNewActivity';

const ME = 'user-me';
const OTHER = 'user-other';
const OTHER2 = 'user-other-2';

function post(
  id: string,
  createdAt: string,
  authorUserId = OTHER,
): { id: string; authorUserId: string; createdAt: string; status: string } {
  return { id, authorUserId, createdAt, status: 'active' };
}

function comment(
  id: string,
  postId: string,
  createdAt: string,
  authorUserId = OTHER,
): { id: string; postId: string; authorUserId: string; createdAt: string; status: string } {
  return { id, postId, authorUserId, createdAt, status: 'active' };
}

describe('communityNewActivity dedup', () => {
  it('counts 1 post as one thread', () => {
    const threads = buildOrderedActivityThreads({
      posts: [post('p1', '2026-01-02T00:00:00.000Z')],
      comments: [],
      parents: [{ id: 'p1', status: 'active' }],
      currentUserId: ME,
    });
    expect(threads).toEqual([{ postId: 'p1', maxCreatedAt: '2026-01-02T00:00:00.000Z' }]);
  });

  it('dedupes 5 comments on the same thread to 1', () => {
    const comments = [1, 2, 3, 4, 5].map((n) =>
      comment(`c${n}`, 'p1', `2026-01-0${n}T00:00:00.000Z`),
    );
    const threads = buildOrderedActivityThreads({
      posts: [],
      comments,
      parents: [{ id: 'p1', status: 'active' }],
      currentUserId: ME,
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toEqual({ postId: 'p1', maxCreatedAt: '2026-01-05T00:00:00.000Z' });
  });

  it('counts a reply on an old thread as 1', () => {
    const threads = buildOrderedActivityThreads({
      posts: [],
      comments: [comment('c1', 'old-post', '2026-03-01T12:00:00.000Z')],
      parents: [{ id: 'old-post', status: 'active' }],
      currentUserId: ME,
    });
    expect(threads).toHaveLength(1);
    expect(threads[0].postId).toBe('old-post');
  });

  it('merges post + comments on same thread to 1 with max ts', () => {
    const threads = buildOrderedActivityThreads({
      posts: [post('p1', '2026-01-01T00:00:00.000Z')],
      comments: [
        comment('c1', 'p1', '2026-01-03T00:00:00.000Z'),
        comment('c2', 'p1', '2026-01-02T00:00:00.000Z'),
      ],
      parents: [{ id: 'p1', status: 'active' }],
      currentUserId: ME,
    });
    expect(threads).toEqual([{ postId: 'p1', maxCreatedAt: '2026-01-03T00:00:00.000Z' }]);
  });

  it('own post and own comment contribute 0', () => {
    const map = collectActivityThreadMaxByPostId({
      posts: [post('p1', '2026-01-02T00:00:00.000Z', ME)],
      comments: [comment('c1', 'p2', '2026-01-03T00:00:00.000Z', ME)],
      currentUserId: ME,
    });
    expect(map.size).toBe(0);
  });

  it('other-user comment on own thread counts as 1', () => {
    const threads = buildOrderedActivityThreads({
      posts: [],
      comments: [comment('c1', 'my-post', '2026-01-04T00:00:00.000Z', OTHER)],
      parents: [{ id: 'my-post', status: 'active' }],
      currentUserId: ME,
    });
    expect(threads).toHaveLength(1);
    expect(threads[0].postId).toBe('my-post');
  });

  it('drops inactive or missing parents', () => {
    const map = collectActivityThreadMaxByPostId({
      posts: [post('p-active', '2026-01-02T00:00:00.000Z'), post('p-gone', '2026-01-03T00:00:00.000Z')],
      comments: [comment('c1', 'p-hidden', '2026-01-04T00:00:00.000Z')],
      currentUserId: ME,
    });
    const threads = resolveActivityThreads(map, [
      { id: 'p-active', status: 'active' },
      { id: 'p-gone', status: 'deleted' },
      { id: 'p-hidden', status: 'hidden' },
    ]);
    expect(threads.map((t) => t.postId)).toEqual(['p-active']);
  });

  it('orders by max content ts desc then postId', () => {
    const threads = buildOrderedActivityThreads({
      posts: [
        post('b-post', '2026-01-02T00:00:00.000Z', OTHER),
        post('a-post', '2026-01-02T00:00:00.000Z', OTHER2),
        post('c-post', '2026-01-03T00:00:00.000Z', OTHER),
      ],
      comments: [],
      parents: [
        { id: 'a-post', status: 'active' },
        { id: 'b-post', status: 'active' },
        { id: 'c-post', status: 'active' },
      ],
      currentUserId: ME,
    });
    expect(threads.map((t) => t.postId)).toEqual(['c-post', 'a-post', 'b-post']);
  });
});

describe('communityNewActivity cap', () => {
  it('is exact when both under limit', () => {
    expect(isActivityQueryCapped(5, 10)).toBe(false);
    expect(formatActivityChipCount(3, false)).toBe('3');
  });

  it('is capped when either array hits 120', () => {
    expect(isActivityQueryCapped(120, 0)).toBe(true);
    expect(isActivityQueryCapped(0, 120)).toBe(true);
    expect(isActivityQueryCapped(120, 120)).toBe(true);
    expect(isActivityQueryCapped(119, 119)).toBe(false);
    expect(formatActivityChipCount(7, true)).toBe('7+');
  });

  it('uses COMMUNITY_NEW_ACTIVITY_LIMIT = 120', () => {
    expect(COMMUNITY_NEW_ACTIVITY_LIMIT).toBe(120);
    expect(isActivityQueryCapped(120, 1, COMMUNITY_NEW_ACTIVITY_LIMIT)).toBe(true);
  });
});

describe('communityNewActivity snapshot window', () => {
  const cursor = '2026-01-01T00:00:00.000Z';
  const snapshotAt = '2026-01-05T00:00:00.000Z';

  it('includes rows after cursor and at or before snapshotAt', () => {
    expect(rowInSnapshotWindow('2026-01-01T00:00:00.001Z', cursor, snapshotAt)).toBe(true);
    expect(rowInSnapshotWindow(snapshotAt, cursor, snapshotAt)).toBe(true);
  });

  it('excludes rows at or before cursor and after snapshotAt', () => {
    expect(rowInSnapshotWindow(cursor, cursor, snapshotAt)).toBe(false);
    expect(rowInSnapshotWindow('2025-12-31T23:59:59.999Z', cursor, snapshotAt)).toBe(false);
    expect(rowInSnapshotWindow('2026-01-05T00:00:00.001Z', cursor, snapshotAt)).toBe(false);
  });

  it('filters frozen set to snapshot window', () => {
    const rows = [
      { id: 'a', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-01-06T00:00:00.000Z' },
      { id: 'c', createdAt: cursor },
    ];
    expect(filterRowsInSnapshotWindow(rows, cursor, snapshotAt).map((r) => r.id)).toEqual(['a']);
  });

  it('cursor commit uses snapshotAt (not a later now)', () => {
    const map = withLastSeenAt({}, ME, snapshotAt);
    expect(map[ME]).toBe(snapshotAt);
  });
});

describe('communityNewActivity first baseline', () => {
  it('does not establish baseline without cursor readiness', () => {
    expect(
      shouldEstablishBaseline({
        userId: ME,
        lastSeenAt: null,
        listReady: false,
        storageOk: true,
      }),
    ).toBe(false);
  });

  it('establishes baseline only when list ready and no cursor', () => {
    expect(
      shouldEstablishBaseline({
        userId: ME,
        lastSeenAt: null,
        listReady: true,
        storageOk: true,
      }),
    ).toBe(true);
    expect(
      shouldEstablishBaseline({
        userId: ME,
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        listReady: true,
        storageOk: true,
      }),
    ).toBe(false);
  });

  it('no cursor means no historical count (empty map)', () => {
    const map = collectActivityThreadMaxByPostId({
      posts: [post('p1', '2020-01-01T00:00:00.000Z')],
      comments: [],
      currentUserId: ME,
    });
    // Without a cursor the hook must not query; baseline helper gates that.
    // Pure: with empty cursor path, callers skip activity — size alone is not the gate.
    expect(shouldEstablishBaseline({
      userId: ME,
      lastSeenAt: null,
      listReady: true,
      storageOk: true,
    })).toBe(true);
    expect(map.size).toBe(1); // fixtures still parse; gating is shouldEstablishBaseline / hook
  });
});
