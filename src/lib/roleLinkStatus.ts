import type { RoleDefinition } from '../types';

export type RoleLinkStatus = 'ok' | 'missing_link' | 'wrong_key' | 'unknown_role';

export function getRoleLinkStatus(
  profile: { role: string; roleDefinition?: { id?: string; key?: string } | null },
  defs: RoleDefinition[],
): RoleLinkStatus {
  const expected = defs.find((d) => d.key === profile.role && d.active !== false);
  if (!expected) return 'unknown_role';
  if (!profile.roleDefinition?.id) return 'missing_link';
  if (profile.roleDefinition.key && profile.roleDefinition.key !== profile.role) {
    return 'wrong_key';
  }
  const linkedDef = defs.find((d) => d.id === profile.roleDefinition!.id);
  if (linkedDef && linkedDef.key !== profile.role) return 'wrong_key';
  if (profile.roleDefinition.id !== expected.id) return 'wrong_key';
  return 'ok';
}
