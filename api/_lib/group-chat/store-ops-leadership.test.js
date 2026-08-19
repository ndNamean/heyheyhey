import { describe, expect, it } from 'vitest';
import {
  STORE_OPS_LEADERSHIP_ROOM_KIND,
  isStoreOpsLeadershipEligible,
  isStoreOpsLeadershipRoom,
  leadershipLifecycleForbidden,
  nearestLeadershipEscalationRecipients,
  isReservedStoreOpsLeadershipSimilarNameKey,
} from './store-ops-leadership.js';

const defs = [
  { key: 'owner', rank: 0, canAccessAllStores: true, active: true },
  { key: 'admin', rank: 1, canAccessAllStores: true, active: true },
  { key: 'areaManager', rank: 2, canAccessAllStores: true, active: true },
  { key: 'manager', rank: 3, canAccessAllStores: false, active: true },
  { key: 'leader', rank: 4, canAccessAllStores: false, active: true },
  { key: 'subleader', rank: 5, canAccessAllStores: false, active: true },
  { key: 'hybrid', rank: 6, canAccessAllStores: false, active: true },
  { key: 'staff', rank: 7, canAccessAllStores: false, active: true },
  { key: 'viewer', rank: 8, canAccessAllStores: false, active: true },
];

function p(partial) {
  return {
    approvalStatus: 'approved',
    stores: [],
    ...partial,
  };
}

describe('store-ops-leadership (server)', () => {
  it('treats missing roomKind as private and forbids leadership lifecycle', () => {
    expect(isStoreOpsLeadershipRoom({ roomKind: '' })).toBe(false);
    expect(isStoreOpsLeadershipRoom({ roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND })).toBe(true);
    expect(leadershipLifecycleForbidden({ roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND })).toBe(true);
    expect(leadershipLifecycleForbidden({ roomKind: '' })).toBe(false);
    expect(isReservedStoreOpsLeadershipSimilarNameKey('storeoperationsleadershipteampkb')).toBe(
      true,
    );
  });

  it('eligibility matches assignment + subleader rank + approved userId', () => {
    expect(
      isStoreOpsLeadershipEligible(
        p({ userId: 'u1', role: 'subleader', stores: [{ id: 's1' }] }),
        's1',
        defs,
      ),
    ).toBe(true);
    expect(
      isStoreOpsLeadershipEligible(
        p({ userId: 'u2', role: 'staff', stores: [{ id: 's1' }] }),
        's1',
        defs,
      ),
    ).toBe(false);
    expect(
      isStoreOpsLeadershipEligible(
        p({ userId: '', role: 'manager', stores: [{ id: 's1' }] }),
        's1',
        defs,
      ),
    ).toBe(false);
  });

  it('nearest bucket is first non-empty local rank, minus existing; else all-store eligible', () => {
    const profiles = [
      p({ userId: 'sub', role: 'subleader', stores: [{ id: 's1' }] }),
      p({ userId: 'lead', role: 'leader', stores: [{ id: 's1' }] }),
      p({ userId: 'mgr', role: 'manager', stores: [{ id: 's1' }] }),
      p({ userId: 'am', role: 'areaManager', stores: [] }),
      p({ userId: 'assignee', role: 'staff', stores: [{ id: 's1' }] }),
    ];
    expect(
      nearestLeadershipEscalationRecipients({
        storeId: 's1',
        profiles,
        defs,
        existingRecipients: ['assignee', 'sub'],
      }),
    ).toEqual(['am']);

    expect(
      nearestLeadershipEscalationRecipients({
        storeId: 's1',
        profiles,
        defs,
        existingRecipients: ['assignee'],
      }),
    ).toEqual(['sub']);

    const noLocal = [
      p({ userId: 'am', role: 'areaManager', stores: [] }),
      p({ userId: 'assignee', role: 'staff', stores: [{ id: 's1' }] }),
    ];
    expect(
      nearestLeadershipEscalationRecipients({
        storeId: 's1',
        profiles: noLocal,
        defs,
        existingRecipients: ['assignee'],
      }),
    ).toEqual(['am']);

    expect(
      nearestLeadershipEscalationRecipients({
        storeId: 's1',
        profiles: noLocal,
        defs,
        existingRecipients: ['assignee', 'am'],
      }),
    ).toEqual([]);
  });

  it('custom roles join the matching rank number for the local bucket', () => {
    const customDefs = [...defs, { key: 'shift_boss', rank: 5, canAccessAllStores: false, active: true }];
    const profiles = [
      p({ userId: 'custom', role: 'shift_boss', stores: [{ id: 's1' }] }),
      p({ userId: 'lead', role: 'leader', stores: [{ id: 's1' }] }),
    ];
    expect(
      nearestLeadershipEscalationRecipients({
        storeId: 's1',
        profiles,
        defs: customDefs,
        existingRecipients: [],
      }),
    ).toEqual(['custom']);
  });
});
