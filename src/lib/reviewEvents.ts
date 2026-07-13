import { id } from '@instantdb/react';
import { db } from '../db';
import { nowIso } from './utils';
import type { Profile, Report, ReportResponse, ReviewEventType } from '../types';

interface EventBase {
  reportId: string;
  storeId: string;
  actorUserId: string;
  actorRole: string;
  actorDisplayNameSnapshot?: string;
  createdAt?: string;
}

interface EventFields {
  reportResponseId?: string;
  itemTitle?: string;
  templateItemId?: string;
  sectionSnapshot?: string;
  categorySnapshot?: string;
  statusAfter: string;
  previousStatus?: string;
  note?: string;
  feedbackCode?: string;
  feedbackNote?: string;
}

function actorDisplayName(profile: Profile): string {
  return profile.displayName?.trim() || profile.email?.split('@')[0] || profile.userId;
}

function createEventTx(
  base: EventBase,
  eventType: ReviewEventType,
  fields: EventFields,
) {
  return db.tx.reviewEvents[id()].update({
    reportId: base.reportId,
    reportResponseId: fields.reportResponseId ?? '',
    storeId: base.storeId,
    eventType,
    itemTitle: fields.itemTitle ?? '',
    templateItemId: fields.templateItemId ?? '',
    sectionSnapshot: fields.sectionSnapshot ?? '',
    categorySnapshot: fields.categorySnapshot ?? '',
    statusAfter: fields.statusAfter,
    previousStatus: fields.previousStatus ?? '',
    actorUserId: base.actorUserId,
    actorRole: base.actorRole,
    actorDisplayNameSnapshot: base.actorDisplayNameSnapshot ?? '',
    note: fields.note ?? '',
    feedbackCode: fields.feedbackCode ?? '',
    feedbackNote: fields.feedbackNote ?? '',
    createdAt: base.createdAt ?? nowIso(),
  });
}

export function buildReportSubmittedEvents(
  reportId: string,
  storeId: string,
  profile: Profile,
  responses: Array<{
    id: string;
    title: string;
    status: string;
    templateItemId?: string;
    section?: string;
    failureCategory?: string;
  }>,
  createdAt?: string,
) {
  const base: EventBase = {
    reportId,
    storeId,
    actorUserId: profile.userId,
    actorRole: profile.role,
    actorDisplayNameSnapshot: actorDisplayName(profile),
    createdAt,
  };

  const txs = [
    createEventTx(base, 'submitted', {
      statusAfter: 'waiting_approval',
      previousStatus: 'not_started',
    }),
  ];

  for (const resp of responses) {
    if (resp.status !== 'waiting_approval') continue;
    txs.push(
      createEventTx(base, 'submitted', {
        reportResponseId: resp.id,
        itemTitle: resp.title,
        templateItemId: resp.templateItemId,
        sectionSnapshot: resp.section,
        categorySnapshot: resp.failureCategory,
        statusAfter: 'waiting_approval',
        previousStatus: 'not_started',
      }),
    );
  }

  return txs;
}

export function buildItemResubmittedEvents(
  reportId: string,
  storeId: string,
  profile: Profile,
  items: Array<{
    id: string;
    title: string;
    templateItemId?: string;
    section?: string;
    failureCategory?: string;
    previousStatus?: string;
  }>,
  createdAt?: string,
) {
  const base: EventBase = {
    reportId,
    storeId,
    actorUserId: profile.userId,
    actorRole: profile.role,
    actorDisplayNameSnapshot: actorDisplayName(profile),
    createdAt,
  };

  return items.map((item) =>
    createEventTx(base, 'resubmitted', {
      reportResponseId: item.id,
      itemTitle: item.title,
      templateItemId: item.templateItemId,
      sectionSnapshot: item.section,
      categorySnapshot: item.failureCategory,
      statusAfter: 'waiting_approval',
      previousStatus: item.previousStatus ?? 'rejected',
    }),
  );
}

export function buildItemReviewEvent(
  report: Report,
  response: ReportResponse,
  status: 'approved' | 'rejected' | 'need_correction',
  note: string,
  approver: Profile,
  createdAt?: string,
  feedback?: { feedbackCode?: string; feedbackNote?: string },
) {
  const eventType: ReviewEventType =
    status === 'approved'
      ? 'item_approved'
      : status === 'rejected'
        ? 'item_rejected'
        : 'item_correction';

  const base: EventBase = {
    reportId: report.id,
    storeId: report.storeId,
    actorUserId: approver.userId,
    actorRole: approver.role,
    actorDisplayNameSnapshot: actorDisplayName(approver),
    createdAt,
  };

  return createEventTx(base, eventType, {
    reportResponseId: response.id,
    itemTitle: response.title,
    templateItemId: response.templateItemId,
    sectionSnapshot: response.section,
    categorySnapshot: response.failureCategory,
    statusAfter: status,
    previousStatus: response.status,
    note,
    feedbackCode: feedback?.feedbackCode,
    feedbackNote: feedback?.feedbackNote,
  });
}

export function buildReportFinalizedEvent(
  report: Report,
  reportStatus: string,
  approver: Profile,
  createdAt?: string,
) {
  const base: EventBase = {
    reportId: report.id,
    storeId: report.storeId,
    actorUserId: approver.userId,
    actorRole: approver.role,
    actorDisplayNameSnapshot: actorDisplayName(approver),
    createdAt,
  };

  return createEventTx(base, 'report_finalized', {
    statusAfter: reportStatus,
    previousStatus: report.status,
  });
}
