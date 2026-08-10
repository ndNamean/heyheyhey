/**
 * Overdue → Store Chat remind: capability + UI state helpers.
 * Store Chat send itself is Admin-only (`remind_overdue_chat`).
 */

import { rankOf } from './roleResolver';
import { canReview, userCanAccessStore } from './roles';
import { profileMentionLabel } from './logbookNotificationContent';
import {
  isIssueOverdue,
  isLogbookIssue,
  parseAssigneeUserIds,
  profileMatchesAssignee,
  profileStoreIds,
  resolveLogbookIssueStatus,
} from './logbook';
import type { LogbookEntry, Profile, Role, RoleDefinition } from '../types';

export type OverdueChatRemindState =
  | 'unassigned'
  | 'not_reminded'
  | 'reminded'
  | 'not_eligible_status';

function hasStoreAccess(profile: Profile, storeId: string, defs: RoleDefinition[]): boolean {
  if (!storeId) return false;
  return userCanAccessStore(profile.role, profileStoreIds(profile), storeId, defs);
}

/** Approved upper-rank actors (store manager or canReview above assignee) who may confirm remind. */
export function canRemindOverdueToStoreChat(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
  now: number = Date.now(),
): boolean {
  if (profile.approvalStatus !== 'approved') return false;
  if (!isLogbookIssue(entry)) return false;
  if (!isIssueOverdue(entry, now)) return false;
  if (!entry.storeId || !hasStoreAccess(profile, entry.storeId, defs)) return false;

  // Assignees receive the remind; they do not send it.
  if (profileMatchesAssignee(profile, entry, defs)) return false;

  if (profile.role === 'manager') return true;

  if (!canReview(profile.role, defs)) return false;
  const assigneeRole = (entry.assigneeRole ?? '').trim() as Role | '';
  if (!assigneeRole) return true;
  return rankOf(profile.role, defs) < rankOf(assigneeRole, defs);
}

/** Assignee @mention labels for panel + chat preview (role-wide or specific people). */
export function listLogbookAssigneeMentionLabels(
  entry: Pick<LogbookEntry, 'storeId' | 'assigneeRole' | 'assigneeUserIdsJson'>,
  profiles: Profile[],
  defs?: RoleDefinition[],
): string[] {
  const role = (entry.assigneeRole ?? '').trim();
  if (!entry.storeId || !role) return [];
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  const matches = profiles.filter((p) => {
    if (p.approvalStatus !== 'approved') return false;
    if (p.role !== role) return false;
    if (!userCanAccessStore(p.role, profileStoreIds(p), entry.storeId, defs)) return false;
    if (assigneeIds.length > 0 && !assigneeIds.includes(p.userId)) return false;
    return true;
  });
  matches.sort((a, b) =>
    (a.displayName || a.email || a.userId).localeCompare(
      b.displayName || b.email || b.userId,
      undefined,
      { sensitivity: 'base' },
    ),
  );
  return matches.map((p) => profileMentionLabel(p));
}

export function listLogbookAssigneeRecipientUserIds(
  entry: Pick<LogbookEntry, 'storeId' | 'assigneeRole' | 'assigneeUserIdsJson'>,
  profiles: Profile[],
  defs?: RoleDefinition[],
): string[] {
  const role = (entry.assigneeRole ?? '').trim();
  if (!entry.storeId || !role) return [];
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  const recipients: string[] = [];
  for (const p of profiles) {
    if (p.approvalStatus !== 'approved') continue;
    if (p.role !== role) continue;
    if (!userCanAccessStore(p.role, profileStoreIds(p), entry.storeId, defs)) continue;
    if (assigneeIds.length > 0 && !assigneeIds.includes(p.userId)) continue;
    recipients.push(p.userId);
  }
  return recipients;
}

export function overdueChatRemindState(
  entry: Pick<
    LogbookEntry,
    | 'entryType'
    | 'isAnnouncement'
    | 'status'
    | 'dueAt'
    | 'assigneeRole'
    | 'assigneeUserIdsJson'
    | 'overdueChatRemindedAt'
  >,
  assigneeRecipientCount: number,
  now: number = Date.now(),
): OverdueChatRemindState {
  if (!isLogbookIssue(entry)) return 'not_eligible_status';
  const status = resolveLogbookIssueStatus(entry);
  if (status === 'resolved' || status === 'recalled') return 'not_eligible_status';
  if (!isIssueOverdue(entry, now)) return 'not_eligible_status';

  const assigneeRole = (entry.assigneeRole ?? '').trim();
  if (!assigneeRole || assigneeRecipientCount <= 0) return 'unassigned';

  if ((entry.overdueChatRemindedAt ?? '').trim()) return 'reminded';
  return 'not_reminded';
}
