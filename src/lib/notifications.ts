import { id } from '@instantdb/react';
import { db } from '../db';
import {
  isHigherPositionReview,
  supervisorRolesToNotify,
  userCanAccessStore,
} from './roles';
import { nowIso } from './utils';
import type { Notification, Profile, Report, ReportResponse, Role } from '../types';

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
