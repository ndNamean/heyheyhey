/**
 * Shared Report → Store Chat notification content (inbox mention + chat).
 * Server twin: api/_lib/report/notification-content.js — keep in sync.
 */

import { LOGBOOK_MENTION_CAP } from './logbookNotificationContent';
import { canReviewReport, canReviewReportItem } from './reportReview';
import { getReviewNotificationRecipients } from './notifications';
import {
  isHigherPositionReview,
  supervisorRolesToNotify,
  userCanAccessStore,
} from './roles';
import type { Profile, Report, ReportResponse, Role, RoleDefinition } from '../types';

export { LOGBOOK_MENTION_CAP as REPORT_CHAT_MENTION_CAP };

export type ReportNotifyEventType =
  | 'report_submitted'
  | 'report_action_required'
  | 'report_finalized';

export type ReportChatActionType = 'open_review' | 'fix_resubmit' | 'view';

export interface NormalizedReportNotification {
  eventType: ReportNotifyEventType;
  eventVersion: string;
  reportId: string;
  reportDisplayId: string;
  summary: string;
  storeId: string;
  storeLabel: string;
  actorUserId: string;
  actorLabel: string;
  recipientUserIds: string[];
  requiredAction: string;
  actionType: ReportChatActionType;
  statusSnapshot: string;
  deepLink: {
    page: 'review';
    surface: 'reports';
    reportId: string;
    storeId: string;
  };
  copy: {
    icon: string;
    eventLabel: string;
    scannableLine: string;
    pushTitle: string;
    pushBody: string;
    chatBody: string;
    inboxTitle: string;
    inboxBody: string;
  };
  type: string;
  title: string;
  body: string;
  deepLinkJson: string;
  deliveryKeyPrefix: string;
  chatDeliveryKey: string;
}

export type BuildNormalizedReportNotificationInput = {
  report: {
    id: string;
    storeId?: string;
    storeCode?: string;
    storeName?: string;
    templateName?: string;
    reportDate?: string;
    status?: string;
    submittedByUserId?: string;
    submittedByRole?: string;
  };
  eventType: ReportNotifyEventType;
  eventVersion: string;
  recipients: string[];
  actor?: { userId?: string; displayName?: string; email?: string };
  storeLabel?: string;
  note?: string;
  profiles?: Array<{ userId: string; displayName?: string; email?: string }>;
  /** Item title when event is tied to a single response. */
  itemTitle?: string;
};

const EVENT_META: Record<
  ReportNotifyEventType,
  {
    type: string;
    icon: string;
    eventLabel: string;
    actionType: ReportChatActionType;
    requiredAction: string;
    defaultStatus: string;
  }
> = {
  report_submitted: {
    type: 'report_submitted_chat',
    icon: '📋',
    eventLabel: 'Report ready for review',
    actionType: 'open_review',
    requiredAction: 'Open Review',
    defaultStatus: 'waiting_approval',
  },
  report_action_required: {
    type: 'report_action_required_chat',
    icon: '✏️',
    eventLabel: 'Action required on report',
    actionType: 'fix_resubmit',
    requiredAction: 'Fix and resubmit',
    defaultStatus: 'need_correction',
  },
  report_finalized: {
    type: 'report_finalized_chat',
    icon: '🏁',
    eventLabel: 'Report finalized with issues',
    actionType: 'view',
    requiredAction: 'View / fix',
    defaultStatus: 'rejected',
  },
};

type ReportEventMeta = (typeof EVENT_META)[ReportNotifyEventType];

/** Branch report_finalized copy by live report status (approved vs issues). */
export function resolveReportEventMeta(
  eventType: ReportNotifyEventType,
  reportStatus?: string,
): ReportEventMeta {
  const base = EVENT_META[eventType];
  if (eventType !== 'report_finalized') return base;
  const status = String(reportStatus || '').trim();
  if (status === 'approved') {
    return {
      ...base,
      eventLabel: 'Report approved',
      actionType: 'view',
      requiredAction: 'View',
      defaultStatus: 'approved',
    };
  }
  return base;
}

export function reportDisplayId(reportId: string): string {
  const id = String(reportId || '').trim();
  return id ? `#${id.slice(0, 6)}` : '#------';
}

export function reportDeliveryKeyPrefix(
  reportId: string,
  eventType: string,
  eventVersion: string,
): string {
  return `report:${reportId}:${eventType}:${eventVersion}`;
}

export function reportDeliveryKeyForRecipient(
  reportId: string,
  eventType: string,
  eventVersion: string,
  recipientUserId: string,
): string {
  return `${reportDeliveryKeyPrefix(reportId, eventType, eventVersion)}:${recipientUserId}`;
}

export function reportChatDeliveryKey(
  reportId: string,
  eventType: string,
  eventVersion: string,
  storeId: string,
): string {
  return `report-chat:${reportId}:${eventType}:${eventVersion}:${storeId || ''}`;
}

export function reportActionRequiredChatKey(
  reportId: string,
  eventVersion: string,
  storeId: string,
): string {
  return reportChatDeliveryKey(reportId, 'report_action_required', eventVersion, storeId);
}

export function profileMentionLabel(profile?: {
  displayName?: string;
  email?: string;
  userId?: string;
}): string {
  const name = profile?.displayName?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  if (email) return email.split('@')[0] || 'Someone';
  return 'Someone';
}

/** Cap @mentions at REPORT_CHAT_MENTION_CAP; above that return []. Never @all. */
export function selectReportMentionUserIds(recipientUserIds: string[]): string[] {
  const ids = [...new Set(recipientUserIds.filter(Boolean))];
  if (ids.length === 0 || ids.length > LOGBOOK_MENTION_CAP) return [];
  return ids;
}

export function selectReportMentionLabels(
  profiles: Array<{ userId: string; displayName?: string; email?: string }>,
  ids: string[],
): string[] {
  return ids.map((userId) => {
    const p = profiles.find((x) => x.userId === userId);
    return profileMentionLabel(p || { userId });
  });
}

/**
 * Report Store Chat notify — default OFF (opt-in).
 * Enabled only when value is 1 / true / on / yes.
 */
export function isReportChatNotifyEnabled(
  value:
    | string
    | undefined
    | null = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: Record<string, string> }).env
        ?.VITE_REPORT_CHAT_NOTIFY
    : undefined,
): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

function trimSummary(report: BuildNormalizedReportNotificationInput['report']): string {
  const parts = [
    String(report.templateName || '').trim(),
    String(report.reportDate || '').trim(),
  ].filter(Boolean);
  const s = parts.join(' · ') || 'Checklist report';
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

/**
 * Reviewers who can review ≥1 waiting item; else anyone who canReviewReport.
 * Excludes actor. Named mentions only.
 */
export function selectReportSubmittedRecipients(
  report: Pick<Report, 'storeId'>,
  responses: Array<Pick<ReportResponse, 'status' | 'submittedByRole' | 'approverRolesJson'>>,
  profiles: Profile[],
  actorUserId: string,
  defs: RoleDefinition[],
): string[] {
  const waiting = responses.filter((r) => r.status === 'waiting_approval');
  const recipients = new Set<string>();

  if (waiting.length) {
    for (const p of profiles) {
      if (!p.userId || p.userId === actorUserId) continue;
      if (waiting.some((resp) => canReviewReportItem(p, report, resp, defs))) {
        recipients.add(p.userId);
      }
    }
  }

  if (recipients.size === 0) {
    for (const p of profiles) {
      if (!p.userId || p.userId === actorUserId) continue;
      if (canReviewReport(p, report, defs)) recipients.add(p.userId);
    }
  }

  return [...recipients];
}

/** Submitter + supervisors (same as item-review inbox). */
export function selectReportActionRecipients(
  report: Report,
  response: ReportResponse,
  approver: Profile,
  allProfiles: Profile[],
  defs?: RoleDefinition[],
): string[] {
  return getReviewNotificationRecipients(report, response, approver, allProfiles, defs);
}

/** Finalize recipients: submitter + supervisors (same as buildReportFinalizedNotifications). */
export function selectReportFinalizedRecipients(
  report: Pick<Report, 'storeId' | 'submittedByUserId' | 'submittedByRole'>,
  approver: Profile,
  allProfiles: Profile[],
  defs?: RoleDefinition[],
): string[] {
  const recipients = new Set<string>();
  if (report.submittedByUserId && report.submittedByUserId !== approver.userId) {
    recipients.add(report.submittedByUserId);
  }
  const submitterRole = report.submittedByRole as Role;
  if (isHigherPositionReview(approver.role, submitterRole, defs)) {
    const supervisorRoles = new Set(supervisorRolesToNotify(submitterRole, defs));
    for (const p of allProfiles) {
      if (p.userId === approver.userId) continue;
      if (p.approvalStatus !== 'approved') continue;
      if (!supervisorRoles.has(p.role)) continue;
      if (
        !userCanAccessStore(
          p.role,
          (p.stores ?? []).map((s) => s.id),
          report.storeId,
          defs,
        )
      ) {
        continue;
      }
      recipients.add(p.userId);
    }
  }
  return [...recipients];
}

export function buildNormalizedReportNotification(
  input: BuildNormalizedReportNotificationInput,
): NormalizedReportNotification {
  if (!EVENT_META[input.eventType]) {
    throw new Error(`Unsupported report notify event: ${input.eventType}`);
  }

  const report = input.report;
  const reportId = String(report.id || '').trim();
  const storeId = String(report.storeId || '');
  const displayId = reportDisplayId(reportId);
  const summary = trimSummary(report);
  const actorUserId = String(input.actor?.userId || '').trim();
  const actorLabel = profileMentionLabel(input.actor);
  const storeLabel =
    String(input.storeLabel || '').trim() ||
    [report.storeCode, report.storeName].filter(Boolean).join(' — ') ||
    (storeId ? 'Unknown store' : 'Unknown store');
  const statusHint = String(report.status || '').trim();
  const meta = resolveReportEventMeta(input.eventType, statusHint);
  const statusSnapshot = statusHint || meta.defaultStatus;
  const detail =
    String(input.note || '').trim() ||
    String(input.itemTitle || '').trim();

  const scannableLine =
    [
      `${meta.icon} ${meta.eventLabel}`,
      `${displayId} · ${summary}`,
      storeLabel,
    ].join(' · ') + ` → ${meta.requiredAction}`;

  const pushBodyParts = [`${displayId} · ${summary}`, storeLabel, meta.requiredAction];
  if (detail) pushBodyParts.push(detail);

  const mentionIds = selectReportMentionUserIds(input.recipients);
  const mentionLabels = selectReportMentionLabels(input.profiles || [], mentionIds);
  const mentionLine =
    mentionLabels.length > 0 ? mentionLabels.map((l) => `@${l}`).join(' ') : '';

  const chatLines = [
    `${meta.icon} ${meta.eventLabel} · ${displayId} · ${summary}`,
    `${storeLabel} → ${meta.requiredAction}`,
  ];
  if (mentionLine) chatLines.push(mentionLine);
  if (detail) chatLines.push(detail);

  const inboxBody = [
    meta.eventLabel,
    `Report ${displayId}: ${summary}`,
    `Store: ${storeLabel}`,
    `Action: ${meta.requiredAction}`,
    detail ? `Note: ${detail}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const deepLink = {
    page: 'review' as const,
    surface: 'reports' as const,
    reportId,
    storeId,
  };
  const prefix = reportDeliveryKeyPrefix(reportId, input.eventType, input.eventVersion);
  const chatKey = reportChatDeliveryKey(
    reportId,
    input.eventType,
    input.eventVersion,
    storeId,
  );

  const copy = {
    icon: meta.icon,
    eventLabel: meta.eventLabel,
    scannableLine,
    pushTitle: meta.eventLabel,
    pushBody: pushBodyParts.join(' · '),
    chatBody: chatLines.join('\n'),
    inboxTitle: meta.eventLabel,
    inboxBody,
  };

  return {
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    reportId,
    reportDisplayId: displayId,
    summary,
    storeId,
    storeLabel,
    actorUserId,
    actorLabel,
    recipientUserIds: [...input.recipients],
    requiredAction: meta.requiredAction,
    actionType: meta.actionType,
    statusSnapshot,
    deepLink,
    copy,
    type: meta.type,
    title: copy.inboxTitle,
    body: copy.inboxBody,
    deepLinkJson: JSON.stringify(deepLink),
    deliveryKeyPrefix: prefix,
    chatDeliveryKey: chatKey,
  };
}

/** Volume-policy helpers for tests / call-site docs. */
export function shouldEmitReportChatOnItemApprove(): boolean {
  return false;
}

export function shouldEmitReportFinalizedChat(opts: {
  reportStatus: string;
  actionRequiredAlreadyDelivered: boolean;
}): boolean {
  const status = String(opts.reportStatus || '');
  if (status === 'waiting_approval') return false;
  if (status === 'approved') return true;
  if (status !== 'rejected' && status !== 'need_correction') return false;
  if (opts.actionRequiredAlreadyDelivered) return false;
  return true;
}
