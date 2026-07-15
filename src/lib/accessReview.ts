import type { ApprovalStatus, Profile, Role } from '../types';

export const ACCESS_PENDING_STATUSES: ApprovalStatus[] = [
  'pending',
  'manager_review',
  'pre_approved',
  'needs_manager_recheck',
];

export function isAccessPending(status: ApprovalStatus): boolean {
  return ACCESS_PENDING_STATUSES.includes(status);
}

export function parseAccessReviewStoreIds(json: string | undefined): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function managerCanReviewAccess(
  manager: Profile,
  target: Profile,
): boolean {
  if (manager.role !== 'manager') return false;
  if (!['manager_review', 'needs_manager_recheck'].includes(target.approvalStatus)) return false;

  const designatedStoreIds = parseAccessReviewStoreIds(target.accessReviewStoreIdsJson);
  if (!designatedStoreIds.length) return false;

  const managerStoreIds = new Set((manager.stores ?? []).map((s) => s.id));
  return designatedStoreIds.some((id) => managerStoreIds.has(id));
}

export function managersForStores(profiles: Profile[], storeIds: string[]): Profile[] {
  const storeIdSet = new Set(storeIds);
  return profiles.filter(
    (p) =>
      p.role === 'manager' &&
      p.approvalStatus === 'approved' &&
      (p.stores ?? []).some((s) => storeIdSet.has(s.id)),
  );
}

export function adminsForAccessNotify(profiles: Profile[]): Profile[] {
  return profiles.filter(
    (p) =>
      (p.role === 'owner' || p.role === 'admin' || p.role === 'areaManager') &&
      p.approvalStatus === 'approved',
  );
}

export function accessStatusBadgeClass(status: ApprovalStatus): string {
  switch (status) {
    case 'manager_review':
    case 'needs_manager_recheck':
      return 'warn';
    case 'pre_approved':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'warn';
  }
}
