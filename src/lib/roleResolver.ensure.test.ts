import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoleDefinitions';
import {
  CURRENT_ROLE_DEFINITION_VERSION,
  buildEnsureSystemRoleOps,
  buildResetApprovalMatrixPatches,
  seedToDefinition,
} from './roleResolver';
import type { RoleDefinition } from '../types';

/**
 * Manual Owner UI acceptance (Instant):
 * - Toggle Admin approval-matrix cell → refresh → value remains.
 * - Reset → cancel → unchanged; confirm → defaults; refresh → defaults remain.
 * - Non-owner still read-only (no reset / no edits).
 */

const NOW = '2026-01-01T00:00:00.000Z';

function defFromSeed(
  seedKey: string,
  overrides: Partial<RoleDefinition> = {},
): RoleDefinition {
  const seed = DEFAULT_ROLE_DEFINITIONS.find((d) => d.key === seedKey)!;
  return {
    ...seedToDefinition(seed, `id-${seedKey}`),
    ...overrides,
    key: seedKey,
  };
}

function allSystemDefs(
  overridesByKey: Partial<Record<string, Partial<RoleDefinition>>> = {},
): RoleDefinition[] {
  return DEFAULT_ROLE_DEFINITIONS.map((seed) =>
    defFromSeed(seed.key, overridesByKey[seed.key]),
  );
}

describe('buildEnsureSystemRoleOps', () => {
  it('does not overwrite customized Admin approval matrix or capabilities', () => {
    const defs = allSystemDefs({
      admin: {
        approvesSubmitterRolesJson: '["staff"]',
        canEditMaster: false,
        canReview: false,
        label: 'Custom Admin',
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
    });

    const ops = buildEnsureSystemRoleOps(defs, NOW);
    const adminOp = ops.find((op) => op.op === 'update' && op.id === 'id-admin');
    expect(adminOp).toBeUndefined();
    expect(ops.every((op) => op.op !== 'create' || op.seedKey !== 'admin')).toBe(true);
  });

  it('does not overwrite Manager / Leader / Subleader approval customisations', () => {
    const defs = allSystemDefs({
      manager: {
        approvesSubmitterRolesJson: '["leader"]',
        canProposeTemplateItem: false,
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
      leader: {
        approvesSubmitterRolesJson: '[]',
        canRequestUserChanges: false,
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
      subleader: {
        approvesSubmitterRolesJson: '["manager"]',
        canFirstApproveTemplateItemProposal: true,
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
    });

    const ops = buildEnsureSystemRoleOps(defs, NOW);
    const touched = new Set(
      ops.filter((op) => op.op === 'update').map((op) => op.id),
    );
    expect(touched.has('id-manager')).toBe(false);
    expect(touched.has('id-leader')).toBe(false);
    expect(touched.has('id-subleader')).toBe(false);
  });

  it('emits a full create when a system role is missing', () => {
    const defs = allSystemDefs().filter((d) => d.key !== 'viewer');
    const ops = buildEnsureSystemRoleOps(defs, NOW);
    const create = ops.find((op) => op.op === 'create' && op.seedKey === 'viewer');
    expect(create).toBeDefined();
    if (create?.op !== 'create') throw new Error('expected create');
    expect(create.fields.key).toBe('viewer');
    expect(create.fields.roleDefinitionVersion).toBe(CURRENT_ROLE_DEFINITION_VERSION);
    expect(create.fields.approvesSubmitterRolesJson).toBe('[]');
    expect(create.fields.createdAt).toBe(NOW);
    expect(create.fields.updatedAt).toBe(NOW);
  });

  it('fills undefined optional capabilities once without syncing present diffs', () => {
    const defs = allSystemDefs({
      leader: {
        canProposeTemplateItem: undefined,
        canRequestUserChanges: true, // customized vs seed (true is same as seed for leader)
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
      manager: {
        // Present but different from seed — must not be force-synced.
        canProposeTemplateItem: false,
        canFirstApproveTemplateItemProposal: false,
        canFinalApproveTemplateItemProposal: true,
        canPublishTemplateItemProposal: true,
        canRequestUserChanges: false,
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
    });

    // Force undefined after spread (Partial may still leave seed values).
    const leader = defs.find((d) => d.key === 'leader')!;
    delete (leader as { canProposeTemplateItem?: boolean }).canProposeTemplateItem;

    const ops = buildEnsureSystemRoleOps(defs, NOW);

    const leaderUpdate = ops.find((op) => op.op === 'update' && op.id === 'id-leader');
    expect(leaderUpdate?.op).toBe('update');
    if (leaderUpdate?.op !== 'update') throw new Error('expected update');
    expect(leaderUpdate.patch).toEqual({
      canProposeTemplateItem: true,
      updatedAt: NOW,
    });

    const managerUpdate = ops.find((op) => op.op === 'update' && op.id === 'id-manager');
    expect(managerUpdate).toBeUndefined();
  });

  it('sets missing roleDefinitionVersion only; does not rewrite editable fields', () => {
    const defs = allSystemDefs({
      admin: {
        roleDefinitionVersion: undefined,
        approvesSubmitterRolesJson: '["hybrid"]',
        canManageUsers: false,
        label: 'Ops Admin',
      },
    });
    delete (defs.find((d) => d.key === 'admin') as { roleDefinitionVersion?: number })
      .roleDefinitionVersion;

    const ops = buildEnsureSystemRoleOps(defs, NOW);
    const adminUpdate = ops.find((op) => op.op === 'update' && op.id === 'id-admin');
    expect(adminUpdate?.op).toBe('update');
    if (adminUpdate?.op !== 'update') throw new Error('expected update');
    expect(adminUpdate.patch).toEqual({
      roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      updatedAt: NOW,
    });
    expect(adminUpdate.patch).not.toHaveProperty('approvesSubmitterRolesJson');
    expect(adminUpdate.patch).not.toHaveProperty('canManageUsers');
    expect(adminUpdate.patch).not.toHaveProperty('label');
  });

  it('repairs rank and isSystem without touching approval matrix', () => {
    const defs = allSystemDefs({
      staff: {
        rank: 99,
        isSystem: false,
        approvesSubmitterRolesJson: '["hybrid"]',
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
    });

    const ops = buildEnsureSystemRoleOps(defs, NOW);
    const staffUpdate = ops.find((op) => op.op === 'update' && op.id === 'id-staff');
    expect(staffUpdate?.op).toBe('update');
    if (staffUpdate?.op !== 'update') throw new Error('expected update');
    expect(staffUpdate.patch).toEqual({
      rank: 7,
      isSystem: true,
      updatedAt: NOW,
    });
  });
});

describe('buildResetApprovalMatrixPatches', () => {
  it('patches only approvesSubmitterRolesJson (+ updatedAt) from defaults', () => {
    const defs = allSystemDefs({
      admin: {
        approvesSubmitterRolesJson: '["staff"]',
        label: 'Custom Admin',
        canEditMaster: false,
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
      manager: {
        approvesSubmitterRolesJson: '[]',
        canProposeTemplateItem: false,
        roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      },
    });

    const patches = buildResetApprovalMatrixPatches(defs, NOW);
    expect(patches).toEqual([
      {
        id: 'id-admin',
        patch: {
          approvesSubmitterRolesJson: '["leader","subleader","manager"]',
          updatedAt: NOW,
        },
      },
      {
        id: 'id-manager',
        patch: {
          approvesSubmitterRolesJson: '["staff","hybrid"]',
          updatedAt: NOW,
        },
      },
    ]);

    for (const p of patches) {
      expect(Object.keys(p.patch).sort()).toEqual(['approvesSubmitterRolesJson', 'updatedAt']);
    }
  });

  it('is a no-op when already default', () => {
    const defs = allSystemDefs();
    expect(buildResetApprovalMatrixPatches(defs, NOW)).toEqual([]);
  });

  it('leaves custom (non-default) roles unchanged', () => {
    const defs = [
      ...allSystemDefs(),
      {
        ...defFromSeed('staff', {
          id: 'id-custom',
          key: 'supervisor',
          label: 'Supervisor',
          isSystem: false,
          approvesSubmitterRolesJson: '["staff"]',
        }),
      },
    ];
    const patches = buildResetApprovalMatrixPatches(defs, NOW);
    expect(patches.find((p) => p.id === 'id-custom')).toBeUndefined();
  });
});
