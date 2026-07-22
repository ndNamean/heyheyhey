import type { Role, RoleDefinition } from '../types';
import {
  capability,
  getRoleDef,
  orderedRoleKeys,
  canApproveItem as resolveCanApproveItem,
  isHigherPositionReview as resolveIsHigherPositionReview,
  supervisorRolesToNotify as resolveSupervisorRolesToNotify,
  usesDashboardHome,
  canViewRolesPermissions,
  defaultDefinitionsAsEntities,
} from './roleResolver';
import { LEGACY_ROLES } from './defaultRoleDefinitions';

export { LEGACY_ROLES as ROLES };

function defsOrDefault(defs?: RoleDefinition[]): RoleDefinition[] {
  return defs?.length ? defs : defaultDefinitionsAsEntities();
}

export function isOwner(role: Role): boolean {
  return role === 'owner';
}

export function isAreaManager(role: Role): boolean {
  return role === 'areaManager';
}

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}

/** Area-manager tier: areaManager or admin. */
export function isAreaManagerTier(role: Role): boolean {
  return role === 'areaManager' || role === 'admin';
}

export function canEditMaster(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canEditMaster');
}

export function canReview(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canReview');
}

export function canManageUsers(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canManageUsers');
}

export function canPreApproveAccess(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canPreApproveAccess');
}

export function canAccessUsersPage(role: Role, defs?: RoleDefinition[]): boolean {
  return canManageUsers(role, defs) || canPreApproveAccess(role, defs);
}

export function canAccessAllStores(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canAccessAllStores');
}

export function seesAllTemplateItems(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'seesAllTemplateItems');
}

export function canExportDashboard(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canExportDashboard');
}

export function canExportReviewStatus(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canExportReviewStatus');
}

export function canScheduleShifts(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canScheduleShifts');
}

export function canDeleteShifts(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canDeleteShifts');
}

export function canUseOpsTools(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canUseOpsTools');
}

export function canClockIn(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canClockIn');
}

export function canProposeTemplateItem(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canProposeTemplateItem');
}

export function canFirstApproveTemplateItemProposal(
  role: Role,
  defs?: RoleDefinition[],
): boolean {
  return capability(role, defsOrDefault(defs), 'canFirstApproveTemplateItemProposal');
}

export function canFinalApproveTemplateItemProposal(
  role: Role,
  defs?: RoleDefinition[],
): boolean {
  return capability(role, defsOrDefault(defs), 'canFinalApproveTemplateItemProposal');
}

export function canPublishTemplateItemProposal(role: Role, defs?: RoleDefinition[]): boolean {
  return capability(role, defsOrDefault(defs), 'canPublishTemplateItemProposal');
}

export function canAccessChecklistItemProposals(role: Role, defs?: RoleDefinition[]): boolean {
  return (
    canProposeTemplateItem(role, defs) ||
    canFirstApproveTemplateItemProposal(role, defs) ||
    canFinalApproveTemplateItemProposal(role, defs) ||
    canPublishTemplateItemProposal(role, defs)
  );
}

export function canEditStoreLogo(role: Role, defs?: RoleDefinition[]): boolean {
  return canEditMaster(role, defs);
}

export function getOrderedRoles(defs?: RoleDefinition[]): Role[] {
  return orderedRoleKeys(defsOrDefault(defs));
}

export function canApproveItem(
  submittedByRole: Role,
  approverRole: Role,
  approverRoles: Role[],
  defs?: RoleDefinition[],
): boolean {
  return resolveCanApproveItem(submittedByRole, approverRole, approverRoles, defsOrDefault(defs));
}

export function isHigherPositionReview(
  approverRole: Role,
  submitterRole: Role,
  defs?: RoleDefinition[],
): boolean {
  return resolveIsHigherPositionReview(approverRole, submitterRole, defsOrDefault(defs));
}

export function supervisorRolesToNotify(submitterRole: Role, defs?: RoleDefinition[]): Role[] {
  return resolveSupervisorRolesToNotify(submitterRole, defsOrDefault(defs));
}

export function userCanAccessStore(
  userRole: Role,
  userStoreIds: string[],
  storeId: string,
  defs?: RoleDefinition[],
): boolean {
  if (canAccessAllStores(userRole, defs)) return true;
  return userStoreIds.includes(storeId);
}

export { usesDashboardHome, canViewRolesPermissions, getRoleDef };

export const PROOF_TYPES = [
  'tick',
  'photo',
  'video',
  'number',
  'note',
  'photo_note',
  'photo_number',
  'video_note',
] as const;

export const FAILURE_CATEGORIES = ['Hygiene', 'Safety', 'Operations'] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const FAILURE_CATEGORY_SET = new Set<string>(FAILURE_CATEGORIES);

export function normalizeFailureCategory(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'Hygiene';
  const match = FAILURE_CATEGORIES.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  return match ?? trimmed;
}

export function failureCategoryOptions(current: string): string[] {
  const normalized = normalizeFailureCategory(current);
  if (FAILURE_CATEGORY_SET.has(normalized)) return [...FAILURE_CATEGORIES];
  return [...FAILURE_CATEGORIES, normalized];
}

export function needsTick(proofType: string): boolean {
  return proofType === 'tick';
}

export function needsMedia(proofType: string): boolean {
  return proofType.includes('photo') || proofType.includes('video');
}

export function needsVideoProof(proofType: string): boolean {
  return proofType === 'video' || proofType === 'video_note';
}

export function needsNote(proofType: string): boolean {
  return proofType.includes('note');
}

export function needsNumber(proofType: string): boolean {
  return proofType.includes('number');
}
