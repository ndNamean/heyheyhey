import { describe, expect, it } from 'vitest';
import {
  resolveRoleDefinition,
  roleCanManageUsers,
  unwrapLinkedEntity,
} from '../../api/_lib/export/role-capabilities.js';

describe('unwrapLinkedEntity', () => {
  it('returns null for empty values', () => {
    expect(unwrapLinkedEntity(null)).toBeNull();
    expect(unwrapLinkedEntity(undefined)).toBeNull();
    expect(unwrapLinkedEntity([])).toBeNull();
  });

  it('unwraps one-element arrays', () => {
    expect(unwrapLinkedEntity([{ id: 'a' }])).toEqual({ id: 'a' });
  });

  it('passes through objects', () => {
    expect(unwrapLinkedEntity({ id: 'a' })).toEqual({ id: 'a' });
  });
});

describe('resolveRoleDefinition', () => {
  const managerDef = {
    id: 'def-manager',
    key: 'manager',
    active: true,
    canManageUsers: true,
  };

  it('prefers roleDefinitions-by-key over a broken linked value', () => {
    const profile = { role: 'manager', roleDefinition: [] };
    expect(resolveRoleDefinition(profile, [managerDef])).toEqual(managerDef);
  });

  it('prefers by-key over a stale linked empty object', () => {
    const profile = { role: 'manager', roleDefinition: { id: 'stale' } };
    expect(resolveRoleDefinition(profile, [managerDef])).toEqual(managerDef);
  });

  it('falls back to linked entity when key is missing from defs', () => {
    const linked = { id: 'linked', key: 'manager', canManageUsers: true };
    const profile = { role: 'manager', roleDefinition: linked };
    expect(resolveRoleDefinition(profile, [])).toEqual(linked);
  });
});

describe('roleCanManageUsers', () => {
  it('allows manager when matrix grants canManageUsers', () => {
    expect(roleCanManageUsers('manager', { canManageUsers: true })).toBe(true);
  });

  it('denies manager when matrix leaves canManageUsers false', () => {
    expect(roleCanManageUsers('manager', { canManageUsers: false })).toBe(false);
  });

  it('unwraps array-shaped linked definitions', () => {
    expect(roleCanManageUsers('manager', [{ canManageUsers: true }])).toBe(true);
  });

  it('falls back to legacy owner/admin roles when def is missing', () => {
    expect(roleCanManageUsers('owner', null)).toBe(true);
    expect(roleCanManageUsers('admin', null)).toBe(true);
    expect(roleCanManageUsers('manager', null)).toBe(false);
  });
});
