import { describe, expect, it } from 'vitest';
import {
  applyCounterDelta,
  uniqueCommenterDelta,
  uniqueReactorDelta,
} from './communityCounters';

describe('applyCounterDelta', () => {
  it('never goes negative', () => {
    expect(applyCounterDelta(0, -1)).toBe(0);
    expect(applyCounterDelta(2, -5)).toBe(0);
    expect(applyCounterDelta(3, 1)).toBe(4);
  });

  it('treats non-finite current as 0', () => {
    expect(applyCounterDelta(Number.NaN, 1)).toBe(1);
  });
});

describe('uniqueReactorDelta', () => {
  const rows = (userIds: string[]) => userIds.map((userId) => ({ userId }));

  it('+1 only on 0→1', () => {
    expect(uniqueReactorDelta([], 'u1', 'add')).toBe(1);
    expect(uniqueReactorDelta(rows(['u1']), 'u1', 'add')).toBe(0);
    expect(uniqueReactorDelta(rows(['u2']), 'u1', 'add')).toBe(1);
    expect(uniqueReactorDelta(rows(['u1', 'u1']), 'u1', 'add')).toBe(0);
  });

  it('−1 only on 1→0', () => {
    expect(uniqueReactorDelta(rows(['u1']), 'u1', 'remove')).toBe(-1);
    expect(uniqueReactorDelta(rows(['u1', 'u1']), 'u1', 'remove')).toBe(0);
    expect(uniqueReactorDelta(rows(['u2']), 'u1', 'remove')).toBe(0);
    expect(uniqueReactorDelta([], 'u1', 'remove')).toBe(0);
  });
});

describe('uniqueCommenterDelta', () => {
  it('uses the same 0↔1 rule on active comments', () => {
    expect(uniqueCommenterDelta([], 'u1', 'add')).toBe(1);
    expect(uniqueCommenterDelta([{ userId: 'u1' }], 'u1', 'add')).toBe(0);
    expect(uniqueCommenterDelta([{ userId: 'u1' }], 'u1', 'remove')).toBe(-1);
    expect(uniqueCommenterDelta([{ userId: 'u1' }, { userId: 'u1' }], 'u1', 'remove')).toBe(0);
  });
});
