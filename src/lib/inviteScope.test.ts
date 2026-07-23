import { describe, expect, it } from 'vitest';
import {
  canAssignRole,
  rolesAssignableBy,
  storesSelectableBy,
  assertStoreIdsAllowed,
  canViewManagedProfile,
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
