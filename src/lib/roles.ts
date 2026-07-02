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
