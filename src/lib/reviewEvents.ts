import { id } from '@instantdb/react';
import { db } from '../db';
import { nowIso } from './utils';
import type { LogbookEntry, Profile, Report, ReportResponse, ReviewEventType } from '../types';

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

interface LogbookEventBase {
  logbookEntryId: string;
  storeId: string;
  actorUserId: string;
  actorRole: string;
  actorDisplayNameSnapshot?: string;
  createdAt?: string;
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
    logbookEntryId: '',
    targetType: 'report',
  });
}

function createLogbookEventTx(
  base: LogbookEventBase,
  eventType: ReviewEventType,
  fields: { statusAfter: string; previousStatus?: string; note?: string; itemTitle?: string },
) {
  return db.tx.reviewEvents[id()].update({
    reportId: '',
    reportResponseId: '',
    storeId: base.storeId,
    eventType,
    itemTitle: fields.itemTitle ?? '',
    templateItemId: '',
    sectionSnapshot: '',
    categorySnapshot: '',
    statusAfter: fields.statusAfter,
    previousStatus: fields.previousStatus ?? '',
    actorUserId: base.actorUserId,
    actorRole: base.actorRole,
    actorDisplayNameSnapshot: base.actorDisplayNameSnapshot ?? '',
    note: fields.note ?? '',
    feedbackCode: '',
    feedbackNote: '',
    createdAt: base.createdAt ?? nowIso(),
    logbookEntryId: base.logbookEntryId,
    targetType: 'logbook',
  });
}

function logbookActorBase(entryId: string, storeId: string, profile: Profile, createdAt?: string): LogbookEventBase {
  return {
    logbookEntryId: entryId,
    storeId,
    actorUserId: profile.userId,
    actorRole: profile.role,
    actorDisplayNameSnapshot: actorDisplayName(profile),
    createdAt,
  };
}

export function buildLogbookIssueCreatedEvents(
  entry: Pick<LogbookEntry, 'id' | 'storeId' | 'content' | 'assigneeRole' | 'dueAt'>,
  profile: Profile,
  createdAt?: string,
) {
  const base = logbookActorBase(entry.id, entry.storeId, profile, createdAt);
  const title = entry.content.slice(0, 80);
  return [
    createLogbookEventTx(base, 'issue_created', {
      statusAfter: 'open',
      previousStatus: '',
      itemTitle: title,
    }),
    createLogbookEventTx(base, 'issue_assigned', {
      statusAfter: 'open',
      previousStatus: '',
      itemTitle: title,
      note: `Assigned to ${entry.assigneeRole}; due ${entry.dueAt}`,
    }),
  ];
}

export function buildLogbookWorkStartedEvent(
  entry: LogbookEntry,
  profile: Profile,
  previousStatus: string,
  createdAt?: string,
) {
  return createLogbookEventTx(logbookActorBase(entry.id, entry.storeId, profile, createdAt), 'work_started', {
    statusAfter: 'in_progress',
    previousStatus,
    itemTitle: entry.content.slice(0, 80),
  });
}

export function buildLogbookResolutionSubmittedEvent(
  entry: LogbookEntry,
  profile: Profile,
  previousStatus: string,
  note: string,
  priorFileId?: string,
  createdAt?: string,
) {
  const meta = priorFileId ? `priorFileId:${priorFileId}` : '';
  return createLogbookEventTx(
    logbookActorBase(entry.id, entry.storeId, profile, createdAt),
    'resolution_submitted',
    {
      statusAfter: 'waiting_approval',
      previousStatus,
      itemTitle: entry.content.slice(0, 80),
      note: [note.trim(), meta].filter(Boolean).join('\n'),
    },
  );
}

export function buildLogbookResolutionApprovedEvent(
  entry: LogbookEntry,
  profile: Profile,
  reviewNote: string,
  createdAt?: string,
) {
  return createLogbookEventTx(
    logbookActorBase(entry.id, entry.storeId, profile, createdAt),
    'resolution_approved',
    {
      statusAfter: 'resolved',
      previousStatus: 'waiting_approval',
      itemTitle: entry.content.slice(0, 80),
      note: reviewNote,
    },
  );
}

export function buildLogbookResolutionRejectedEvent(
  entry: LogbookEntry,
  profile: Profile,
  reviewNote: string,
  createdAt?: string,
) {
  return createLogbookEventTx(
    logbookActorBase(entry.id, entry.storeId, profile, createdAt),
    'resolution_rejected',
    {
      statusAfter: 'in_progress',
      previousStatus: 'waiting_approval',
      itemTitle: entry.content.slice(0, 80),
      note: reviewNote,
    },
  );
}

export function buildLogbookIssueReopenedEvent(
  entry: LogbookEntry,
  profile: Profile,
  reason: string,
  createdAt?: string,
) {
  return createLogbookEventTx(logbookActorBase(entry.id, entry.storeId, profile, createdAt), 'issue_reopened', {
    statusAfter: 'in_progress',
    previousStatus: 'resolved',
    itemTitle: entry.content.slice(0, 80),
    note: reason,
  });
}

export function buildLogbookAssignmentChangedEvent(
  entry: LogbookEntry,
  profile: Profile,
  note: string,
  statusAfter: string,
  previousStatus: string,
  createdAt?: string,
) {
  return createLogbookEventTx(
    logbookActorBase(entry.id, entry.storeId, profile, createdAt),
    'due_date_changed',
    {
      statusAfter,
      previousStatus,
      itemTitle: entry.content.slice(0, 80),
      note,
    },
  );
}

export function buildLogbookAcknowledgedEvent(
  entry: LogbookEntry,
  profile: Profile,
  createdAt?: string,
) {
  return createLogbookEventTx(logbookActorBase(entry.id, entry.storeId, profile, createdAt), 'acknowledged', {
    statusAfter: entry.status ?? '',
    previousStatus: entry.status ?? '',
    itemTitle: entry.content.slice(0, 80),
  });
}

export function buildLogbookCreatorUpdateEvent(
  entry: LogbookEntry,
  profile: Profile,
  note: string,
  statusAfter: string,
  previousStatus: string,
  createdAt?: string,
) {
  return createLogbookEventTx(
    logbookActorBase(entry.id, entry.storeId, profile, createdAt),
    'creator_update',
    {
      statusAfter,
      previousStatus,
      itemTitle: entry.content.slice(0, 80),
      note,
    },
  );
}

export function buildLogbookIssueRecalledEvent(
  entry: LogbookEntry,
  profile: Profile,
  reason: string,
  previousStatus: string,
  createdAt?: string,
) {
  return createLogbookEventTx(
    logbookActorBase(entry.id, entry.storeId, profile, createdAt),
    'issue_recalled',
    {
      statusAfter: 'recalled',
      previousStatus,
      itemTitle: entry.content.slice(0, 80),
      note: reason,
    },
  );
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
