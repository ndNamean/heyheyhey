/**
 * Logbook note / announcement / issue helpers.
 * Visibility and action gates are client-side; InstantDB view stays isApproved.
 */

import { getRoleDef, rankOf } from './roleResolver';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoleDefinitions';
import {
  canAccessAllStores,
  canEditMaster,
  canReview,
  canUseOpsTools,
  isOwner,
  userCanAccessStore,
} from './roles';
import type {
  IssueConfigurationState,
  LogbookEntry,
  LogbookEntryType,
  LogbookFileRef,
  LogbookIssueStatus,
  Profile,
  Role,
  RoleDefinition,
} from '../types';

/** Candidate assignee roles ordered high → low authority (never owner/admin/viewer). */
export const LOGBOOK_ASSIGNEE_ROLES: Role[] = [
  'areaManager',
  'manager',
  'leader',
  'subleader',
  'hybrid',
  'staff',
];

/** Roles that may see notes / announcements (Owner → Staff; exclude viewer). */
export const LOGBOOK_NOTE_AUDIENCE_ROLES: Role[] = [
  'owner',
  'admin',
  'areaManager',
  'manager',
  'leader',
  'subleader',
  'hybrid',
  'staff',
];

/** Stable hierarchy ranks for assignee matrix (ignore corrupted live roleDefinitions.rank). */
function logbookMatrixRank(role: Role): number {
  const seed = DEFAULT_ROLE_DEFINITIONS.find((d) => d.key === role);
  return seed?.rank ?? 999;
}

/**
 * Assignee roles strictly below the creator's authority.
 * Owner/admin (highest ranks) receive the full candidate pool.
 * Staff/viewer (and any role with no lower candidates) receive [].
 * Uses default seed ranks so a bad Instant rank cannot expose higher assignees.
 */
export function eligibleLogbookAssigneeRoles(creatorRole: Role, defs: RoleDefinition[]): Role[] {
  const creatorRank = logbookMatrixRank(creatorRole);
  return LOGBOOK_ASSIGNEE_ROLES.filter((r) => {
    if (logbookMatrixRank(r) <= creatorRank) return false;
    const def = getRoleDef(r, defs);
    return !def || def.active !== false;
  });
}

export const LOGBOOK_ISSUE_STATUSES: LogbookIssueStatus[] = [
  'open',
  'in_progress',
  'waiting_approval',
  'resolved',
  'recalled',
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
    raw === 'resolved' ||
    raw === 'recalled'
  ) {
    return raw;
  }
  return 'open';
}

export function isIssueActiveQueueStatus(status: LogbookIssueStatus | ''): boolean {
  return status === 'open' || status === 'in_progress' || status === 'waiting_approval';
}

export function isIssueOverdue(
  entry: Pick<LogbookEntry, 'entryType' | 'isAnnouncement' | 'status' | 'dueAt'>,
  now: number = Date.now(),
): boolean {
  if (!isLogbookIssue(entry)) return false;
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'resolved' || status === 'recalled') return false;
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
  if (status === 'resolved' || status === 'recalled') return false;
  if (isIssueOverdue(entry, now)) return false;
  const dueAt = (entry.dueAt ?? '').trim();
  if (!dueAt) return false;
  const dueMs = new Date(dueAt).getTime();
  if (Number.isNaN(dueMs)) return false;
  return dueMs - now <= windowMs && dueMs >= now;
}

export function getIssueConfigurationState(
  entry: Pick<
    LogbookEntry,
    'entryType' | 'isAnnouncement' | 'assigneeRole' | 'dueAt' | 'resolutionProofType' | 'resolutionRequirement'
  >,
): IssueConfigurationState {
  if (!isLogbookIssue(entry)) return 'ready';
  if (!(entry.assigneeRole ?? '').trim()) return 'missing_assignment';
  if (!(entry.dueAt ?? '').trim()) return 'missing_deadline';
  const proof = (entry.resolutionProofType ?? '').trim();
  const req = (entry.resolutionRequirement ?? '').trim();
  // Proof type defaults to photo; only flag when both proof + requirement empty is not enough —
  // requirement text is optional guidance, but missing assignee/due block Staff actions.
  if (!proof && !req) return 'missing_resolution_requirement';
  return 'ready';
}

export function canOpenLogbook(
  profile: Profile,
  defs: RoleDefinition[],
  assignedIssueExists: boolean,
): boolean {
  if (canUseOpsTools(profile.role, defs)) return true;
  if (canReview(profile.role, defs)) return true;
  return assignedIssueExists;
}

/** Parse assigneeUserIdsJson; invalid / missing → empty (= role-wide). */
export function parseAssigneeUserIds(raw: string | undefined | null): string[] {
  if (raw == null || String(raw).trim() === '') return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
  } catch {
    return [];
  }
}

export function serializeAssigneeUserIds(userIds: string[]): string {
  const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  return JSON.stringify(unique);
}

export function profileMatchesAssignee(
  profile: Profile,
  entry: Pick<LogbookEntry, 'storeId' | 'assigneeRole' | 'assigneeUserIdsJson'>,
  defs?: RoleDefinition[],
): boolean {
  if (!entry.storeId || !entry.assigneeRole) return false;
  if (profile.role !== entry.assigneeRole) return false;
  if (!userCanAccessStore(profile.role, profileStoreIds(profile), entry.storeId, defs)) {
    return false;
  }
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  if (assigneeIds.length === 0) return true;
  return assigneeIds.includes(profile.userId);
}

/** Approved profiles with role + store access, sorted by displayName. */
export function eligibleAssigneeUsers(
  storeId: string,
  assigneeRole: string,
  allProfiles: Profile[],
  defs?: RoleDefinition[],
): Profile[] {
  if (!storeId || !assigneeRole) return [];
  return allProfiles
    .filter((p) => {
      if (p.approvalStatus !== 'approved') return false;
      if (p.role !== assigneeRole) return false;
      return userCanAccessStore(p.role, profileStoreIds(p), storeId, defs);
    })
    .sort((a, b) =>
      (a.displayName || a.email || a.userId).localeCompare(
        b.displayName || b.email || b.userId,
        undefined,
        { sensitivity: 'base' },
      ),
    );
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

  // Notes / announcements: Owner → Staff in store scope; never viewer
  if (profile.role === 'viewer') return false;
  if (profile.approvalStatus !== 'approved') return false;
  if (!LOGBOOK_NOTE_AUDIENCE_ROLES.includes(profile.role)) return false;

  if (!entry.storeId) {
    // Blank store = all stores in that audience
    return true;
  }
  return userCanAccessStore(profile.role, storeIds, entry.storeId, defs);
}

export function canActOnAssignedIssue(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (profile.approvalStatus !== 'approved') return false;
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'recalled' || status === 'resolved') return false;
  if (getIssueConfigurationState(entry) === 'missing_assignment') return false;
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

  // Block only when reviewer is the resolution submitter (not author identity)
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
  if (resolveLogbookIssueStatus(entry) === 'recalled') return false;
  if (canEditMaster(profile.role, defs)) return true;
  if (entry.authorUserId === profile.userId) return true;
  // Store manager+ with store access
  if (profile.role === 'manager' || profile.role === 'leader') {
    return userCanAccessStore(profile.role, profileStoreIds(profile), entry.storeId, defs);
  }
  return false;
}

export function canAddCreatorUpdate(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'recalled' || status === 'resolved') return false;
  return canEditLogbookAssignment(profile, entry, defs);
}

/** Untouched open issue: no start/submit/review/media beyond create. */
export function isPristineLogbookIssue(entry: LogbookEntry): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (resolveLogbookIssueStatus(entry) !== 'open') return false;
  if ((entry.startedAt ?? '').trim()) return false;
  if ((entry.startedByUserId ?? '').trim()) return false;
  if ((entry.resolutionSubmittedAt ?? '').trim()) return false;
  if ((entry.resolutionSubmittedByUserId ?? '').trim()) return false;
  if ((entry.reviewedAt ?? '').trim()) return false;
  if ((entry.reviewedByUserId ?? '').trim()) return false;
  if ((entry.resolvedAt ?? '').trim()) return false;
  if ((entry.reopenedAt ?? '').trim()) return false;
  if ((entry.ackUserIdsJson ?? '[]') !== '[]' && (entry.ackUserIdsJson ?? '').trim() !== '[]') {
    try {
      const ids = JSON.parse(entry.ackUserIdsJson || '[]') as unknown[];
      if (Array.isArray(ids) && ids.length > 0) return false;
    } catch {
      /* ignore */
    }
  }
  if (entry.photo?.id) return false;
  if (entry.resolutionMedia?.id) return false;
  if ((entry.sourceMedia ?? []).length > 0) return false;
  return true;
}

export function canRecallLogbookIssue(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (profile.approvalStatus !== 'approved') return false;
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'recalled' || status === 'resolved') return false;

  // Staff / hybrid: no recall
  if (profile.role === 'staff' || profile.role === 'hybrid') return false;

  const elevated =
    isOwner(profile.role) ||
    canEditMaster(profile.role, defs) ||
    profile.role === 'areaManager' ||
    profile.role === 'admin';

  if (elevated) {
    return status === 'open' || status === 'in_progress' || status === 'waiting_approval';
  }

  // Author: recall only untouched open
  if (entry.authorUserId === profile.userId) {
    return status === 'open' && isPristineLogbookIssue(entry);
  }

  return false;
}

export function canHardDeleteLogbookIssue(
  profile: Profile,
  entry: LogbookEntry,
  _defs?: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;
  if (!isOwner(profile.role)) return false;
  return isPristineLogbookIssue(entry);
}

export function canSubmitResolutionNow(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!canActOnAssignedIssue(profile, entry, defs)) return false;
  const status = resolveLogbookIssueStatus(entry);
  return status === 'open' || status === 'in_progress';
}

/** @deprecated Prefer defaultLogbookQuickView from logbookFilters.ts */
export function defaultLogbookFilterTab(
  profile: Profile,
  defs: RoleDefinition[],
): 'all' | 'my-assigned' | 'open' | 'waiting_approval' | 'overdue' | 'resolved' | 'correction' {
  // Kept for any external callers; mirrors progressive-filter defaults coarsely.
  if (profile.role === 'staff' || profile.role === 'hybrid') return 'my-assigned';
  if (!canUseOpsTools(profile.role, defs) && !canReview(profile.role, defs)) {
    return 'my-assigned';
  }
  return 'all';
}

export function emptyLogbookIssueFields() {
  return {
    entryType: '' as string,
    assigneeRole: '',
    assigneeUserIdsJson: '[]',
    dueAt: '',
    status: '',
    startedAt: '',
    startedByUserId: '',
    resolutionProofType: '',
    resolutionRequirement: '',
    resolutionChecked: false,
    resolutionNumber: '',
    resolutionNote: '',
    resolutionSubmittedAt: '',
    resolutionSubmittedByUserId: '',
    resolutionAttemptId: '',
    resolvedAt: '',
    resolvedByUserId: '',
    reviewedAt: '',
    reviewedByUserId: '',
    reviewNote: '',
    reopenedAt: '',
    reopenedByUserId: '',
    reopenReason: '',
    recalledAt: '',
    recalledByUserId: '',
    recallReason: '',
    dueSoonNotifiedAt: '',
    overdueNotifiedAt: '',
  };
}

export function issueCreateFields(
  assigneeRole: string,
  dueAt: string,
  resolutionProofType: string,
  resolutionRequirement: string,
  assigneeUserIds: string[] = [],
) {
  return {
    entryType: 'issue' as const,
    isAnnouncement: false,
    assigneeRole,
    assigneeUserIdsJson: serializeAssigneeUserIds(assigneeUserIds),
    dueAt,
    status: 'open' as const,
    startedAt: '',
    startedByUserId: '',
    resolutionProofType: resolutionProofType || 'photo',
    resolutionRequirement: resolutionRequirement.trim(),
    resolutionChecked: false,
    resolutionNumber: '',
    resolutionNote: '',
    resolutionSubmittedAt: '',
    resolutionSubmittedByUserId: '',
    resolutionAttemptId: '',
    resolvedAt: '',
    resolvedByUserId: '',
    reviewedAt: '',
    reviewedByUserId: '',
    reviewNote: '',
    reopenedAt: '',
    reopenedByUserId: '',
    reopenReason: '',
    recalledAt: '',
    recalledByUserId: '',
    recallReason: '',
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
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'resolved' || status === 'recalled') return false;
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

export type AssignedIssueCounters = {
  open: number;
  inProgress: number;
  waiting: number;
  overdue: number;
  correction: number;
};

export function countAssignedIssueBreakdown(
  profile: Profile,
  entries: LogbookEntry[],
  defs: RoleDefinition[],
  now: number = Date.now(),
): AssignedIssueCounters {
  const counters: AssignedIssueCounters = {
    open: 0,
    inProgress: 0,
    waiting: 0,
    overdue: 0,
    correction: 0,
  };
  for (const e of entries) {
    if (!isLogbookIssue(e)) continue;
    if (!profileMatchesAssignee(profile, e, defs)) continue;
    const status = resolveLogbookIssueStatus(e);
    if (status === 'resolved' || status === 'recalled') continue;
    if (status === 'open') counters.open += 1;
    if (status === 'in_progress') {
      counters.inProgress += 1;
      if ((e.reviewNote ?? '').trim()) counters.correction += 1;
    }
    if (status === 'waiting_approval') counters.waiting += 1;
    if (isIssueOverdue(e, now)) counters.overdue += 1;
  }
  return counters;
}

export function resolveSourceMedia(entry: LogbookEntry): LogbookFileRef[] {
  const linked = entry.sourceMedia ?? [];
  if (linked.length) return linked;
  // Legacy photo without resolution submit → treat as source/context
  if (entry.photo?.id && !(entry.resolutionSubmittedAt ?? '').trim()) {
    return [entry.photo];
  }
  return [];
}

export function resolveResolutionMedia(entry: LogbookEntry): LogbookFileRef | null {
  if (entry.resolutionMedia?.id) return entry.resolutionMedia;
  // Legacy photo after resolution submit → resolution proof
  if (entry.photo?.id && (entry.resolutionSubmittedAt ?? '').trim()) {
    return entry.photo;
  }
  return null;
}

/** Ordered proofs for UI: history + current if missing (dedupe by id). */
export function resolveResolutionProofs(entry: LogbookEntry): LogbookFileRef[] {
  const history = (entry.resolutionProofHistory ?? []).filter((f) => f?.id);
  const seen = new Set(history.map((f) => f.id));
  const current = resolveResolutionMedia(entry);
  if (current?.id && !seen.has(current.id)) {
    return [...history, current];
  }
  return history.length ? history : current?.id ? [current] : [];
}

export function logSubmitStepFailure(info: {
  entryId: string;
  actorRole: string;
  attemptedStep: string;
  message: string;
}) {
  console.error('[logbook-submit]', {
    entryId: info.entryId,
    actorRole: info.actorRole,
    attemptedStep: info.attemptedStep,
    message: info.message,
  });
}
