import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoleDefinitions';
import { storesSelectableBy } from './inviteScope';
import { eligibleLogbookAssigneeRoles } from './logbook';
import { defaultDefinitionsAsEntities, seedToDefinition } from './roleResolver';
import { canAccessAllStores, canReview } from './roles';
import type { RoleDefinition, Store } from '../types';

/**
 * Instant LEGACY_BIND canReview keys (owner / AM-tier / manager / leader+subleader / hybrid)
 * before defCanReview. Custom roles are not in this set — that is why Instant also
 * checks `$user.profile.roleDefinition.canReview`.
 */
const INSTANT_LEGACY_REVIEWER_KEYS = new Set([
  'owner',
  'admin',
  'areaManager',
  'manager',
  'leader',
  'subleader',
  'hybrid',
]);

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

const CUSTOM_REVIEWER_KEY = 'regionalReviewer';

function customAllStoreReviewer(): RoleDefinition {
  const admin = DEFAULT_ROLE_DEFINITIONS.find((d) => d.key === 'admin')!;
  return seedToDefinition(
    {
      ...admin,
      key: CUSTOM_REVIEWER_KEY,
      label: 'Regional reviewer',
      isSystem: false,
      rank: 1,
      canReview: true,
      canAccessAllStores: true,
    },
    'custom-regional-reviewer',
  );
}

describe('logbook create permissions (role matrix)', () => {
  it.each(DEFAULT_ROLE_DEFINITIONS)(
    '$key canReview matches whether the create form may open',
    (seed) => {
      expect(canReview(seed.key, defs)).toBe(seed.canReview);
    },
  );

  it.each(DEFAULT_ROLE_DEFINITIONS)(
    '$key canAccessAllStores matches empty-link store pick',
    (seed) => {
      const picked = storesSelectableBy(seed.key, [], stores, defs);
      if (seed.canAccessAllStores) {
        expect(picked).toHaveLength(stores.length);
      } else {
        expect(picked).toHaveLength(0);
      }
    },
  );

  it('manager with a linked store only picks that store', () => {
    expect(storesSelectableBy('manager', ['s1'], stores, defs).map((s) => s.id)).toEqual(['s1']);
  });

  it('eligibleLogbookAssigneeRoles: admin includes manager; staff is empty; manager excludes manager', () => {
    const adminAssignees = eligibleLogbookAssigneeRoles('admin', defs);
    expect(adminAssignees).toContain('manager');
    expect(eligibleLogbookAssigneeRoles('staff', defs)).toEqual([]);
    expect(eligibleLogbookAssigneeRoles('manager', defs)).not.toContain('manager');
  });

  it('custom all-store reviewer may create and pick any store, but is not an Instant legacy reviewer key', () => {
    const defsWithCustom = [...defs, customAllStoreReviewer()];
    expect(canReview(CUSTOM_REVIEWER_KEY, defsWithCustom)).toBe(true);
    expect(canAccessAllStores(CUSTOM_REVIEWER_KEY, defsWithCustom)).toBe(true);
    expect(storesSelectableBy(CUSTOM_REVIEWER_KEY, [], stores, defsWithCustom)).toHaveLength(
      stores.length,
    );
    expect(INSTANT_LEGACY_REVIEWER_KEYS.has(CUSTOM_REVIEWER_KEY)).toBe(false);
  });
});
