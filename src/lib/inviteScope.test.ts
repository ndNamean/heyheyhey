import { describe, expect, it } from 'vitest';
import {
  canAssignRole,
  rolesAssignableBy,
  storesSelectableBy,
  assertStoreIdsAllowed,
  canViewManagedProfile,
  stableActorStoreIds,
} from './inviteScope';
import { defaultDefinitionsAsEntities } from './roleResolver';
import { canApproveItem, canReview } from './roles';
import type { Profile, Store } from '../types';

const defs = defaultDefinitionsAsEntities();

const stores: Store[] = [
  {
    id: 's1',
    code: 'A',
    name: 'Store A',
    address: '',
    timezone: '',
    active: true,
    createdAt: '',
    updatedAt: '',
  } as Store,
  {
    id: 's2',
    code: 'B',
    name: 'Store B',
    address: '',
    timezone: '',
    active: true,
    createdAt: '',
    updatedAt: '',
  } as Store,
];

function profileWithStores(role: string, storeIds: string[]): Profile {
  return {
    id: 'p1',
    userId: 'u1',
    email: 'a@b.c',
    displayName: 'A',
    role,
    approvalStatus: 'approved',
    stores: storeIds.map((id) => ({ id })),
    createdAt: '',
    updatedAt: '',
  } as Profile;
}

describe('canAssignRole / rolesAssignableBy', () => {
  it('lets owner assign any role including elevated', () => {
    expect(canAssignRole('owner', 'owner', defs)).toBe(true);
    expect(canAssignRole('owner', 'admin', defs)).toBe(true);
    expect(canAssignRole('owner', 'manager', defs)).toBe(true);
    expect(rolesAssignableBy('owner', defs)).toContain('owner');
    expect(rolesAssignableBy('owner', defs)).toContain('staff');
  });

  it('lets manager invite only strictly lower ranks', () => {
    expect(canAssignRole('manager', 'staff', defs)).toBe(true);
    expect(canAssignRole('manager', 'hybrid', defs)).toBe(true);
    expect(canAssignRole('manager', 'leader', defs)).toBe(true);
    expect(canAssignRole('manager', 'manager', defs)).toBe(false);
    expect(canAssignRole('manager', 'areaManager', defs)).toBe(false);
    expect(canAssignRole('manager', 'admin', defs)).toBe(false);
    const keys = rolesAssignableBy('manager', defs);
    expect(keys).not.toContain('manager');
    expect(keys).not.toContain('owner');
    expect(keys).toContain('staff');
    expect(keys).toContain('hybrid');
    expect(keys).toContain('leader');
  });

  it('places hybrid rank between subleader and staff', () => {
    const byKey = Object.fromEntries(defs.map((d) => [d.key, d.rank]));
    expect(byKey.subleader).toBe(5);
    expect(byKey.hybrid).toBe(6);
    expect(byKey.staff).toBe(7);
    expect(byKey.viewer).toBe(8);
    expect(byKey.hybrid).toBeGreaterThan(byKey.subleader);
    expect(byKey.hybrid).toBeLessThan(byKey.staff);
    expect(canAssignRole('hybrid', 'staff', defs)).toBe(true);
    expect(canAssignRole('staff', 'hybrid', defs)).toBe(false);
    expect(canAssignRole('subleader', 'hybrid', defs)).toBe(true);
  });

  it('lets hybrid review staff submissions like other reviewers', () => {
    expect(canReview('hybrid', defs)).toBe(true);
    expect(canReview('staff', defs)).toBe(false);
    expect(canApproveItem('staff', 'hybrid', [], defs)).toBe(true);
    expect(canApproveItem('hybrid', 'manager', [], defs)).toBe(true);
    expect(canApproveItem('hybrid', 'staff', [], defs)).toBe(false);
    expect(canApproveItem('staff', 'hybrid', ['hybrid'], defs)).toBe(true);
  });

  it('only higher-ranked roles can approve (rank + matrix, not per-item list)', () => {
    // leader (rank 4) cannot approve manager (rank 3) even if in item approverRoles
    expect(canApproveItem('manager', 'leader', ['leader'], defs)).toBe(false);
    // subleader (rank 5) cannot approve manager (rank 3)
    expect(canApproveItem('manager', 'subleader', ['subleader'], defs)).toBe(false);
    // peer manager cannot approve peer manager
    expect(canApproveItem('manager', 'manager', ['manager'], defs)).toBe(false);
    // areaManager (rank 2) CAN approve manager via matrix
    expect(canApproveItem('manager', 'areaManager', [], defs)).toBe(true);
    // admin (rank 1) CAN approve manager via matrix
    expect(canApproveItem('manager', 'admin', [], defs)).toBe(true);
    // owner always
    expect(canApproveItem('manager', 'owner', [], defs)).toBe(true);
    // staff (rank 7) cannot approve hybrid (rank 6)
    expect(canApproveItem('hybrid', 'staff', ['staff'], defs)).toBe(false);
    // leader (rank 4) cannot approve subleader (rank 5) — not in default matrix
    expect(canApproveItem('subleader', 'leader', [], defs)).toBe(false);
    // manager (rank 3) CAN approve staff (rank 7) via matrix
    expect(canApproveItem('staff', 'manager', [], defs)).toBe(true);
  });

  it('blocks areaManager from inviting owner/areaManager via elevated rules', () => {
    expect(canAssignRole('areaManager', 'owner', defs)).toBe(false);
    expect(canAssignRole('areaManager', 'areaManager', defs)).toBe(false);
    expect(canAssignRole('areaManager', 'manager', defs)).toBe(true);
  });
});

describe('storesSelectableBy', () => {
  it('returns all stores for roles with canAccessAllStores', () => {
    expect(storesSelectableBy('owner', [], stores, defs)).toHaveLength(2);
    expect(storesSelectableBy('areaManager', ['s1'], stores, defs)).toHaveLength(2);
  });

  it('returns only assigned stores for manager', () => {
    const scoped = storesSelectableBy('manager', ['s1'], stores, defs);
    expect(scoped.map((s) => s.id)).toEqual(['s1']);
  });

  it('assertStoreIdsAllowed rejects out-of-scope ids for manager', () => {
    expect(assertStoreIdsAllowed('manager', ['s1'], ['s1'], defs)).toBeNull();
    expect(assertStoreIdsAllowed('manager', ['s1'], ['s2'], defs)).toMatch(/Forbidden/);
    expect(assertStoreIdsAllowed('owner', [], ['s2'], defs)).toBeNull();
  });
});

describe('stableActorStoreIds + storesSelectableBy', () => {
  it('keeps manager selection after live store links briefly go empty', () => {
    const remembered = { current: [] as string[] };
    const linked = profileWithStores('manager', ['s1', 's2']);
    expect(stableActorStoreIds(linked, undefined, remembered)).toEqual(['s1', 's2']);

    const emptied = profileWithStores('manager', []);
    const sticky = stableActorStoreIds(emptied, undefined, remembered);
    expect(sticky).toEqual(['s1', 's2']);
    expect(storesSelectableBy('manager', sticky, stores, defs).map((s) => s.id)).toEqual([
      's1',
      's2',
    ]);
  });

  it('selects none for a manager who never had store links', () => {
    const remembered = { current: [] as string[] };
    const neverLinked = profileWithStores('manager', []);
    const ids = stableActorStoreIds(neverLinked, undefined, remembered);
    expect(ids).toEqual([]);
    expect(storesSelectableBy('manager', ids, stores, defs)).toHaveLength(0);
  });

  it('lets owner / areaManager use the full catalog regardless of linked stores', () => {
    const remembered = { current: [] as string[] };
    const ownerIds = stableActorStoreIds(profileWithStores('owner', ['s1']), undefined, remembered);
    expect(storesSelectableBy('owner', ownerIds, stores, defs)).toHaveLength(2);

    const areaRemembered = { current: [] as string[] };
    const areaIds = stableActorStoreIds(
      profileWithStores('areaManager', []),
      undefined,
      areaRemembered,
    );
    expect(storesSelectableBy('areaManager', areaIds, stores, defs)).toHaveLength(2);
  });

  it('falls back to actor row in allProfiles when profile.stores is empty', () => {
    const remembered = { current: [] as string[] };
    const emptyAuthProfile = profileWithStores('manager', []);
    const rowInQuery = profileWithStores('manager', ['s2']);
    expect(stableActorStoreIds(emptyAuthProfile, [rowInQuery], remembered)).toEqual(['s2']);
  });
});

describe('canViewManagedProfile', () => {
  const base = {
    id: 'p1',
    userId: 'u1',
    email: 'a@b.c',
    displayName: 'A',
    approvalStatus: 'approved' as const,
    createdAt: '',
    updatedAt: '',
  };

  it('hides owner from non-owners', () => {
    const owner = { ...base, role: 'owner', stores: [{ id: 's1' }] } as Profile;
    expect(canViewManagedProfile('manager', owner, ['s1'], defs)).toBe(false);
    expect(canViewManagedProfile('admin', owner, ['s1'], defs)).toBe(false);
    expect(canViewManagedProfile('owner', owner, [], defs)).toBe(true);
  });

  it('hides peer managers and higher roles from a manager', () => {
    const peer = { ...base, role: 'manager', stores: [{ id: 's1' }] } as Profile;
    const admin = { ...base, role: 'admin', stores: [{ id: 's1' }] } as Profile;
    const staff = { ...base, role: 'staff', stores: [{ id: 's1' }] } as Profile;
    expect(canViewManagedProfile('manager', peer, ['s1'], defs)).toBe(false);
    expect(canViewManagedProfile('manager', admin, ['s1'], defs)).toBe(false);
    expect(canViewManagedProfile('manager', staff, ['s1'], defs)).toBe(true);
  });

  it('requires store overlap for managers', () => {
    const staffOther = { ...base, role: 'staff', stores: [{ id: 's2' }] } as Profile;
    const staffMine = { ...base, role: 'staff', stores: [{ id: 's1' }] } as Profile;
    expect(canViewManagedProfile('manager', staffOther, ['s1'], defs)).toBe(false);
    expect(canViewManagedProfile('manager', staffMine, ['s1'], defs)).toBe(true);
  });
});
