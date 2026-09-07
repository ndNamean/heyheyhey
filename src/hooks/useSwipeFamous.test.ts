import { describe, expect, it } from 'vitest';
import {
  SWIPE_FAMOUS_ABORT_DY,
  SWIPE_FAMOUS_COMMIT_PX,
  SWIPE_FAMOUS_EDGE_PX,
  resolveSwipeFamousMove,
  shouldEnableSwipeFamous,
} from './useSwipeFamous';

describe('swipe famous constants', () => {
  it('commits between 56–72px and aborts vertical / edge starts', () => {
    expect(SWIPE_FAMOUS_COMMIT_PX).toBeGreaterThanOrEqual(56);
    expect(SWIPE_FAMOUS_COMMIT_PX).toBeLessThanOrEqual(72);
    expect(SWIPE_FAMOUS_ABORT_DY).toBe(24);
    expect(SWIPE_FAMOUS_EDGE_PX).toBe(24);
  });
});

describe('resolveSwipeFamousMove', () => {
  it('ignores starts from the left edge (system back)', () => {
    expect(
      resolveSwipeFamousMove({
        startClientX: 12,
        startClientY: 100,
        clientX: 90,
        clientY: 100,
      }),
    ).toMatchObject({ ignore: true, committed: false });
  });

  it('aborts when |dy| > 24', () => {
    expect(
      resolveSwipeFamousMove({
        startClientX: 80,
        startClientY: 100,
        clientX: 90,
        clientY: 130,
      }),
    ).toMatchObject({ aborted: true, committed: false });
  });

  it('aborts when vertical movement dominates', () => {
    expect(
      resolveSwipeFamousMove({
        startClientX: 80,
        startClientY: 100,
        clientX: 88,
        clientY: 118,
      }),
    ).toMatchObject({ aborted: true, committed: false });
  });

  it('commits right for Famous and left for skip', () => {
    expect(
      resolveSwipeFamousMove({
        startClientX: 80,
        startClientY: 200,
        clientX: 80 + SWIPE_FAMOUS_COMMIT_PX,
        clientY: 204,
      }),
    ).toMatchObject({ committed: 'right', aborted: false });

    expect(
      resolveSwipeFamousMove({
        startClientX: 180,
        startClientY: 200,
        clientX: 180 - SWIPE_FAMOUS_COMMIT_PX,
        clientY: 200,
      }),
    ).toMatchObject({ committed: 'left', aborted: false });
  });

  it('does not commit below the threshold (snap-back)', () => {
    expect(
      resolveSwipeFamousMove({
        startClientX: 80,
        startClientY: 200,
        clientX: 80 + 40,
        clientY: 200,
      }),
    ).toMatchObject({ committed: false, aborted: false, ignore: false });
  });
});

describe('reduced motion', () => {
  it('disables swipe so only the Famous button remains', () => {
    expect(shouldEnableSwipeFamous(true)).toBe(false);
    expect(shouldEnableSwipeFamous(false)).toBe(true);
  });
});
