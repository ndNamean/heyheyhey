import { useEffect, useMemo, useRef } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoleDefinitions';
import { nowIso } from './utils';
import type { Role, RoleDefinition, RoleDefinitionSeed } from '../types';

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
    role === 'areaManager'
  );
}

export function buildSeedTransactions() {
  const now = nowIso();
  return DEFAULT_ROLE_DEFINITIONS.map((seed) => {
    const defId = id();
    return db.tx.roleDefinitions[defId].update({
      ...seed,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export function linkProfilesToRoleDefinitions(
  profiles: { id: string; role: string; roleDefinition?: { id: string; key?: string } | null }[],
  defs: RoleDefinition[],
) {
  const txs: ReturnType<typeof db.tx.profiles[string]['link']>[] = [];

  for (const p of profiles) {
    const def = defs.find((d) => d.key === p.role && d.active !== false);
    if (!def || def.id.startsWith('default-') || def.id.startsWith('fallback-')) continue;

    const linkedId = p.roleDefinition?.id;
    if (linkedId && linkedId !== def.id) {
      txs.push(db.tx.profiles[p.id].unlink({ roleDefinition: linkedId }));
    }
    if (!linkedId || linkedId !== def.id) {
      txs.push(db.tx.profiles[p.id].link({ roleDefinition: def.id }));
    }
  }

  return txs;
}

export { getRoleLinkStatus, type RoleLinkStatus } from './roleLinkStatus';

export function profileRoleAssignTx(
  profileId: string,
  role: Role,
  defs: RoleDefinition[],
  linkedDefId?: string | null,
) {
  const def = defs.find((d) => d.key === role && d.active !== false);
  const txs = [db.tx.profiles[profileId].update({ role, updatedAt: nowIso() })];

  if (linkedDefId) {
    txs.push(db.tx.profiles[profileId].unlink({ roleDefinition: linkedDefId }));
  }

  if (def && !def.id.startsWith('default-') && !def.id.startsWith('fallback-')) {
    txs.push(db.tx.profiles[profileId].link({ roleDefinition: def.id }));
  }

  return txs;
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

  useEffect(() => {
    if (!isOwner || !isEmpty || seedingRef.current) return;
    seedingRef.current = true;

    db.transact(buildSeedTransactions())
      .catch(() => {
        seedingRef.current = false;
      });
  }, [isOwner, isEmpty]);
}

export function typicalApproverRank(submitterRole: Role, defs: RoleDefinition[]): number {
  switch (submitterRole) {
    case 'staff':
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
  approverRoles: Role[],
  defs: RoleDefinition[],
): boolean {
  if (approverRole === 'owner') return true;
  if (approverRoles.includes(approverRole)) return true;

  const approverDef = getRoleDef(approverRole, defs);
  if (!approverDef?.canReview) return false;

  const allowed = parseApprovesSubmitterRoles(approverDef.approvesSubmitterRolesJson);
  return allowed.includes(submittedByRole);
}
