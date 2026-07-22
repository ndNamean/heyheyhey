/**
 * Logbook issue metrics for the dashboard (issues only).
 */

import {
  isIssueOverdue,
  isLogbookIssue,
  resolveLogbookIssueStatus,
} from './logbook';
import type { LogbookEntry } from '../types';

function parseMs(iso?: string): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type LogbookIssueCounts = {
  open: number;
  inProgress: number;
  waitingApproval: number;
  overdue: number;
  resolved: number;
  total: number;
};

export type LogbookIssueMetrics = {
  counts: LogbookIssueCounts;
  resolutionRate: number | null;
  onTimeResolutionRate: number | null;
  avgResolutionDurationMs: number | null;
  avgWorkDurationMs: number | null;
  avgApprovalDurationMs: number | null;
  avgOverdueDurationMs: number | null;
  unresolvedOverdue: number;
};

export function filterLogbookIssues(
  entries: LogbookEntry[],
  opts: {
    storeId?: string;
    fromYmd?: string;
    toYmd?: string;
    includeRecalled?: boolean;
  } = {},
): LogbookEntry[] {
  return entries.filter((e) => {
    if (!isLogbookIssue(e)) return false;
    if (!opts.includeRecalled && resolveLogbookIssueStatus(e) === 'recalled') return false;
    if (opts.storeId && opts.storeId !== 'all' && e.storeId !== opts.storeId) return false;
    if (opts.fromYmd && e.date < opts.fromYmd) return false;
    if (opts.toYmd && e.date > opts.toYmd) return false;
    return true;
  });
}

export function countLogbookIssues(
  issues: LogbookEntry[],
  now: number = Date.now(),
): LogbookIssueCounts {
  let open = 0;
  let inProgress = 0;
  let waitingApproval = 0;
  let overdue = 0;
  let resolved = 0;
  let activeTotal = 0;
  for (const e of issues) {
    const status = resolveLogbookIssueStatus(e);
    if (status === 'recalled') continue;
    activeTotal += 1;
    if (status === 'open') open += 1;
    else if (status === 'in_progress') inProgress += 1;
    else if (status === 'waiting_approval') waitingApproval += 1;
    else if (status === 'resolved') resolved += 1;
    if (isIssueOverdue(e, now)) overdue += 1;
  }
  return {
    open,
    inProgress,
    waitingApproval,
    overdue,
    resolved,
    total: activeTotal,
  };
}

export function computeLogbookIssueMetrics(
  issues: LogbookEntry[],
  now: number = Date.now(),
): LogbookIssueMetrics {
  const counts = countLogbookIssues(issues, now);
  const dueToDate = issues.filter((e) => {
    const dueMs = parseMs(e.dueAt);
    return dueMs != null && dueMs <= now;
  });
  const resolved = issues.filter((e) => resolveLogbookIssueStatus(e) === 'resolved');
  const resolvedOnTime = resolved.filter((e) => {
    const resolvedMs = parseMs(e.resolvedAt);
    const dueMs = parseMs(e.dueAt);
    if (resolvedMs == null || dueMs == null) return false;
    return resolvedMs <= dueMs;
  });

  const resolutionDurations: number[] = [];
  const workDurations: number[] = [];
  const approvalDurations: number[] = [];
  const overdueDurations: number[] = [];

  for (const e of resolved) {
    const created = parseMs(e.createdAt);
    const resolvedAt = parseMs(e.resolvedAt);
    if (created != null && resolvedAt != null) resolutionDurations.push(resolvedAt - created);

    const started = parseMs(e.startedAt);
    const submitted = parseMs(e.resolutionSubmittedAt);
    if (started != null && submitted != null) workDurations.push(submitted - started);

    const reviewed = parseMs(e.reviewedAt);
    if (submitted != null && reviewed != null) approvalDurations.push(reviewed - submitted);

    const dueMs = parseMs(e.dueAt);
    if (resolvedAt != null && dueMs != null && resolvedAt > dueMs) {
      overdueDurations.push(resolvedAt - dueMs);
    }
  }

  const unresolvedOverdue = issues.filter((e) => isIssueOverdue(e, now)).length;

  return {
    counts,
    resolutionRate:
      dueToDate.length > 0
        ? Math.round(
            (dueToDate.filter((e) => resolveLogbookIssueStatus(e) === 'resolved').length /
              dueToDate.length) *
              100,
          )
        : null,
    onTimeResolutionRate:
      resolved.length > 0
        ? Math.round((resolvedOnTime.length / resolved.length) * 100)
        : null,
    avgResolutionDurationMs: average(resolutionDurations),
    avgWorkDurationMs: average(workDurations),
    avgApprovalDurationMs: average(approvalDurations),
    avgOverdueDurationMs: average(overdueDurations),
    unresolvedOverdue,
  };
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 48) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

export function overdueDurationMs(
  entry: LogbookEntry,
  now: number = Date.now(),
): number | null {
  if (!isIssueOverdue(entry, now)) return null;
  const dueMs = parseMs(entry.dueAt);
  if (dueMs == null) return null;
  const end =
    resolveLogbookIssueStatus(entry) === 'resolved' ? parseMs(entry.resolvedAt) ?? now : now;
  return end - dueMs;
}
