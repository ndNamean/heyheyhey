import { describe, expect, it } from 'vitest';
import { defaultDefinitionsAsEntities } from './roleResolver';
import {
  STORE_OPS_LEADERSHIP_ROOM_KIND,
  diffLeadershipMembers,
  expectedLeadershipMembers,
  isReservedStoreOpsLeadershipSimilarNameKey,
  isStoreOpsLeadershipEligible,
  isStoreOpsLeadershipRoom,
  partitionGroupMembershipRoomIds,
  roleEligibilityCrossedSubleader,
  storeOpsLeadershipRoomName,
  storeOpsLeadershipSimilarNameKey,
} from './storeOpsLeadership';
import type { Profile, RoleDefinition } from '../types';

const defs = defaultDefinitionsAsEntities();

function profile(partial: Partial<Profile> & Pick<Profile, 'id' | 'userId' | 'role'>): Profile {
  return {
    displayName: partial.displayName || partial.userId,
    email: `${partial.userId}@ex.com`,
    approvalStatus: 'approved',
    stores: [],
    createdAt: '',
    updatedAt: '',
    ...partial,
  } as Profile;
}

describe('store ops leadership helpers', () => {
  it('names rooms from store code and treats missing roomKind as private', () => {
    expect(storeOpsLeadershipRoomName('PKB')).toBe('Store Operations Leadership Team - PKB');
    expect(isStoreOpsLeadershipRoom({ roomKind: '' })).toBe(false);
    expect(isStoreOpsLeadershipRoom({})).toBe(false);
    expect(isStoreOpsLeadershipRoom({ roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND })).toBe(true);
    expect(isReservedStoreOpsLeadershipSimilarNameKey(storeOpsLeadershipSimilarNameKey('PKB'))).toBe(
      true,
    );
    expect(isReservedStoreOpsLeadershipSimilarNameKey('ops huddle')).toBe(false);
  });

  it('eligibility matrix: PKB subleader/leader/manager in; staff/hybrid/viewer/pending/other-store manager out', () => {
    const storeId = 'pkb';
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'p1', userId: 'u1', role: 'subleader', stores: [{ id: storeId } as never] }),
        storeId,
        defs,
      ),
    ).toBe(true);
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'p2', userId: 'u2', role: 'leader', stores: [{ id: storeId } as never] }),
        storeId,
        defs,
      ),
    ).toBe(true);
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'p3', userId: 'u3', role: 'manager', stores: [{ id: storeId } as never] }),
        storeId,
        defs,
      ),
    ).toBe(true);
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'p4', userId: 'u4', role: 'staff', stores: [{ id: storeId } as never] }),
        storeId,
        defs,
      ),
    ).toBe(false);
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'p5', userId: 'u5', role: 'hybrid', stores: [{ id: storeId } as never] }),
        storeId,
        defs,
      ),
    ).toBe(false);
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'p6', userId: 'u6', role: 'viewer', stores: [{ id: storeId } as never] }),
        storeId,
        defs,
      ),
    ).toBe(false);
    expect(
      isStoreOpsLeadershipEligible(
        profile({
          id: 'p7',
          userId: 'u7',
          role: 'manager',
          approvalStatus: 'pending',
          stores: [{ id: storeId } as never],
        }),
        storeId,
        defs,
      ),
    ).toBe(false);
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'p8', userId: 'u8', role: 'manager', stores: [{ id: 'other' } as never] }),
        storeId,
        defs,
      ),
    ).toBe(false);
  });

  it('includes custom ranks at or above subleader and canAccessAllStores in every store', () => {
    const customIn: RoleDefinition[] = [
      ...defs,
      {
        ...defs[0],
        id: 'custom-in',
        key: 'ops_custom',
        rank: 5,
        canAccessAllStores: false,
      },
    ];
    const customOut: RoleDefinition[] = [
      ...defs,
      {
        ...defs[0],
        id: 'custom-out',
        key: 'floor_custom',
        rank: 6,
        canAccessAllStores: false,
      },
    ];
    expect(
      isStoreOpsLeadershipEligible(
        profile({
          id: 'c1',
          userId: 'uc1',
          role: 'ops_custom',
          stores: [{ id: 's1' } as never],
        }),
        's1',
        customIn,
      ),
    ).toBe(true);
    expect(
      isStoreOpsLeadershipEligible(
        profile({
          id: 'c2',
          userId: 'uc2',
          role: 'floor_custom',
          stores: [{ id: 's1' } as never],
        }),
        's1',
        customOut,
      ),
    ).toBe(false);
    expect(
      isStoreOpsLeadershipEligible(
        profile({ id: 'am', userId: 'uam', role: 'areaManager', stores: [] }),
        'any-store',
        defs,
      ),
    ).toBe(true);
  });

  it('promote/demote flips eligibility and member diff is add/remove only', () => {
    const storeId = 's1';
    const staff = profile({
      id: 'ps',
      userId: 'us',
      role: 'staff',
      stores: [{ id: storeId } as never],
    });
    const leader = { ...staff, role: 'leader' as const };
    expect(isStoreOpsLeadershipEligible(staff, storeId, defs)).toBe(false);
    expect(isStoreOpsLeadershipEligible(leader, storeId, defs)).toBe(true);

    const expected = expectedLeadershipMembers([leader], storeId, defs).map((p) => ({
      userId: p.userId,
      profileId: p.id,
    }));
    expect(expected).toEqual([{ userId: 'us', profileId: 'ps' }]);
    expect(diffLeadershipMembers(expected, [])).toMatchObject({
      noOp: false,
      toAdd: [{ userId: 'us', profileId: 'ps' }],
      toRemove: [],
    });
    expect(diffLeadershipMembers(expected, [{ id: 'm1', userId: 'us', profileId: 'ps' }])).toMatchObject({
      noOp: true,
    });
    expect(
      diffLeadershipMembers([], [{ id: 'm1', userId: 'us', profileId: 'ps' }]),
    ).toMatchObject({
      noOp: false,
      toAdd: [],
      toRemove: [{ id: 'm1', userId: 'us' }],
    });
  });

  it('splits unread room ids so private and leadership caps stay independent', () => {
    const partitioned = partitionGroupMembershipRoomIds([
      { roomId: 'g-private', room: { roomKind: '' } as never },
      { roomId: 'g-lead', room: { roomKind: STORE_OPS_LEADERSHIP_ROOM_KIND } as never },
      { roomId: 'g-legacy', room: {} as never },
    ]);
    expect(partitioned.privateIds.sort()).toEqual(['g-legacy', 'g-private']);
    expect(partitioned.leadershipIds).toEqual(['g-lead']);
  });

  it('detects rank crossing the subleader threshold', () => {
    const before = defs;
    const after = defs.map((d) =>
      d.key === 'subleader' ? { ...d, rank: 8 } : d.key === 'staff' ? { ...d, rank: 5 } : d,
    );
    expect(roleEligibilityCrossedSubleader(before, after)).toBe(true);
    expect(roleEligibilityCrossedSubleader(before, before)).toBe(false);
  });
});
