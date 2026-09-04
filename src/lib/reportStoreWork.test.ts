import { describe, expect, it } from 'vitest';
import {
  classifyStoreWorkResponses,
  filterStoreWorkResponses,
  isStoreWorkResponse,
} from './reportStoreWork';

describe('isStoreWorkResponse', () => {
  it('counts rejected and need_correction always', () => {
    expect(isStoreWorkResponse({ status: 'rejected', required: false })).toBe(true);
    expect(isStoreWorkResponse({ status: 'need_correction' })).toBe(true);
  });

  it('counts not_started only when required !== false', () => {
    expect(isStoreWorkResponse({ status: 'not_started' })).toBe(true);
    expect(isStoreWorkResponse({ status: 'not_started', required: true })).toBe(true);
    expect(isStoreWorkResponse({ status: 'not_started', required: false })).toBe(false);
  });

  it('ignores waiting_approval and approved', () => {
    expect(isStoreWorkResponse({ status: 'waiting_approval' })).toBe(false);
    expect(isStoreWorkResponse({ status: 'approved' })).toBe(false);
  });
});

describe('classifyStoreWorkResponses', () => {
  it('splits complete vs fix counts', () => {
    expect(
      classifyStoreWorkResponses([
        { status: 'not_started', required: true },
        { status: 'not_started', required: false },
        { status: 'need_correction' },
        { status: 'rejected' },
        { status: 'approved' },
      ]),
    ).toEqual({ completeCount: 1, fixCount: 2, total: 3 });
  });
});

describe('filterStoreWorkResponses', () => {
  it('keeps only store-work rows', () => {
    const rows = filterStoreWorkResponses([
      { id: 'a', status: 'not_started', required: false },
      { id: 'b', status: 'not_started', required: true },
      { id: 'c', status: 'rejected' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
  });
});
