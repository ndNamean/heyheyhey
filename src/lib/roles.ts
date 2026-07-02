import type { Role } from '../types';

export const ROLES: Role[] = [
  'owner',
  'areaManager',
  'manager',
  'leader',
  'subleader',
  'staff',
  'viewer',
];

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

export function isOwner(role: Role): boolean {
  return role === 'owner';
}

export function isAreaManager(role: Role): boolean {
  return role === 'areaManager';
}

export function canEditMaster(role: Role): boolean {
  return role === 'owner' || role === 'areaManager';
}

export function canReview(role: Role): boolean {
  return ['owner', 'areaManager', 'manager', 'leader', 'subleader'].includes(role);
}

export function canManageUsers(role: Role): boolean {
  return role === 'owner' || role === 'areaManager';
}

export function canApproveItem(submittedByRole: Role, approverRole: Role, approverRoles: Role[]): boolean {
  if (approverRole === 'owner') return true;
  if (approverRoles.includes(approverRole)) return true;
  if (submittedByRole === 'staff') {
    return ['leader', 'subleader', 'manager'].includes(approverRole);
  }
  if (submittedByRole === 'leader' || submittedByRole === 'subleader') {
    return ['manager', 'areaManager'].includes(approverRole);
  }
  if (submittedByRole === 'manager') {
    return approverRole === 'areaManager';
  }
  return false;
}

/** Lowest role index among typical first-line approvers for a submitter role. */
export function typicalApproverMinIndex(submitterRole: Role): number {
  switch (submitterRole) {
    case 'staff':
      return ROLES.indexOf('manager');
    case 'subleader':
    case 'leader':
      return ROLES.indexOf('areaManager');
    case 'manager':
      return ROLES.indexOf('areaManager');
    default:
      return ROLES.indexOf('owner');
  }
}

/** True when the reviewer is above the usual first-line approver for this submitter. */
export function isHigherPositionReview(approverRole: Role, submitterRole: Role): boolean {
  const approverIdx = ROLES.indexOf(approverRole);
  if (approverIdx < 0) return false;
  return approverIdx < typicalApproverMinIndex(submitterRole);
}

/** Reviewer roles above the submitter in the org chart. */
export function supervisorRolesToNotify(submitterRole: Role): Role[] {
  const submitterIdx = ROLES.indexOf(submitterRole);
  return ROLES.filter((r) => {
    const idx = ROLES.indexOf(r);
    return idx >= 0 && idx < submitterIdx && canReview(r);
  });
}

export function userCanAccessStore(userRole: Role, userStoreIds: string[], storeId: string): boolean {
  if (userRole === 'owner') return true;
  return userStoreIds.includes(storeId);
}

export function needsMedia(proofType: string): boolean {
  return proofType.includes('photo') || proofType.includes('video');
}

export function needsNote(proofType: string): boolean {
  return proofType.includes('note');
}

export function needsNumber(proofType: string): boolean {
  return proofType.includes('number');
}
