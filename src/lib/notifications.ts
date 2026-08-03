import { id } from '@instantdb/react';
import { db } from '../db';
import type {
  LogbookEntry,
  Notification,
  Profile,
  Report,
  ReportResponse,
  Role,
  RoleDefinition,
} from '../types';
import {
  canReview,
  isHigherPositionReview,
  supervisorRolesToNotify,
  userCanAccessStore,
} from './roles';
import { rankOf } from './roleResolver';
import {
  canViewLogbookEntry,
  parseAssigneeUserIds,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
} from './logbook';
import { nowIso } from './utils';
import {
  adminsForAccessNotify,
  managersForStores,
  parseAccessReviewStoreIds,
} from './accessReview';

export function complianceFromResponses(responses: ReportResponse[]): number {
  if (!responses.length) return 0;
  const approved = responses.filter((r) => r.status === 'approved').length;
  return Math.round((approved / responses.length) * 100);
}

export function getReviewNotificationRecipients(
  report: Report,
  response: ReportResponse,
  approver: Profile,
  allProfiles: Profile[],
): string[] {
  const recipients = new Set<string>();
  const submitterUserId = response.submittedByUserId || report.submittedByUserId;

  if (submitterUserId && submitterUserId !== approver.userId) {
    recipients.add(submitterUserId);
  }

  const submitterRole = (response.submittedByRole || report.submittedByRole) as Role;
  if (isHigherPositionReview(approver.role, submitterRole)) {
    const supervisorRoles = new Set(supervisorRolesToNotify(submitterRole));
    for (const p of allProfiles) {
      if (p.userId === approver.userId) continue;
      if (p.approvalStatus !== 'approved') continue;
      if (!supervisorRoles.has(p.role)) continue;
      if (!userCanAccessStore(p.role, (p.stores ?? []).map((s) => s.id), report.storeId)) continue;
      recipients.add(p.userId);
    }
  }

  return [...recipients];
}

function actionLabel(status: string): string {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'need_correction') return 'Needs correction';
  return status;
}

function buildItemReviewBody(
  report: Report,
  response: ReportResponse,
  status: string,
  reason: string,
  approver: Profile,
  compliancePercent: number,
): string {
  const lines = [
    `${actionLabel(status)} by ${approver.role} (${approver.displayName || approver.email}).`,
    `Item: ${response.title}`,
    `Report: ${report.storeCode} — ${report.templateName} · ${report.reportDate}`,
    `Completion: ${report.completionPercent ?? 0}% · Compliance: ${compliancePercent}%`,
  ];
  if (reason.trim()) lines.push(`Feedback: ${reason.trim()}`);
  return lines.join('\n');
}

export function buildItemReviewNotifications(
  report: Report,
  response: ReportResponse,
  status: 'approved' | 'rejected' | 'need_correction',
  reason: string,
  approver: Profile,
  allProfiles: Profile[],
  responses: ReportResponse[],
) {
  const now = nowIso();
  const compliancePercent = complianceFromResponses(
    responses.map((r) => (r.id === response.id ? { ...r, status } : r)),
  );
  const recipients = getReviewNotificationRecipients(report, response, approver, allProfiles);
  const notifType =
    status === 'approved' ? 'item_approved' : status === 'rejected' ? 'item_rejected' : 'item_correction';

  return recipients.map((recipientUserId) =>
    db.tx.notifications[id()].update({
      recipientUserId,
      type: notifType,
      reportId: report.id,
      reportResponseId: response.id,
      storeId: report.storeId,
      title: `${report.storeCode} — ${response.title}: ${actionLabel(status)}`,
      body: buildItemReviewBody(report, response, status, reason, approver, compliancePercent),
      itemTitle: response.title,
      completionPercent: report.completionPercent ?? 0,
      compliancePercent,
      actionStatus: status,
      actorUserId: approver.userId,
      actorRole: approver.role,
      readAt: '',
      createdAt: now,
    }),
  );
}

export function buildReportFinalizedNotifications(
  report: Report,
  reportStatus: string,
  compliancePercent: number,
  approver: Profile,
  allProfiles: Profile[],
  responses: ReportResponse[],
) {
  const now = nowIso();
  const recipients = new Set<string>();

  if (report.submittedByUserId && report.submittedByUserId !== approver.userId) {
    recipients.add(report.submittedByUserId);
  }

  const submitterRole = report.submittedByRole as Role;
  if (isHigherPositionReview(approver.role, submitterRole)) {
    const supervisorRoles = new Set(supervisorRolesToNotify(submitterRole));
    for (const p of allProfiles) {
      if (p.userId === approver.userId) continue;
      if (p.approvalStatus !== 'approved') continue;
      if (!supervisorRoles.has(p.role)) continue;
      if (!userCanAccessStore(p.role, (p.stores ?? []).map((s) => s.id), report.storeId)) continue;
      recipients.add(p.userId);
    }
  }

  const rejectedItems = responses.filter((r) => r.status === 'rejected' || r.status === 'need_correction');
  const feedbackSummary = rejectedItems.length
    ? rejectedItems
        .map((r) => `• ${r.title}: ${r.rejectionReason || r.status}`)
        .join('\n')
    : 'All items approved.';

  const body = [
    `Report finalised as ${reportStatus} by ${approver.role} (${approver.displayName || approver.email}).`,
    `${report.storeCode} — ${report.templateName} · ${report.reportDate}`,
    `Completion: ${report.completionPercent ?? 0}% · Compliance: ${compliancePercent}%`,
    '',
    feedbackSummary,
  ].join('\n');

  return [...recipients].map((recipientUserId) =>
    db.tx.notifications[id()].update({
      recipientUserId,
      type: 'report_finalized',
      reportId: report.id,
      reportResponseId: '',
      storeId: report.storeId,
      title: `${report.storeCode} — Report ${actionLabel(reportStatus)}`,
      body,
      itemTitle: '',
      completionPercent: report.completionPercent ?? 0,
      compliancePercent,
      actionStatus: reportStatus,
      actorUserId: approver.userId,
      actorRole: approver.role,
      readAt: '',
      createdAt: now,
    }),
  );
}

export function unreadNotifications(notifications: Notification[]): Notification[] {
  return notifications.filter((n) => !n.readAt);
}

type AccessNotifType =
  | 'access_manager_requested'
  | 'access_pre_approved'
  | 'access_flagged'
  | 'access_recheck'
  | 'access_approved'
  | 'access_rejected';

function emptyAccessNotifFields() {
  return {
    reportId: '',
    reportResponseId: '',
    storeId: '',
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: '',
  };
}

function buildAccessNotificationTx(
  recipientUserId: string,
  type: AccessNotifType,
  title: string,
  body: string,
  actor: Profile,
) {
  return db.tx.notifications[id()].update({
    recipientUserId,
    type,
    title,
    body,
    actorUserId: actor.userId,
    actorRole: actor.role,
    readAt: '',
    createdAt: nowIso(),
    ...emptyAccessNotifFields(),
  });
}

export function buildAccessManagerRequestedNotifications(
  target: Profile,
  storeIds: string[],
  note: string,
  actor: Profile,
  allProfiles: Profile[],
) {
  const managers = managersForStores(allProfiles, storeIds);
  const storeLabel = storeIds.length ? `${storeIds.length} store(s)` : 'stores';
  const body = [
    `Access review requested by ${actor.role} (${actor.displayName || actor.email}).`,
    `User: ${target.displayName || target.email} (${target.email})`,
    `Designated stores: ${storeLabel}`,
    note.trim() ? `Note: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return managers
    .filter((m) => m.userId !== actor.userId)
    .map((m) =>
      buildAccessNotificationTx(
        m.userId,
        'access_manager_requested',
        `Access review: ${target.email}`,
        body,
        actor,
      ),
    );
}

export function buildAccessRecheckNotifications(
  target: Profile,
  note: string,
  actor: Profile,
  allProfiles: Profile[],
) {
  const storeIds = parseAccessReviewStoreIds(target.accessReviewStoreIdsJson);
  const managers = managersForStores(allProfiles, storeIds);
  const body = [
    `Recheck requested by ${actor.role} (${actor.displayName || actor.email}).`,
    `User: ${target.displayName || target.email} (${target.email})`,
    note.trim() ? `Note: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return managers
    .filter((m) => m.userId !== actor.userId)
    .map((m) =>
      buildAccessNotificationTx(
        m.userId,
        'access_recheck',
        `Recheck access: ${target.email}`,
        body,
        actor,
      ),
    );
}

export function buildAccessAdminNotifications(
  target: Profile,
  type: 'access_pre_approved' | 'access_flagged',
  note: string,
  actor: Profile,
  allProfiles: Profile[],
) {
  const admins = adminsForAccessNotify(allProfiles);
  const action = type === 'access_pre_approved' ? 'Pre-approved' : 'Flagged for review';
  const body = [
    `${action} by ${actor.role} (${actor.displayName || actor.email}).`,
    `User: ${target.displayName || target.email} (${target.email})`,
    note.trim() ? `Note: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return admins
    .filter((a) => a.userId !== actor.userId)
    .map((a) =>
      buildAccessNotificationTx(
        a.userId,
        type,
        `${action}: ${target.email}`,
        body,
        actor,
      ),
    );
}

export function buildAccessFinalizedNotification(
  target: Profile,
  status: 'approved' | 'rejected',
  actor: Profile,
) {
  if (!target.userId || target.userId === actor.userId) return [];
  const body = [
    `Access ${status} by ${actor.role} (${actor.displayName || actor.email}).`,
    `Account: ${target.displayName || target.email}`,
  ].join('\n');

  return [
    buildAccessNotificationTx(
      target.userId,
      status === 'approved' ? 'access_approved' : 'access_rejected',
      `Access ${status}`,
      body,
      actor,
    ),
  ];
}

type UserChangeNotifType =
  | 'user_change_requested'
  | 'user_change_first_approved'
  | 'user_change_finalized'
  | 'user_change_rejected';

function buildUserChangeNotificationTx(
  recipientUserId: string,
  type: UserChangeNotifType,
  title: string,
  body: string,
  actor: Profile,
  requestId: string,
  actionStatus: string,
) {
  return db.tx.notifications[id()].update({
    recipientUserId,
    type,
    title,
    body,
    reportId: requestId,
    reportResponseId: '',
    storeId: '',
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus,
    actorUserId: actor.userId,
    actorRole: actor.role,
    readAt: '',
    createdAt: nowIso(),
  });
}

function uniqueRecipientIds(ids: string[], excludeUserId?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uid of ids) {
    if (!uid || uid === excludeUserId || seen.has(uid)) continue;
    seen.add(uid);
    out.push(uid);
  }
  return out;
}

export function buildUserChangeRequestedNotifications(params: {
  requestId: string;
  type: 'role_change' | 'delete' | string;
  target: Profile;
  toRole: string;
  actor: Profile;
  recipientUserIds: string[];
  status: string;
  note?: string;
}) {
  const { requestId, type, target, toRole, actor, recipientUserIds, status, note } = params;
  const action =
    type === 'delete'
      ? `delete access for ${target.displayName || target.email}`
      : `change ${target.displayName || target.email} from ${target.role} to ${toRole}`;
  const body = [
    `${actor.displayName || actor.email} (${actor.role}) requested to ${action}.`,
    note?.trim() ? `Note: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return uniqueRecipientIds(recipientUserIds, actor.userId).map((uid) =>
    buildUserChangeNotificationTx(
      uid,
      'user_change_requested',
      type === 'delete' ? 'User delete requested' : 'User role change requested',
      body,
      actor,
      requestId,
      status,
    ),
  );
}

export function buildUserChangeFirstApprovedNotifications(params: {
  request: { id: string; requestedByUserId: string; type: string; targetEmail: string; fromRole: string; toRole: string };
  actor: Profile;
  recipientUserIds: string[];
  note?: string;
}) {
  const { request, actor, recipientUserIds, note } = params;
  const body = [
    `First approval by ${actor.role} (${actor.displayName || actor.email}).`,
    `Request: ${request.type} for ${request.targetEmail} (${request.fromRole}${request.toRole ? ` → ${request.toRole}` : ''}).`,
    note?.trim() ? `Note: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return uniqueRecipientIds(recipientUserIds, actor.userId).map((uid) =>
    buildUserChangeNotificationTx(
      uid,
      'user_change_first_approved',
      'User change passed first approval',
      body,
      actor,
      request.id,
      'pending_final_approval',
    ),
  );
}

export function buildUserChangeFinalizedNotifications(params: {
  request: { id: string; requestedByUserId: string; type: string; targetEmail: string; fromRole: string; toRole: string };
  actor: Profile;
  target: Profile;
  note?: string;
}) {
  const { request, actor, target, note } = params;
  const body = [
    `Finalized by ${actor.role} (${actor.displayName || actor.email}).`,
    request.type === 'delete'
      ? `Access revoked for ${target.displayName || target.email}.`
      : `Role changed ${request.fromRole} → ${request.toRole} for ${target.displayName || target.email}.`,
    note?.trim() ? `Note: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return uniqueRecipientIds([request.requestedByUserId, target.userId], actor.userId).map((uid) =>
    buildUserChangeNotificationTx(
      uid,
      'user_change_finalized',
      'User change approved',
      body,
      actor,
      request.id,
      'approved',
    ),
  );
}

export function buildUserChangeRejectedNotifications(params: {
  request: { id: string; requestedByUserId: string; type: string; targetEmail: string };
  actor: Profile;
  reason: string;
}) {
  const { request, actor, reason } = params;
  const body = [
    `Rejected by ${actor.role} (${actor.displayName || actor.email}).`,
    `Request: ${request.type} for ${request.targetEmail}.`,
    `Reason: ${reason.trim()}`,
  ].join('\n');

  return uniqueRecipientIds([request.requestedByUserId], actor.userId).map((uid) =>
    buildUserChangeNotificationTx(
      uid,
      'user_change_rejected',
      'User change rejected',
      body,
      actor,
      request.id,
      'rejected',
    ),
  );
}

function emptyLogbookNotifFields(storeId: string, entryId: string, actionStatus: string) {
  return {
    reportId: entryId,
    reportResponseId: '',
    storeId,
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus,
  };
}

function profileHasStore(p: Profile, storeId: string, defs?: RoleDefinition[]): boolean {
  return userCanAccessStore(p.role, (p.stores ?? []).map((s) => s.id), storeId, defs);
}

export function getLogbookAssigneeRecipients(
  entry: Pick<LogbookEntry, 'storeId' | 'assigneeRole' | 'assigneeUserIdsJson'>,
  allProfiles: Profile[],
  actorUserId?: string,
  defs?: RoleDefinition[],
): string[] {
  const role = entry.assigneeRole ?? '';
  if (!entry.storeId || !role) return [];
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  const recipients = new Set<string>();
  for (const p of allProfiles) {
    if (p.approvalStatus !== 'approved') continue;
    if (p.role !== role) continue;
    if (!profileHasStore(p, entry.storeId, defs)) continue;
    if (assigneeIds.length > 0 && !assigneeIds.includes(p.userId)) continue;
    if (actorUserId && p.userId === actorUserId) continue;
    recipients.add(p.userId);
  }
  return [...recipients];
}

export function getLogbookReviewerRecipients(
  entry: LogbookEntry,
  allProfiles: Profile[],
  actorUserId: string,
  defs: RoleDefinition[],
): string[] {
  const assigneeRole = (entry.assigneeRole ?? '') as Role;
  if (!entry.storeId || !assigneeRole) return [];
  const assigneeRank = rankOf(assigneeRole, defs);
  const recipients = new Set<string>();
  for (const p of allProfiles) {
    if (p.userId === actorUserId) continue;
    if (p.approvalStatus !== 'approved') continue;
    if (!canReview(p.role, defs)) continue;
    if (rankOf(p.role, defs) >= assigneeRank) continue;
    if (!profileHasStore(p, entry.storeId, defs)) continue;
    recipients.add(p.userId);
  }
  return [...recipients];
}

export function getLogbookStoreManagerRecipients(
  storeId: string,
  allProfiles: Profile[],
  actorUserId?: string,
  defs?: RoleDefinition[],
): string[] {
  const recipients = new Set<string>();
  for (const p of allProfiles) {
    if (actorUserId && p.userId === actorUserId) continue;
    if (p.approvalStatus !== 'approved') continue;
    if (p.role !== 'manager') continue;
    if (!profileHasStore(p, storeId, defs)) continue;
    recipients.add(p.userId);
  }
  return [...recipients];
}

function buildLogbookNotificationTx(
  recipientUserId: string,
  type: string,
  title: string,
  body: string,
  actor: Profile,
  entry: Pick<LogbookEntry, 'id' | 'storeId'>,
  actionStatus: string,
) {
  return db.tx.notifications[id()].update({
    recipientUserId,
    type,
    title,
    body,
    actorUserId: actor.userId,
    actorRole: actor.role,
    readAt: '',
    createdAt: nowIso(),
    ...emptyLogbookNotifFields(entry.storeId, entry.id, actionStatus),
  });
}

function issueSnippet(entry: LogbookEntry): string {
  return entry.content.trim().slice(0, 120) || 'Logbook issue';
}

export function buildLogbookIssueAssignedNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  defs?: RoleDefinition[],
) {
  const recipients = getLogbookAssigneeRecipients(entry, allProfiles, actor.userId, defs);
  const body = [
    'New Logbook issue assigned',
    `Issue: ${issueSnippet(entry)}`,
    `Severity: ${entry.severity}`,
    `Due: ${entry.dueAt || '—'}`,
  ].join('\n');
  return recipients.map((uid) =>
    buildLogbookNotificationTx(
      uid,
      'logbook_issue_assigned',
      'New Logbook issue assigned',
      body,
      actor,
      entry,
      resolveLogbookIssueStatus(entry) || 'open',
    ),
  );
}

export function buildLogbookDueSoonNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  defs?: RoleDefinition[],
) {
  const recipients = getLogbookAssigneeRecipients(entry, allProfiles, undefined, defs);
  const body = [
    'Logbook issue due soon',
    `Issue: ${issueSnippet(entry)}`,
    `Due: ${entry.dueAt || '—'}`,
  ].join('\n');
  return recipients.map((uid) =>
    buildLogbookNotificationTx(
      uid,
      'logbook_issue_due_soon',
      'Logbook issue due soon',
      body,
      actor,
      entry,
      resolveLogbookIssueStatus(entry) || 'open',
    ),
  );
}

export function buildLogbookOverdueNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  defs: RoleDefinition[],
) {
  const recipients = new Set<string>([
    ...getLogbookAssigneeRecipients(entry, allProfiles, undefined, defs),
    ...getLogbookStoreManagerRecipients(entry.storeId, allProfiles, undefined, defs),
    ...getLogbookReviewerRecipients(entry, allProfiles, actor.userId, defs),
  ]);
  const body = [
    'Logbook issue overdue',
    `Issue: ${issueSnippet(entry)}`,
    `Due: ${entry.dueAt || '—'}`,
  ].join('\n');
  return [...recipients].map((uid) =>
    buildLogbookNotificationTx(
      uid,
      'logbook_issue_overdue',
      'Logbook issue overdue',
      body,
      actor,
      entry,
      resolveLogbookIssueStatus(entry) || 'open',
    ),
  );
}

export function buildLogbookResolutionSubmittedNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  defs: RoleDefinition[],
) {
  const recipients = getLogbookReviewerRecipients(entry, allProfiles, actor.userId, defs);
  const body = [
    'Resolution submitted for review',
    `Issue: ${issueSnippet(entry)}`,
    entry.resolutionNote?.trim() ? `Note: ${entry.resolutionNote.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return recipients.map((uid) =>
    buildLogbookNotificationTx(
      uid,
      'logbook_resolution_submitted',
      'Logbook resolution submitted',
      body,
      actor,
      entry,
      'waiting_approval',
    ),
  );
}

export function buildLogbookResolutionDecisionNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  decision: 'approved' | 'rejected',
  defs?: RoleDefinition[],
) {
  const recipients = new Set(getLogbookAssigneeRecipients(entry, allProfiles, actor.userId, defs));
  const submitter = entry.resolutionSubmittedByUserId?.trim();
  if (submitter && submitter !== actor.userId) recipients.add(submitter);
  if (decision === 'approved' && entry.authorUserId && entry.authorUserId !== actor.userId) {
    recipients.add(entry.authorUserId);
  }
  const type =
    decision === 'approved'
      ? 'logbook_resolution_approved'
      : 'logbook_resolution_correction_requested';
  const title =
    decision === 'approved'
      ? 'Logbook resolution approved'
      : 'Logbook resolution correction requested';
  const body = [
    title,
    `Issue: ${issueSnippet(entry)}`,
    entry.reviewNote?.trim() ? `Feedback: ${entry.reviewNote.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [...recipients].map((uid) =>
    buildLogbookNotificationTx(
      uid,
      type,
      title,
      body,
      actor,
      entry,
      decision === 'approved' ? 'resolved' : 'in_progress',
    ),
  );
}

export function buildLogbookIssueReopenedNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  defs?: RoleDefinition[],
) {
  const recipients = new Set([
    ...getLogbookAssigneeRecipients(entry, allProfiles, actor.userId, defs),
    ...getLogbookStoreManagerRecipients(entry.storeId, allProfiles, actor.userId, defs),
  ]);
  const submitter = entry.resolutionSubmittedByUserId?.trim();
  if (submitter && submitter !== actor.userId) recipients.add(submitter);
  const body = [
    'Logbook issue reopened',
    `Issue: ${issueSnippet(entry)}`,
    entry.reopenReason?.trim() ? `Reason: ${entry.reopenReason.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [...recipients].map((uid) =>
    buildLogbookNotificationTx(
      uid,
      'logbook_issue_reopened',
      'Logbook issue reopened',
      body,
      actor,
      entry,
      'in_progress',
    ),
  );
}

export function buildLogbookCreatorUpdateNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  note: string,
  defs?: RoleDefinition[],
) {
  const recipients = getLogbookAssigneeRecipients(entry, allProfiles, actor.userId, defs);
  const body = [
    'Logbook issue updated by creator',
    `Issue: ${issueSnippet(entry)}`,
    note.trim() ? `Update: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return recipients.map((uid) =>
    buildLogbookNotificationTx(
      uid,
      'logbook_creator_update',
      'Logbook issue updated',
      body,
      actor,
      entry,
      resolveLogbookIssueStatus(entry) || 'open',
    ),
  );
}

export function buildLogbookIssueRecalledNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  reason: string,
  defs?: RoleDefinition[],
) {
  const recipients = new Set([
    ...getLogbookAssigneeRecipients(entry, allProfiles, actor.userId, defs),
    ...getLogbookStoreManagerRecipients(entry.storeId, allProfiles, actor.userId, defs),
  ]);
  if (entry.authorUserId && entry.authorUserId !== actor.userId) {
    recipients.add(entry.authorUserId);
  }
  const body = [
    'Logbook issue recalled',
    `Issue: ${issueSnippet(entry)}`,
    reason.trim() ? `Reason: ${reason.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [...recipients].map((uid) =>
    buildLogbookNotificationTx(
      uid,
      'logbook_issue_recalled',
      'Logbook issue recalled',
      body,
      actor,
      entry,
      'recalled',
    ),
  );
}

/** Approved users who can see the note/announcement; excludes actor. */
export function getNoteAnnouncementRecipients(
  entry: LogbookEntry,
  profiles: Profile[],
  actorId: string,
  defs: RoleDefinition[],
): string[] {
  const recipients = new Set<string>();
  for (const p of profiles) {
    if (p.userId === actorId) continue;
    if (p.approvalStatus !== 'approved') continue;
    if (!canViewLogbookEntry(p, entry, defs)) continue;
    recipients.add(p.userId);
  }
  return [...recipients];
}

export function isNoteAnnouncementNotificationType(type: string): boolean {
  return type === 'logbook_note_created' || type === 'logbook_announcement_created';
}

export function isStoreChatMentionNotificationType(type: string): boolean {
  return type === 'store_chat_mention' || type === 'store_chat_mention_all';
}

export function buildLogbookNoteAnnouncementNotifications(
  entry: LogbookEntry,
  actor: Profile,
  allProfiles: Profile[],
  defs: RoleDefinition[],
) {
  if (!entry.requiresAck) return [];
  const type = resolveLogbookEntryType(entry);
  if (type !== 'note' && type !== 'announcement') return [];

  const recipients = getNoteAnnouncementRecipients(entry, allProfiles, actor.userId, defs);
  const notifType =
    type === 'announcement' ? 'logbook_announcement_created' : 'logbook_note_created';
  const title =
    type === 'announcement' ? 'New Logbook announcement' : 'New Logbook note';
  const kindLabel = type === 'announcement' ? 'Announcement' : 'Note';
  const body = [
    title,
    `${kindLabel}: ${issueSnippet(entry)}`,
    `Severity: ${entry.severity}`,
  ].join('\n');

  return recipients.map((uid) =>
    buildLogbookNotificationTx(
      uid,
      notifType,
      title,
      body,
      actor,
      entry,
      type,
    ),
  );
}

export function isLogbookNotificationType(type: string): boolean {
  return type.startsWith('logbook_');
}

function emptyStoreChatNotifFields(storeId: string, messageId: string) {
  return {
    reportId: messageId,
    reportResponseId: '',
    storeId,
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: '',
  };
}

function storeChatPreview(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117)}…`;
}

/**
 * In-app notifications for Store Chat @mentions / @all.
 * `reportId` stores the message id (same reuse pattern as logbook entry id).
 */
export function buildStoreChatMentionNotifications(opts: {
  messageId: string;
  storeId: string;
  storeLabel: string;
  body: string;
  actor: Profile;
  recipientUserIds: string[];
  mentionAll: boolean;
}) {
  const { messageId, storeId, storeLabel, body, actor, recipientUserIds, mentionAll } = opts;
  const actorName = actor.displayName?.trim() || actor.email?.split('@')[0] || 'Someone';
  const preview = storeChatPreview(body);
  const storePart = storeLabel.trim() || storeId;
  const type = mentionAll ? 'store_chat_mention_all' : 'store_chat_mention';
  const title = mentionAll
    ? `${actorName} mentioned everyone in Store Chat`
    : `${actorName} mentioned you in Store Chat`;
  const notifBody = [`Store: ${storePart}`, preview].filter(Boolean).join('\n');

  const seen = new Set<string>();
  const txs = [];
  for (const uid of recipientUserIds) {
    if (!uid || uid === actor.userId) continue;
    if (seen.has(uid)) continue;
    seen.add(uid);
    txs.push(
      db.tx.notifications[id()].update({
        recipientUserId: uid,
        type,
        title,
        body: notifBody,
        actorUserId: actor.userId,
        actorRole: actor.role,
        readAt: '',
        createdAt: nowIso(),
        ...emptyStoreChatNotifFields(storeId, messageId),
      }),
    );
  }
  return txs;
}
