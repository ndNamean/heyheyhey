import { describe, expect, it } from 'vitest';
import {
  canInviteAsRole,
  assertInviteStoreIds,
  rankOfRole,
} from '../../api/_lib/export/invite-scope.js';

const defs = [
  { key: 'owner', rank: 0, active: true, canAccessAllStores: true },
  { key: 'admin', rank: 1, active: true, canAccessAllStores: true },
  { key: 'areaManager', rank: 2, active: true, canAccessAllStores: true },
  { key: 'manager', rank: 3, active: true, canAccessAllStores: false },
  { key: 'leader', rank: 4, active: true, canAccessAllStores: false },
  { key: 'staff', rank: 6, active: true, canAccessAllStores: false },
];

describe('invite-scope API helpers', () => {
  it('ranks roles from definitions', () => {
    expect(rankOfRole('manager', defs)).toBe(3);
    expect(rankOfRole('ghost', defs)).toBe(999);
  });

  it('allows manager to invite subordinates only', () => {
    expect(canInviteAsRole('manager', 'staff', defs)).toBe(true);
    expect(canInviteAsRole('manager', 'leader', defs)).toBe(true);
    expect(canInviteAsRole('manager', 'manager', defs)).toBe(false);
    expect(canInviteAsRole('manager', 'admin', defs)).toBe(false);
    expect(canInviteAsRole('manager', 'areaManager', defs)).toBe(false);
  });

  it('allows owner to invite elevated roles', () => {
    expect(canInviteAsRole('owner', 'areaManager', defs)).toBe(true);
    expect(canInviteAsRole('owner', 'owner', defs)).toBe(true);
  });

  it('scopes store ids for manager', () => {
    expect(
      assertInviteStoreIds('manager', ['s1'], ['s1'], { canAccessAllStores: false }, defs),
    ).toBeNull();
    expect(
      assertInviteStoreIds('manager', ['s1'], ['s2'], { canAccessAllStores: false }, defs),
    ).toMatch(/Forbidden/);
    expect(
      assertInviteStoreIds('owner', [], ['s2'], { canAccessAllStores: true }, defs),
    ).toBeNull();
  });
});
