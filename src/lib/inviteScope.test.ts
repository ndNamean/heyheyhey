import { describe, expect, it } from 'vitest';
import {
  canAssignRole,
  rolesAssignableBy,
  storesSelectableBy,
  assertStoreIdsAllowed,
} from './inviteScope';
import { defaultDefinitionsAsEntities } from './roleResolver';
import type { Store } from '../types';

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
    expect(canAssignRole('manager', 'leader', defs)).toBe(true);
    expect(canAssignRole('manager', 'manager', defs)).toBe(false);
    expect(canAssignRole('manager', 'areaManager', defs)).toBe(false);
    expect(canAssignRole('manager', 'admin', defs)).toBe(false);
    const keys = rolesAssignableBy('manager', defs);
    expect(keys).not.toContain('manager');
    expect(keys).not.toContain('owner');
    expect(keys).toContain('staff');
    expect(keys).toContain('leader');
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
