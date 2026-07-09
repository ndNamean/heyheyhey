import { id } from '@instantdb/react';
import { db } from '../db';
import { nowIso } from './utils';
import type { Profile, Report, ReportResponse, ReviewEventType } from '../types';

interface EventBase {
  reportId: string;
  storeId: string;
  actorUserId: string;
  actorRole: string;
  createdAt?: string;
}

function createEventTx(
  base: EventBase,
  eventType: ReviewEventType,
  fields: {
    reportResponseId?: string;
    itemTitle?: string;
    statusAfter: string;
    note?: string;
  },
) {
  return db.tx.reviewEvents[id()].update({
    reportId: base.reportId,
    reportResponseId: fields.reportResponseId ?? '',
    storeId: base.storeId,
    eventType,
    itemTitle: fields.itemTitle ?? '',
    statusAfter: fields.statusAfter,
    actorUserId: base.actorUserId,
    actorRole: base.actorRole,
    note: fields.note ?? '',
    createdAt: base.createdAt ?? nowIso(),
  });
}

export function buildReportSubmittedEvents(
  reportId: string,
  storeId: string,
  profile: Profile,
  responses: Array<{ id: string; title: string; status: string }>,
  createdAt?: string,
) {
  const base: EventBase = {
    reportId,
    storeId,
    actorUserId: profile.userId,
    actorRole: profile.role,
    createdAt,
  };

  const txs = [
    createEventTx(base, 'submitted', {
      statusAfter: 'waiting_approval',
    }),
  ];

  for (const resp of responses) {
    if (resp.status !== 'waiting_approval') continue;
    txs.push(
      createEventTx(base, 'submitted', {
        reportResponseId: resp.id,
        itemTitle: resp.title,
        statusAfter: 'waiting_approval',
      }),
    );
  }

  return txs;
}

export function buildItemResubmittedEvents(
  reportId: string,
  storeId: string,
  profile: Profile,
  items: Array<{ id: string; title: string }>,
  createdAt?: string,
) {
  const base: EventBase = {
    reportId,
    storeId,
    actorUserId: profile.userId,
    actorRole: profile.role,
    createdAt,
  };

  return items.map((item) =>
    createEventTx(base, 'resubmitted', {
      reportResponseId: item.id,
      itemTitle: item.title,
      statusAfter: 'waiting_approval',
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
    createdAt,
  };

  return createEventTx(base, eventType, {
    reportResponseId: response.id,
    itemTitle: response.title,
    statusAfter: status,
    note,
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
    createdAt,
  };

  return createEventTx(base, 'report_finalized', {
    statusAfter: reportStatus,
  });
}
