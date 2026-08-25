import { describe, expect, it } from 'vitest';
import {
  buildNeedsActionCountDeltaTx,
  computeSubmitterNeedsAction,
  needsActionCountDelta,
  nextNeedsActionCount,
  readSubmitterNeedsAction,
} from './reportNeedsAction';

describe('computeSubmitterNeedsAction', () => {
  it('is true when report status is need_correction or rejected', () => {
    expect(computeSubmitterNeedsAction('need_correction', [])).toBe(true);
    expect(computeSubmitterNeedsAction('rejected', [{ status: 'approved' }])).toBe(true);
  });

  it('is true when any response is rejected or need_correction even if report waiting_approval', () => {
    expect(
      computeSubmitterNeedsAction('waiting_approval', [
        { status: 'approved' },
        { status: 'need_correction' },
      ]),
    ).toBe(true);
    expect(
      computeSubmitterNeedsAction('waiting_approval', [{ status: 'rejected' }]),
    ).toBe(true);
  });

  it('is false when waiting/approved and no flagged responses', () => {
    expect(
      computeSubmitterNeedsAction('waiting_approval', [
        { status: 'waiting_approval' },
        { status: 'approved' },
      ]),
    ).toBe(false);
    expect(computeSubmitterNeedsAction('approved', [{ status: 'approved' }])).toBe(false);
  });
});

describe('readSubmitterNeedsAction', () => {
  it('prefers denormalized flag over compute', () => {
    expect(
      readSubmitterNeedsAction({
        status: 'waiting_approval',
        submitterNeedsAction: true,
        responses: [{ status: 'approved' }],
      }),
    ).toBe(true);
    expect(
      readSubmitterNeedsAction({
        status: 'rejected',
        submitterNeedsAction: false,
        responses: [{ status: 'rejected' }],
      }),
    ).toBe(false);
  });

  it('falls back to compute when flag missing', () => {
    expect(
      readSubmitterNeedsAction({
        status: 'waiting_approval',
        responses: [{ status: 'need_correction' }],
      }),
    ).toBe(true);
  });
});

describe('needsActionCountDelta / nextNeedsActionCount', () => {
  it('flips false→true as +1 and true→false as -1', () => {
    expect(needsActionCountDelta(false, true)).toBe(1);
    expect(needsActionCountDelta(true, false)).toBe(-1);
    expect(needsActionCountDelta(true, true)).toBe(0);
    expect(needsActionCountDelta(false, false)).toBe(0);
  });

  it('floors at 0', () => {
    expect(nextNeedsActionCount(0, -1)).toBe(0);
    expect(nextNeedsActionCount(2, -1)).toBe(1);
    expect(nextNeedsActionCount(undefined, 1)).toBe(1);
  });
});

describe('buildNeedsActionCountDeltaTx', () => {
  it('creates row with userId when missing; updates count-only when existing', () => {
    const ops: unknown[] = [];
    const tx = {
      reportNeedsActionCounts: new Proxy(
        {},
        {
          get: (_t, rowId: string) => ({
            update: (attrs: Record<string, unknown>) => {
              const chunk = { __ops: [['update', 'reportNeedsActionCounts', rowId, attrs]] };
              ops.push(chunk);
              return chunk;
            },
          }),
        },
      ),
    };

    buildNeedsActionCountDeltaTx('u1', 1, null, {
      now: '2026-01-01T00:00:00.000Z',
      rowId: 'new1',
      tx,
    });
    expect(ops[0]).toEqual({
      __ops: [
        [
          'update',
          'reportNeedsActionCounts',
          'new1',
          {
            userId: 'u1',
            needsActionCount: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ],
    });

    ops.length = 0;
    buildNeedsActionCountDeltaTx(
      'u1',
      -1,
      { id: 'c1', userId: 'u1', needsActionCount: 2, updatedAt: '' },
      { now: '2026-01-02T00:00:00.000Z', tx },
    );
    expect(ops[0]).toEqual({
      __ops: [
        [
          'update',
          'reportNeedsActionCounts',
          'c1',
          {
            needsActionCount: 1,
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      ],
    });
  });

  it('returns null when delta is 0', () => {
    expect(buildNeedsActionCountDeltaTx('u1', 0, null)).toBeNull();
  });
});
