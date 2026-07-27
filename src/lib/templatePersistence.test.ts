import { describe, expect, it } from 'vitest';
import {
  ALL_ASSIGNED_ROLES_SENTINEL,
  isAllAssignedRoles,
  itemPayload,
  itemVisibleToRole,
  parseAssignedRoles,
  templateItemToDraft,
  toAssignedRolePrimary,
  type TemplateItemDraft,
} from './templatePersistence';
import type { TemplateItem } from '../types';

function baseDraft(overrides: Partial<TemplateItemDraft> = {}): TemplateItemDraft {
  return {
    id: 'item-1',
    section: 'Kitchen',
    title: 'Clean',
    requirement: 'Wipe',
    proofType: 'tick',
    required: true,
    assignedRoles: ['staff'],
    approverRoles: ['leader'],
    weight: 1,
    failureCategory: 'Hygiene',
    ...overrides,
  };
}

function baseItem(overrides: Partial<TemplateItem> = {}): TemplateItem {
  return {
    id: 'item-1',
    section: 'Kitchen',
    title: 'Clean',
    requirement: 'Wipe',
    proofType: 'tick',
    required: true,
    assignedRole: 'staff',
    approverRolesJson: '["leader"]',
    weight: 1,
    failureCategory: 'Hygiene',
    sortOrder: 0,
    ...overrides,
  };
}

describe('parseAssignedRoles', () => {
  it('falls back from legacy assignedRole string to a one-element array', () => {
    expect(parseAssignedRoles(undefined, 'leader')).toEqual(['leader']);
    expect(parseAssignedRoles('', 'hybrid')).toEqual(['hybrid']);
    expect(parseAssignedRoles('[]', 'manager')).toEqual(['manager']);
    expect(parseAssignedRoles('not-json', 'staff')).toEqual(['staff']);
  });

  it('defaults to staff when neither JSON nor legacy role is set', () => {
    expect(parseAssignedRoles(undefined)).toEqual(['staff']);
    expect(parseAssignedRoles('')).toEqual(['staff']);
    expect(parseAssignedRoles(undefined, '')).toEqual(['staff']);
  });

  it('prefers a non-empty assignedRolesJson array over legacy assignedRole', () => {
    expect(parseAssignedRoles('["leader","staff"]', 'manager')).toEqual(['leader', 'staff']);
    expect(parseAssignedRoles('["*"]', 'staff')).toEqual(['*']);
  });
});

describe('isAllAssignedRoles / itemVisibleToRole', () => {
  it('treats ["*"] as matching any role', () => {
    expect(isAllAssignedRoles([ALL_ASSIGNED_ROLES_SENTINEL])).toBe(true);
    expect(itemVisibleToRole(['*'], 'staff')).toBe(true);
    expect(itemVisibleToRole(['*'], 'owner')).toBe(true);
    expect(itemVisibleToRole({ assignedRolesJson: '["*"]' }, 'manager')).toBe(true);
  });

  it('includes only listed roles for multi-role assignments', () => {
    const roles = ['staff', 'hybrid'];
    expect(itemVisibleToRole(roles, 'staff')).toBe(true);
    expect(itemVisibleToRole(roles, 'hybrid')).toBe(true);
    expect(itemVisibleToRole(roles, 'leader')).toBe(false);
    expect(
      itemVisibleToRole(
        { assignedRolesJson: '["leader","manager"]', assignedRole: 'staff' },
        'manager',
      ),
    ).toBe(true);
    expect(
      itemVisibleToRole(
        { assignedRolesJson: '["leader","manager"]', assignedRole: 'staff' },
        'staff',
      ),
    ).toBe(false);
  });

  it('uses legacy assignedRole when JSON is absent', () => {
    expect(itemVisibleToRole({ assignedRole: 'leader' }, 'leader')).toBe(true);
    expect(itemVisibleToRole({ assignedRole: 'leader' }, 'staff')).toBe(false);
  });
});

describe('toAssignedRolePrimary / itemPayload', () => {
  it('writes primary assignedRole as * when All is selected', () => {
    expect(toAssignedRolePrimary(['*'])).toBe('*');
    expect(toAssignedRolePrimary(['*', 'staff'])).toBe('*');
    const payload = itemPayload(baseDraft({ assignedRoles: ['*'] }), 0);
    expect(payload.assignedRole).toBe('*');
    expect(payload.assignedRolesJson).toBe('["*"]');
  });

  it('writes primary assignedRole as the first selected role', () => {
    expect(toAssignedRolePrimary(['leader', 'staff'])).toBe('leader');
    expect(toAssignedRolePrimary([])).toBe('staff');
    const payload = itemPayload(baseDraft({ assignedRoles: ['hybrid', 'leader'] }), 2);
    expect(payload.assignedRole).toBe('hybrid');
    expect(payload.assignedRolesJson).toBe('["hybrid","leader"]');
    expect(payload.sortOrder).toBe(2);
  });
});

describe('templateItemToDraft', () => {
  it('maps DB item assignedRolesJson + legacy assignedRole into assignedRoles', () => {
    const withJson = templateItemToDraft(
      baseItem({ assignedRolesJson: '["staff","leader"]', assignedRole: 'staff' }),
    );
    expect(withJson.assignedRoles).toEqual(['staff', 'leader']);

    const legacyOnly = templateItemToDraft(baseItem({ assignedRole: 'manager' }));
    expect(legacyOnly.assignedRoles).toEqual(['manager']);
  });
});
