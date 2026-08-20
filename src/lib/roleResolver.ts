import { useEffect, useMemo, useRef } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoleDefinitions';
import { nowIso } from './utils';
import type { Role, RoleDefinition, RoleDefinitionSeed } from '../types';

/** Bump only when a future ensure migration must patch existing records. */
export const CURRENT_ROLE_DEFINITION_VERSION = 1;

/** Optional Owner-editable capabilities filled once when missing; never force-synced. */
const OPTIONAL_CAPABILITY_KEYS = [
  'canProposeTemplateItem',
  'canFirstApproveTemplateItemProposal',
  'canFinalApproveTemplateItemProposal',
  'canPublishTemplateItemProposal',
  'canRequestUserChanges',
  'canCreateGroupChat',
  'canCreateCrossStoreGroupChat',
  'canSendGroupChat',
] as const satisfies ReadonlyArray<keyof RoleDefinitionSeed>;

export function parseApprovesSubmitterRoles(json: string | undefined): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function seedToDefinition(seed: RoleDefinitionSeed, defId: string): RoleDefinition {
  const now = nowIso();
  return {
    id: defId,
    ...seed,
    roleDefinitionVersion: seed.roleDefinitionVersion ?? CURRENT_ROLE_DEFINITION_VERSION,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultDefinitionsAsEntities(): RoleDefinition[] {
  return DEFAULT_ROLE_DEFINITIONS.map((seed) => seedToDefinition(seed, `default-${seed.key}`));
}

export function getRoleDef(role: Role, defs: RoleDefinition[]): RoleDefinition | undefined {
  const fromDb = defs.find((d) => d.key === role && d.active);
  if (fromDb) return fromDb;
  const fallback = DEFAULT_ROLE_DEFINITIONS.find((d) => d.key === role);
  if (!fallback) return undefined;
  return seedToDefinition(fallback, `fallback-${fallback.key}`);
}

export function orderedRoles(defs: RoleDefinition[]): RoleDefinition[] {
  const source = defs.length ? defs.filter((d) => d.active) : defaultDefinitionsAsEntities();
  return [...source].sort((a, b) => a.rank - b.rank);
}

export function orderedRoleKeys(defs: RoleDefinition[]): Role[] {
  return orderedRoles(defs).map((d) => d.key);
}

export function rankOf(role: Role, defs: RoleDefinition[]): number {
  return getRoleDef(role, defs)?.rank ?? 999;
}

export function capability(
  role: Role,
  defs: RoleDefinition[],
  flag: keyof Pick<
    RoleDefinition,
    | 'canEditMaster'
    | 'canManageUsers'
    | 'canReview'
    | 'canPreApproveAccess'
    | 'canAccessAllStores'
    | 'seesAllTemplateItems'
    | 'canExportDashboard'
    | 'canExportReviewStatus'
    | 'canScheduleShifts'
    | 'canDeleteShifts'
    | 'canUseOpsTools'
    | 'canClockIn'
    | 'canProposeTemplateItem'
    | 'canFirstApproveTemplateItemProposal'
    | 'canFinalApproveTemplateItemProposal'
    | 'canPublishTemplateItemProposal'
    | 'canRequestUserChanges'
    | 'canCreateGroupChat'
    | 'canCreateCrossStoreGroupChat'
    | 'canSendGroupChat'
  >,
): boolean {
  return getRoleDef(role, defs)?.[flag] ?? false;
}

export function usesDashboardHome(role: Role, defs: RoleDefinition[]): boolean {
  return capability(role, defs, 'canExportDashboard');
}

export function canViewRolesPermissions(role: Role, defs: RoleDefinition[]): boolean {
  return (
    capability(role, defs, 'canManageUsers') ||
    role === 'areaManager' ||
    role === 'admin'
  );
}

export function buildSeedTransactions() {
  const now = nowIso();
  return DEFAULT_ROLE_DEFINITIONS.map((seed) => {
    const defId = id();
    return db.tx.roleDefinitions[defId].update({
      ...seed,
      roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export type EnsureSystemRoleOp =
  | {
      op: 'create';
      seedKey: string;
      fields: RoleDefinitionSeed & {
        roleDefinitionVersion: number;
        createdAt: string;
        updatedAt: string;
      };
    }
  | { op: 'update'; id: string; patch: Record<string, unknown> };

/**
 * Pure ensure planner: create missing system roles; repair system-managed fields only.
 * Never overwrites Owner-editable fields (label, can*, approvesSubmitterRolesJson).
 */
export function buildEnsureSystemRoleOps(
  defs: RoleDefinition[],
  now: string = nowIso(),
): EnsureSystemRoleOp[] {
  const ops: EnsureSystemRoleOp[] = [];

  for (const seed of DEFAULT_ROLE_DEFINITIONS) {
    const existing = defs.find((d) => d.key === seed.key);
    if (!existing) {
      ops.push({
        op: 'create',
        seedKey: seed.key,
        fields: {
          ...seed,
          roleDefinitionVersion: CURRENT_ROLE_DEFINITION_VERSION,
          createdAt: now,
          updatedAt: now,
        },
      });
      continue;
    }

    const patch: Record<string, unknown> = {};

    if (existing.rank !== seed.rank) patch.rank = seed.rank;
    if (!existing.isSystem) patch.isSystem = true;
    // Admin-only structural repair for inactive / mismatched active flag.
    if (seed.key === 'admin' && existing.active !== seed.active) {
      patch.active = seed.active;
    }
    if (existing.roleDefinitionVersion === undefined) {
      patch.roleDefinitionVersion = CURRENT_ROLE_DEFINITION_VERSION;
    }

    for (const key of OPTIONAL_CAPABILITY_KEYS) {
      if (existing[key] === undefined && seed[key] !== undefined) {
        patch[key] = seed[key];
      }
    }

    if (Object.keys(patch).length) {
      patch.updatedAt = now;
      ops.push({ op: 'update', id: existing.id, patch });
    }
  }

  return ops;
}

/** Create missing system roles; repair ranks / isSystem / missing optionals only. */
export function buildEnsureSystemRoleTransactions(defs: RoleDefinition[]) {
  return buildEnsureSystemRoleOps(defs).map((op) => {
    if (op.op === 'create') {
      return db.tx.roleDefinitions[id()].update(op.fields);
    }
    return db.tx.roleDefinitions[op.id].update(op.patch);
  });
}

export type ResetApprovalMatrixPatch = {
  id: string;
  patch: { approvesSubmitterRolesJson: string; updatedAt: string };
};

/** Pure reset planner: only `approvesSubmitterRolesJson` (+ updatedAt) for default system roles. */
export function buildResetApprovalMatrixPatches(
  defs: RoleDefinition[],
  now: string = nowIso(),
): ResetApprovalMatrixPatch[] {
  const patches: ResetApprovalMatrixPatch[] = [];

  for (const seed of DEFAULT_ROLE_DEFINITIONS) {
    const existing = defs.find((d) => d.key === seed.key);
    if (!existing) continue;
    if (existing.approvesSubmitterRolesJson === seed.approvesSubmitterRolesJson) continue;
    patches.push({
      id: existing.id,
      patch: {
        approvesSubmitterRolesJson: seed.approvesSubmitterRolesJson,
        updatedAt: now,
      },
    });
  }

  return patches;
}

export function buildResetApprovalMatrixTransactions(defs: RoleDefinition[]) {
  return buildResetApprovalMatrixPatches(defs).map(({ id: defId, patch }) =>
    db.tx.roleDefinitions[defId].update(patch),
  );
}

export async function resetApprovalMatrixToDefaults(defs: RoleDefinition[]) {
  const txs = buildResetApprovalMatrixTransactions(defs);
  if (!txs.length) return { updated: 0 };
  await db.transact(txs);
  return { updated: txs.length };
}

export function linkProfilesToRoleDefinitions(
  profiles: { id: string; role: string; roleDefinition?: { id: string; key?: string } | null }[],
  defs: RoleDefinition[],
) {
  const txs: ReturnType<typeof db.tx.profiles[string]['link']>[] = [];

  for (const p of profiles) {
    const def = defs.find((d) => d.key === p.role && d.active !== false);
    if (!isPersistedRoleDef(def)) continue;

    const linkedId = p.roleDefinition?.id;
    if (!linkedId || linkedId !== def.id) {
      txs.push(db.tx.profiles[p.id].link({ roleDefinition: def.id }));
    }
  }

  return txs;
}

/** Instant client transacts time out around 5s; each profile.roleDefinition link evaluates isAdmin auth.ref. */
export const PROFILE_ROLE_DEF_LINK_BATCH_SIZE = 8;

export async function transactProfileRoleDefinitionLinks(
  txs: ReturnType<typeof linkProfilesToRoleDefinitions>,
) {
  for (let i = 0; i < txs.length; i += PROFILE_ROLE_DEF_LINK_BATCH_SIZE) {
    await db.transact(txs.slice(i, i + PROFILE_ROLE_DEF_LINK_BATCH_SIZE));
  }
}

export { getRoleLinkStatus, type RoleLinkStatus } from './roleLinkStatus';

function isPersistedRoleDef(def: RoleDefinition | undefined): def is RoleDefinition {
  return (
    !!def &&
    !def.id.startsWith('default-') &&
    !def.id.startsWith('fallback-')
  );
}

export function profileRoleAssignTx(
  profileId: string,
  role: Role,
  defs: RoleDefinition[],
  _linkedDefId?: string | null,
) {
  const def = defs.find((d) => d.key === role && d.active !== false);
  if (!isPersistedRoleDef(def)) {
    throw new Error(
      'Role definitions are not ready. Open Roles & permissions, wait for roles to load, then try again.',
    );
  }

  return [
    db.tx.profiles[profileId].update({ role, updatedAt: nowIso() }),
    db.tx.profiles[profileId].link({ roleDefinition: def.id }),
  ];
}

export function useRoleDefinitionsQuery() {
  const { data, isLoading } = db.useQuery({ roleDefinitions: {} });
  const defs = useMemo(
    () => (data?.roleDefinitions ?? []) as RoleDefinition[],
    [data?.roleDefinitions],
  );
  return { defs, isLoading, isEmpty: !isLoading && defs.length === 0 };
}

export function useSeedRoleDefinitions(isOwner: boolean, defs: RoleDefinition[], isEmpty: boolean) {
  const seedingRef = useRef(false);
  const ensureRef = useRef(false);

  useEffect(() => {
    if (!isOwner || !isEmpty || seedingRef.current) return;
    seedingRef.current = true;

    db.transact(buildSeedTransactions())
      .catch(() => {
        seedingRef.current = false;
      });
  }, [isOwner, isEmpty]);

  useEffect(() => {
    if (!isOwner || isEmpty || !defs.length || ensureRef.current) return;
    const txs = buildEnsureSystemRoleTransactions(defs);
    if (!txs.length) {
      ensureRef.current = true;
      return;
    }
    ensureRef.current = true;
    db.transact(txs).catch(() => {
      ensureRef.current = false;
    });
  }, [isOwner, isEmpty, defs]);
}

export function typicalApproverRank(submitterRole: Role, defs: RoleDefinition[]): number {
  switch (submitterRole) {
    case 'staff':
    case 'hybrid':
      return rankOf('manager', defs);
    case 'leader':
    case 'subleader':
    case 'manager':
      return rankOf('areaManager', defs);
    default:
      return rankOf('owner', defs);
  }
}

export function isHigherPositionReview(
  approverRole: Role,
  submitterRole: Role,
  defs: RoleDefinition[],
): boolean {
  const approverRank = rankOf(approverRole, defs);
  if (approverRank >= 999) return false;
  return approverRank < typicalApproverRank(submitterRole, defs);
}

export function supervisorRolesToNotify(submitterRole: Role, defs: RoleDefinition[]): Role[] {
  const submitterRank = rankOf(submitterRole, defs);
  return orderedRoles(defs)
    .filter((d) => d.canReview && d.rank < submitterRank)
    .map((d) => d.key);
}

export function canApproveItem(
  submittedByRole: Role,
  approverRole: Role,
  _approverRoles: Role[],
  defs: RoleDefinition[],
): boolean {
  if (approverRole === 'owner') return true;

  const approverDef = getRoleDef(approverRole, defs);
  if (!approverDef?.canReview) return false;

  if (rankOf(approverRole, defs) >= rankOf(submittedByRole, defs)) return false;

  const allowed = parseApprovesSubmitterRoles(approverDef.approvesSubmitterRolesJson);
  return allowed.includes(submittedByRole);
}
