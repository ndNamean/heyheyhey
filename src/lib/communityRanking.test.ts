import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_FAMOUS_CANDIDATE_LIMIT,
  COMMUNITY_FAMOUS_ENGAGEMENT_HYSTERESIS,
  COMMUNITY_FAMOUS_WINDOW_MS,
  engagementSupport,
  selectFamousPost,
  type FamousCandidate,
} from './communityRanking';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');

function post(partial: Partial<FamousCandidate> & Pick<FamousCandidate, 'id'>): FamousCandidate {
  return {
    status: 'active',
    createdAt: '2026-09-06T12:00:00.000Z',
    lastActivityAt: '2026-09-06T12:00:00.000Z',
    famousVoteCount: 0,
    uniqueReactorCount: 0,
    uniqueCommenterCount: 0,
    ...partial,
  };
}

describe('famous constants', () => {
  it('uses a 7-day window, 40-candidate cap, and hysteresis of 3', () => {
    expect(COMMUNITY_FAMOUS_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(COMMUNITY_FAMOUS_CANDIDATE_LIMIT).toBe(40);
    expect(COMMUNITY_FAMOUS_ENGAGEMENT_HYSTERESIS).toBe(3);
  });

  it('scores engagement as commenters*2 + reactors', () => {
    expect(engagementSupport({ uniqueCommenterCount: 3, uniqueReactorCount: 4 })).toBe(10);
  });
});

describe('selectFamousPost', () => {
  it('returns null when nothing is eligible', () => {
    expect(selectFamousPost([], NOW)).toBeNull();
    expect(
      selectFamousPost(
        [post({ id: 'old', createdAt: '2026-08-01T00:00:00.000Z', famousVoteCount: 99 })],
        NOW,
      ),
    ).toBeNull();
    expect(selectFamousPost([post({ id: 'hidden', status: 'hidden', famousVoteCount: 9 })], NOW)).toBeNull();
  });

  it('lets the unique vote leader win immediately', () => {
    const a = post({ id: 'a', famousVoteCount: 5, uniqueCommenterCount: 0 });
    const b = post({ id: 'b', famousVoteCount: 2, uniqueCommenterCount: 40 });
    expect(selectFamousPost([a, b], NOW)?.id).toBe('a');
  });

  it('breaks a vote tie with a large engagement gap (≥3)', () => {
    const a = post({
      id: 'a',
      famousVoteCount: 4,
      uniqueCommenterCount: 5,
      uniqueReactorCount: 0,
      createdAt: '2026-09-06T10:00:00.000Z',
    });
    const b = post({
      id: 'b',
      famousVoteCount: 4,
      uniqueCommenterCount: 1,
      uniqueReactorCount: 0,
      createdAt: '2026-09-05T10:00:00.000Z',
    });
    expect(engagementSupport(a) - engagementSupport(b)).toBeGreaterThanOrEqual(3);
    expect(selectFamousPost([a, b], NOW)?.id).toBe('a');
  });

  it('keeps the older post when the engagement gap is < 3', () => {
    const newer = post({
      id: 'newer',
      famousVoteCount: 4,
      uniqueReactorCount: 2,
      createdAt: '2026-09-06T18:00:00.000Z',
    });
    const older = post({
      id: 'older',
      famousVoteCount: 4,
      uniqueReactorCount: 0,
      createdAt: '2026-09-06T08:00:00.000Z',
    });
    expect(engagementSupport(newer) - engagementSupport(older)).toBeLessThan(3);
    expect(selectFamousPost([newer, older], NOW)?.id).toBe('older');
  });

  it('uses lastActivityAt when gap ≥ 3 and top engagement is tied', () => {
    const quiet = post({
      id: 'quiet',
      famousVoteCount: 3,
      uniqueCommenterCount: 4,
      lastActivityAt: '2026-09-06T10:00:00.000Z',
      createdAt: '2026-09-06T09:00:00.000Z',
    });
    const hot = post({
      id: 'hot',
      famousVoteCount: 3,
      uniqueCommenterCount: 4,
      lastActivityAt: '2026-09-07T01:00:00.000Z',
      createdAt: '2026-09-06T08:00:00.000Z',
    });
    const lag = post({
      id: 'lag',
      famousVoteCount: 3,
      uniqueCommenterCount: 1,
      lastActivityAt: '2026-09-07T08:00:00.000Z',
    });
    expect(engagementSupport(hot) - engagementSupport(lag)).toBeGreaterThanOrEqual(3);
    expect(selectFamousPost([quiet, hot, lag], NOW)?.id).toBe('hot');
  });

  it('breaks a stable-leader createdAt tie with id asc', () => {
    const a = post({
      id: 'aaa',
      famousVoteCount: 1,
      uniqueReactorCount: 1,
      createdAt: '2026-09-06T12:00:00.000Z',
    });
    const b = post({
      id: 'bbb',
      famousVoteCount: 1,
      uniqueReactorCount: 1,
      createdAt: '2026-09-06T12:00:00.000Z',
    });
    expect(selectFamousPost([b, a], NOW)?.id).toBe('aaa');
  });
});
