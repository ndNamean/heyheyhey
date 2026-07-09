import { formatIsoToLocalTime } from './proofTime';
import type {
  Notification,
  Report,
  ReportResponse,
  ReviewEvent,
  ReviewEventType,
} from '../types';

export type TimelineStepSource = 'event' | 'inferred';

export interface TimelineStep {
  eventType: ReviewEventType;
  at: string;
  atDisplay: string;
  itemTitle: string;
  reportResponseId: string;
  statusAfter: string;
  actorRole: string;
  note: string;
  source: TimelineStepSource;
}

export interface ItemTimeline {
  reportResponseId: string;
  itemTitle: string;
  steps: TimelineStep[];
  durationMs: number | null;
  currentStatus: string;
}

export interface ReportTimelineData {
  reportId: string;
  source: 'events' | 'inferred' | 'mixed';
  firstSubmittedAt: string | null;
  finalizedAt: string | null;
  totalDurationMs: number | null;
  correctionCycles: number;
  currentStatus: string;
  reportSteps: TimelineStep[];
  items: ItemTimeline[];
}

const NOTIFICATION_TO_EVENT: Partial<Record<string, ReviewEventType>> = {
  item_approved: 'item_approved',
  item_rejected: 'item_rejected',
  item_correction: 'item_correction',
  report_finalized: 'report_finalized',
};

function parseMs(iso?: string): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatDuration(ms: number): string {
  if (ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null) return '—';
  return formatDuration(ms);
}

function eventToStep(event: ReviewEvent): TimelineStep {
  return {
    eventType: event.eventType,
    at: event.createdAt,
    atDisplay: formatIsoToLocalTime(event.createdAt),
    itemTitle: event.itemTitle,
    reportResponseId: event.reportResponseId,
    statusAfter: event.statusAfter,
    actorRole: event.actorRole,
    note: event.note,
    source: 'event',
  };
}

function sortSteps(steps: TimelineStep[]): TimelineStep[] {
  return [...steps].sort((a, b) => a.at.localeCompare(b.at));
}

function buildInferredSteps(
  report: Report,
  responses: ReportResponse[],
  notifications: Notification[],
): TimelineStep[] {
  const steps: TimelineStep[] = [];

  if (report.submittedAt) {
    steps.push({
      eventType: 'submitted',
      at: report.submittedAt,
      atDisplay: formatIsoToLocalTime(report.submittedAt),
      itemTitle: '',
      reportResponseId: '',
      statusAfter: 'waiting_approval',
      actorRole: report.submittedByRole,
      note: '',
      source: 'inferred',
    });
  }

  for (const resp of responses) {
    if (resp.submittedAt) {
      steps.push({
        eventType: 'submitted',
        at: resp.submittedAt,
        atDisplay: formatIsoToLocalTime(resp.submittedAt),
        itemTitle: resp.title,
        reportResponseId: resp.id,
        statusAfter: 'waiting_approval',
        actorRole: resp.submittedByRole,
        note: '',
        source: 'inferred',
      });
    }
  }

  const reportNotifs = notifications
    .filter((n) => n.reportId === report.id)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  for (const n of reportNotifs) {
    const eventType = NOTIFICATION_TO_EVENT[n.type];
    if (!eventType) continue;
    steps.push({
      eventType,
      at: n.createdAt,
      atDisplay: formatIsoToLocalTime(n.createdAt),
      itemTitle: n.itemTitle,
      reportResponseId: n.reportResponseId,
      statusAfter: n.actionStatus,
      actorRole: n.actorRole,
      note: n.body.split('\n').find((line) => line.startsWith('Feedback:'))?.replace('Feedback: ', '') ?? '',
      source: 'inferred',
    });
  }

  for (const resp of responses) {
    if (
      (resp.status === 'rejected' || resp.status === 'need_correction') &&
      resp.rejectionReason &&
      !steps.some(
        (s) =>
          s.reportResponseId === resp.id &&
          (s.eventType === 'item_rejected' || s.eventType === 'item_correction'),
      )
    ) {
      const eventType: ReviewEventType =
        resp.status === 'rejected' ? 'item_rejected' : 'item_correction';
      steps.push({
        eventType,
        at: resp.updatedAt || resp.approvedAt || resp.submittedAt,
        atDisplay: formatIsoToLocalTime(resp.updatedAt || resp.approvedAt || resp.submittedAt),
        itemTitle: resp.title,
        reportResponseId: resp.id,
        statusAfter: resp.status,
        actorRole: '',
        note: resp.rejectionReason,
        source: 'inferred',
      });
    }
    if (
      resp.status === 'approved' &&
      resp.approvedAt &&
      !steps.some((s) => s.reportResponseId === resp.id && s.eventType === 'item_approved')
    ) {
      steps.push({
        eventType: 'item_approved',
        at: resp.approvedAt,
        atDisplay: formatIsoToLocalTime(resp.approvedAt),
        itemTitle: resp.title,
        reportResponseId: resp.id,
        statusAfter: 'approved',
        actorRole: '',
        note: '',
        source: 'inferred',
      });
    }
  }

  return sortSteps(steps);
}

function buildItemTimelines(steps: TimelineStep[], responses: ReportResponse[]): ItemTimeline[] {
  const byItem = new Map<string, TimelineStep[]>();

  for (const step of steps) {
    if (!step.reportResponseId) continue;
    const list = byItem.get(step.reportResponseId) ?? [];
    list.push(step);
    byItem.set(step.reportResponseId, list);
  }

  const items: ItemTimeline[] = [];

  for (const resp of responses) {
    const itemSteps = sortSteps(byItem.get(resp.id) ?? []);
    const firstSubmit = itemSteps.find((s) => s.eventType === 'submitted');
    const approved = [...itemSteps].reverse().find((s) => s.eventType === 'item_approved');
    const endMs = approved ? parseMs(approved.at) : Date.now();
    const startMs = firstSubmit ? parseMs(firstSubmit.at) : parseMs(resp.submittedAt);
    const durationMs = startMs != null && endMs != null ? endMs - startMs : null;

    items.push({
      reportResponseId: resp.id,
      itemTitle: resp.title,
      steps: itemSteps,
      durationMs,
      currentStatus: resp.status,
    });
  }

  return items.sort((a, b) => a.itemTitle.localeCompare(b.itemTitle));
}

export function buildReportTimeline(
  report: Report,
  events: ReviewEvent[],
  notifications: Notification[] = [],
): ReportTimelineData {
  const responses = (report.responses ?? []) as ReportResponse[];
  const reportEvents = events.filter((e) => e.reportId === report.id);

  let steps: TimelineStep[];
  let source: ReportTimelineData['source'];

  if (reportEvents.length > 0) {
    steps = sortSteps(reportEvents.map(eventToStep));
    source = 'events';
  } else {
    steps = buildInferredSteps(report, responses, notifications);
    source = 'inferred';
  }

  const reportSteps = steps.filter((s) => !s.reportResponseId || s.eventType === 'report_finalized');
  const firstSubmitted = steps.find((s) => s.eventType === 'submitted' && !s.reportResponseId)
    ?? steps.find((s) => s.eventType === 'submitted');
  const finalized = [...steps].reverse().find((s) => s.eventType === 'report_finalized');

  const firstMs = firstSubmitted ? parseMs(firstSubmitted.at) : parseMs(report.submittedAt);
  const endMs = finalized ? parseMs(finalized.at) : null;
  const totalDurationMs =
    firstMs != null && endMs != null ? endMs - firstMs : null;

  const correctionCycles = steps.filter((s) => s.eventType === 'resubmitted').length;

  return {
    reportId: report.id,
    source,
    firstSubmittedAt: firstSubmitted?.at ?? report.submittedAt ?? null,
    finalizedAt: finalized?.at ?? null,
    totalDurationMs,
    correctionCycles,
    currentStatus: report.status,
    reportSteps,
    items: buildItemTimelines(steps, responses),
  };
}

export function compactTimelineSummary(timeline: ReportTimelineData): string {
  const start = timeline.firstSubmittedAt
    ? formatIsoToLocalTime(timeline.firstSubmittedAt)
    : '—';
  const end = timeline.finalizedAt
    ? formatIsoToLocalTime(timeline.finalizedAt)
    : '…';
  const duration = formatDurationMs(timeline.totalDurationMs);
  return `${start} → ${end} (${duration})`;
}
