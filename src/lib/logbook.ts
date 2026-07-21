/**
 * Logbook note / announcement / issue helpers.
 * Visibility and action gates are client-side; InstantDB view stays isApproved.
 */

import { rankOf } from './roleResolver';
import {
  canAccessAllStores,
  canEditMaster,
  canReview,
  canUseOpsTools,
  userCanAccessStore,
} from './roles';
import type {
  LogbookEntry,
  LogbookEntryType,
  LogbookIssueStatus,
  Profile,
  Role,
  RoleDefinition,
} from '../types';

export const LOGBOOK_ASSIGNEE_ROLES: Role[] = ['staff', 'subleader', 'leader', 'manager'];

export const LOGBOOK_ISSUE_STATUSES: LogbookIssueStatus[] = [
  'open',
  'in_progress',
  'waiting_approval',
  'resolved',
];

export const LOGBOOK_HIGHLIGHT_KEY = 'logbookHighlightEntryId';
export const LOGBOOK_FILTER_KEY = 'logbookInitialFilter';

const DUE_SOON_MS = 2 * 60 * 60 * 1000;

function profileStoreIds(profile: Profile): string[] {
  return (profile.stores ?? []).map((s) => s.id);
}

export function resolveLogbookEntryType(entry: Pick<LogbookEntry, 'entryType' | 'isAnnouncement'>): LogbookEntryType {
  const raw = (entry.entryType ?? '').trim();
  if (raw === 'note' || raw === 'announcement' || raw === 'issue') return raw;
  if (entry.isAnnouncement) return 'announcement';
  return 'note';
}

export function isLogbookIssue(entry: Pick<LogbookEntry, 'entryType' | 'isAnnouncement'>): boolean {
  return resolveLogbookEntryType(entry) === 'issue';
}

export function resolveLogbookIssueStatus(
  entry: Pick<LogbookEntry, 'entryType' | 'isAnnouncement' | 'status'>,
): LogbookIssueStatus | '' {
  if (!isLogbookIssue(entry)) return '';
  const raw = (entry.status ?? '').trim();
  if (
    raw === 'open' ||
    raw === 'in_progress' ||
    raw === 'waiting_approval' ||
    raw === 'resolved'
  ) {
    return raw;
  }
  return 'open';
}

export function isIssueOverdue(
  entry: Pick<LogbookEntry, 'entryType' | 'isAnnouncement' | 'status' | 'dueAt'>,
  now: number = Date.now(),
): boolean {
  if (!isLogbookIssue(entry)) return false;
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'resolved') return false;
  const dueAt = (entry.dueAt ?? '').trim();
  if (!dueAt) return false;
  const dueMs = new Date(dueAt).getTime();
  if (Number.isNaN(dueMs)) return false;
  return dueMs < now;
}

export function isIssueDueSoon(
  entry: Pick<LogbookEntry, 'entryType' | 'isAnnouncement' | 'status' | 'dueAt'>,
  now: number = Date.now(),
  windowMs: number = DUE_SOON_MS,
): boolean {
  if (!isLogbookIssue(entry)) return false;
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'resolved') return false;
  if (isIssueOverdue(entry, now)) return false;
  const dueAt = (entry.dueAt ?? '').trim();
  if (!dueAt) return false;
  const dueMs = new Date(dueAt).getTime();
  if (Number.isNaN(dueMs)) return false;
  return dueMs - now <= windowMs && dueMs >= now;
}

export function canOpenLogbook(
  profile: Profile,
  defs: RoleDefinition[],
  assignedIssueExists: boolean,
): boolean {
  if (canUseOpsTools(profile.role, defs)) return true;
  return assignedIssueExists;
}

export function profileMatchesAssignee(
  profile: Profile,
  entry: Pick<LogbookEntry, 'storeId' | 'assigneeRole'>,
  defs?: RoleDefinition[],
): boolean {
  if (!entry.storeId || !entry.assigneeRole) return false;
  if (profile.role !== entry.assigneeRole) return false;
  return userCanAccessStore(profile.role, profileStoreIds(profile), entry.storeId, defs);
}

export function canViewLogbookEntry(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  const type = resolveLogbookEntryType(entry);
  const storeIds = profileStoreIds(profile);
  const allStores = canAccessAllStores(profile.role, defs);
  const ops = canUseOpsTools(profile.role, defs);

  if (type === 'issue') {
    if (ops || canReview(profile.role, defs) || canEditMaster(profile.role, defs)) {
      if (!entry.storeId) return false;
      return allStores || storeIds.includes(entry.storeId);
    }
    return profileMatchesAssignee(profile, entry, defs);
  }

  if (!ops) return false;

  if (!entry.storeId) {
    // Blank-store announcements/notes visible to ops-tools users
    return true;
  }
  return allStores || storeIds.includes(entry.storeId);
}

export function canActOnAssignedIssue(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (profile.approvalStatus !== 'approved') return false;
  return profileMatchesAssignee(profile, entry, defs);
}

export function canReviewLogbookIssue(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (profile.approvalStatus !== 'approved') return false;
  if (!canReview(profile.role, defs)) return false;
  if (!entry.storeId) return false;
  if (!userCanAccessStore(profile.role, profileStoreIds(profile), entry.storeId, defs)) {
    return false;
  }

  const assigneeRole = (entry.assigneeRole ?? '') as Role;
  if (!assigneeRole) return false;
  // Lower rank number = higher authority
  if (rankOf(profile.role, defs) >= rankOf(assigneeRole, defs)) return false;

  const submitter = (entry.resolutionSubmittedByUserId ?? '').trim();
  if (submitter && submitter === profile.userId) return false;

  return true;
}

export function canEditLogbookAssignment(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (canEditMaster(profile.role, defs)) return true;
  if (entry.authorUserId === profile.userId) return true;
  // Store manager+ with store access
  if (profile.role === 'manager' || profile.role === 'leader') {
    return userCanAccessStore(profile.role, profileStoreIds(profile), entry.storeId, defs);
  }
  return false;
}

export function defaultLogbookFilterTab(
  profile: Profile,
  defs: RoleDefinition[],
): 'all' | 'my-assigned' | 'open' | 'waiting_approval' | 'overdue' | 'resolved' {
  if (!canUseOpsTools(profile.role, defs) && !canReview(profile.role, defs)) {
    return 'my-assigned';
  }
  if (profile.role === 'staff') return 'my-assigned';
  if (
    profile.role === 'leader' ||
    profile.role === 'subleader' ||
    profile.role === 'manager'
  ) {
    return 'open';
  }
  return 'all';
}

export function emptyLogbookIssueFields() {
  return {
    entryType: '' as string,
    assigneeRole: '',
    dueAt: '',
    status: '',
    startedAt: '',
    startedByUserId: '',
    resolutionNote: '',
    resolutionSubmittedAt: '',
    resolutionSubmittedByUserId: '',
    resolvedAt: '',
    resolvedByUserId: '',
    reviewedAt: '',
    reviewedByUserId: '',
    reviewNote: '',
    reopenedAt: '',
    reopenedByUserId: '',
    reopenReason: '',
    dueSoonNotifiedAt: '',
    overdueNotifiedAt: '',
  };
}

export function issueCreateFields(assigneeRole: string, dueAt: string) {
  return {
    entryType: 'issue' as const,
    isAnnouncement: false,
    assigneeRole,
    dueAt,
    status: 'open' as const,
    startedAt: '',
    startedByUserId: '',
    resolutionNote: '',
    resolutionSubmittedAt: '',
    resolutionSubmittedByUserId: '',
    resolvedAt: '',
    resolvedByUserId: '',
    reviewedAt: '',
    reviewedByUserId: '',
    reviewNote: '',
    reopenedAt: '',
    reopenedByUserId: '',
    reopenReason: '',
    dueSoonNotifiedAt: '',
    overdueNotifiedAt: '',
  };
}

export function noteOrAnnouncementFields(entryType: 'note' | 'announcement') {
  return {
    ...emptyLogbookIssueFields(),
    entryType,
    isAnnouncement: entryType === 'announcement',
  };
}

export function isAssignedUnresolvedIssue(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (resolveLogbookIssueStatus(entry) === 'resolved') return false;
  return profileMatchesAssignee(profile, entry, defs);
}

export function countAssignedOpenOrOverdue(
  profile: Profile,
  entries: LogbookEntry[],
  defs: RoleDefinition[],
  now: number = Date.now(),
): number {
  return entries.filter((e) => {
    if (!isAssignedUnresolvedIssue(profile, e, defs)) return false;
    const status = resolveLogbookIssueStatus(e);
    return status === 'open' || status === 'in_progress' || isIssueOverdue(e, now);
  }).length;
}
