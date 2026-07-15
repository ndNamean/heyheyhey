/**
 * Pure scheduled-task analytics for the dashboard.
 * Depends on templateSchedule helpers; no React.
 */

import type {
  Report,
  ReportResponse,
  ReviewEvent,
  Store,
  Template,
  TemplateItem,
  TemplateScheduleVersion,
} from '../types';
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  WEEKDAY_LABELS,
  buildScheduleOccurrenceKey,
  getScheduledDueAt,
  isScheduledDateForSchedule,
  parseTemplateSchedule,
  resolveActiveScheduleVersion,
  type ScheduleRecurrence,
  type ScheduleVersionRow,
  type TemplateSchedule,
} from './templateSchedule';

export type ExpectedOccurrence = {
  occurrenceKey: string;
  templateId: string;
  templateName: string;
  templateItemId: string;
  itemTitle: string;
  section: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  recurrence: ScheduleRecurrence;
  frequencyLabel: string;
  dueTimeHhmm: string;
  scheduledDueAt: string;
  dateYmd: string;
  scheduleVersionId: string;
};

export type ScheduledTaskMetricRow = {
  key: string;
  templateId: string;
  templateName: string;
  templateItemId: string;
  itemTitle: string;
  section: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  frequency: ScheduleRecurrence;
  frequencyLabel: string;
  completionDeadline: string;
  scheduleSummary: string;
  expected: number;
  expectedFullPeriod: number;
  completed: number;
  completionPercentage: number | null;
  onTime: number;
  onTimePercentage: number | null;
  averageCompletionTime: string | null;
  averageTimingOffsetMs: number | null;
  late: number;
  averageLateDurationMs: number | null;
  overdueIncomplete: number;
};

export type ScheduledTaskMetricsResult = {
  rows: ScheduledTaskMetricRow[];
  templateIds: string[];
};

function ymdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function eachYmdInclusive(from: string, to: string): string[] {
  const start = from.slice(0, 10);
  const end = to.slice(0, 10);
  if (start > end) return [];
  const out: string[] = [];
  let cur = start;
  // Safety cap ~5 years
  for (let i = 0; i < 2000 && cur <= end; i++) {
    out.push(cur);
    cur = ymdAddDays(cur, 1);
  }
  return out;
}

function versionsForTemplate(template: Template): ScheduleVersionRow[] {
  const linked = (template.scheduleVersions ?? []) as TemplateScheduleVersion[];
  if (linked.length) {
    return linked.map((v) => ({
      id: v.id,
      scheduleJson: v.scheduleJson,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
    }));
  }

  // Seed a synthetic version from current scheduleJson when history is absent.
  const current = parseTemplateSchedule(template.scheduleJson);
  if (!current.enabled) return [];
  return [
    {
      id: '',
      scheduleJson: template.scheduleJson || JSON.stringify(current),
      effectiveFrom: current.effectiveFrom || '1970-01-01T00:00:00+07:00',
      effectiveTo: '',
    },
  ];
}

function frequencyLabel(recurrence: ScheduleRecurrence, schedule: TemplateSchedule): string {
  if (recurrence === 'daily') {
    const days = schedule.daily?.daysOfWeek ?? [];
    if (days.length === 7) return 'Daily';
    return `Daily (${days.map((d) => WEEKDAY_LABELS[d]?.short ?? d).join(',')})`;
  }
  if (recurrence === 'weekly') {
    const day = schedule.weekly?.dayOfWeek ?? 1;
    return `Weekly · ${WEEKDAY_LABELS[day]?.en ?? day}`;
  }
  const monthDay = schedule.monthly?.dayOfMonth ?? 1;
  return monthDay === 'last' ? 'Monthly · Last day' : `Monthly · Day ${monthDay}`;
}

export function getScheduledOccurrences(opts: {
  templates: Template[];
  from: string;
  to: string;
  storeIds?: string[] | null;
}): ExpectedOccurrence[] {
  const { templates, from, to, storeIds } = opts;
  const storeFilter = storeIds?.length ? new Set(storeIds) : null;
  const days = eachYmdInclusive(from, to);
  const out: ExpectedOccurrence[] = [];

  for (const template of templates) {
    const versions = versionsForTemplate(template);
    if (!versions.length) continue;

    const stores = ((template.stores ?? []) as Store[]).filter((s) =>
      storeFilter ? storeFilter.has(s.id) : true,
    );
    if (!stores.length) continue;

    const items = [...((template.items ?? []) as TemplateItem[])].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
    if (!items.length) continue;

    for (const day of days) {
      const resolved = resolveActiveScheduleVersion(versions, day);
      if (!resolved) continue;
      const { schedule, id: scheduleVersionId } = resolved;
      if (!schedule.enabled || !schedule.recurrence) continue;
      if (!isScheduledDateForSchedule(schedule, day)) continue;

      for (const store of stores) {
        for (const item of items) {
          const dueTime = schedule.itemDueTimes?.[item.id]?.trim();
          if (!dueTime) continue;

          let scheduledDueAt: string;
          try {
            scheduledDueAt = getScheduledDueAt({
              dateYmd: day,
              dueTimeHhmm: dueTime,
              timezone: schedule.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
            });
          } catch {
            continue;
          }

          out.push({
            occurrenceKey: buildScheduleOccurrenceKey({
              templateId: template.id,
              itemId: item.id,
              storeId: store.id,
              recurrence: schedule.recurrence,
              dateYmd: day,
            }),
            templateId: template.id,
            templateName: template.name,
            templateItemId: item.id,
            itemTitle: item.title,
            section: item.section,
            storeId: store.id,
            storeCode: store.code,
            storeName: store.name,
            recurrence: schedule.recurrence,
            frequencyLabel: frequencyLabel(schedule.recurrence, schedule),
            dueTimeHhmm: dueTime,
            scheduledDueAt,
            dateYmd: day,
            scheduleVersionId,
          });
        }
      }
    }
  }

  return out;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * First staff completion time for schedule metrics.
 * Prefer earliest reviewEvents `submitted`, then firstCompletedAt, then submittedAt.
 * Approval time is never used.
 */
export function resolveFirstCompletedAt(
  resp: ReportResponse,
  events: ReviewEvent[],
): string | null {
  const submitted = events
    .filter((e) => e.reportResponseId === resp.id && e.eventType === 'submitted')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (submitted[0]?.createdAt) return submitted[0].createdAt;
  if (resp.firstCompletedAt?.trim()) return resp.firstCompletedAt.trim();
  if (resp.submittedAt?.trim()) return resp.submittedAt.trim();
  return null;
}

/** Minutes after local midnight in Asia/Ho_Chi_Minh (+07). */
export function minutesAfterMidnightVn(iso: string): number | null {
  const ms = parseMs(iso);
  if (ms == null) return null;
  // Shift to VN wall clock: UTC+7
  const vn = new Date(ms + 7 * 60 * 60 * 1000);
  return vn.getUTCHours() * 60 + vn.getUTCMinutes() + vn.getUTCSeconds() / 60;
}

export function formatAverageCompletionTime(isos: string[]): string | null {
  const minutes = isos
    .map(minutesAfterMidnightVn)
    .filter((m): m is number => m != null);
  if (!minutes.length) return null;
  const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const totalMins = Math.round(avg);
  const hh = Math.floor(totalMins / 60) % 24;
  const mm = totalMins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatLateDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hr`);
  if (mins || !parts.length) parts.push(`${mins} min`);
  return parts.join(' ');
}

export function formatTimingOffset(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const abs = Math.abs(ms);
  const label = formatLateDuration(abs);
  if (ms === 0) return 'Exactly on deadline';
  if (ms < 0) return `Average: ${label} before deadline`;
  return `Average: ${label} after deadline`;
}

type CompletionHit = {
  occurrenceKey: string;
  firstCompletedAt: string;
  scheduledDueAt: string;
};

function collectCompletions(
  reports: Report[],
  events: ReviewEvent[],
): Map<string, CompletionHit> {
  const byKey = new Map<string, CompletionHit>();
  const eventsByResponse = new Map<string, ReviewEvent[]>();
  for (const ev of events) {
    if (!ev.reportResponseId) continue;
    const list = eventsByResponse.get(ev.reportResponseId) ?? [];
    list.push(ev);
    eventsByResponse.set(ev.reportResponseId, list);
  }

  for (const report of reports) {
    for (const resp of (report.responses ?? []) as ReportResponse[]) {
      const key = resp.scheduleOccurrenceKey?.trim();
      if (!key) continue;
      // Any submitted/waiting/approved/rejected/need_correction with a key counts as completed for schedule.
      // not_started without completion fields should not count.
      const completedAt = resolveFirstCompletedAt(
        resp,
        eventsByResponse.get(resp.id) ?? [],
      );
      if (!completedAt) continue;

      const scheduledDueAt = resp.scheduledDueAt?.trim() || '';
      const existing = byKey.get(key);
      if (!existing || completedAt < existing.firstCompletedAt) {
        byKey.set(key, {
          occurrenceKey: key,
          firstCompletedAt: completedAt,
          scheduledDueAt: scheduledDueAt || existing?.scheduledDueAt || '',
        });
      }
    }
  }

  return byKey;
}

export function calculateScheduledTaskMetrics(opts: {
  expected: ExpectedOccurrence[];
  reports: Report[];
  events: ReviewEvent[];
  now?: string | Date;
}): ScheduledTaskMetricsResult {
  const nowMs = parseMs(
    opts.now instanceof Date
      ? opts.now.toISOString()
      : opts.now ?? new Date().toISOString(),
  ) ?? Date.now();

  const completions = collectCompletions(opts.reports, opts.events);

  type Group = {
    meta: ExpectedOccurrence;
    expected: ExpectedOccurrence[];
    scheduleSummary: string;
  };

  const groups = new Map<string, Group>();
  for (const occ of opts.expected) {
    const key = `${occ.templateId}|${occ.templateItemId}|${occ.storeId}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        meta: occ,
        expected: [occ],
        scheduleSummary: '',
      });
    } else {
      g.expected.push(occ);
    }
  }

  const rows: ScheduledTaskMetricRow[] = [];

  for (const [key, group] of groups) {
    const { meta, expected } = group;
    const dueToDate = expected.filter((e) => {
      const due = parseMs(e.scheduledDueAt);
      return due != null && due <= nowMs;
    });

    const expectedCount = dueToDate.length;
    const expectedFull = expected.length;

    let completed = 0;
    let onTime = 0;
    let late = 0;
    let lateDurationSum = 0;
    let timingOffsetSum = 0;
    let timingOffsetCount = 0;
    const completionTimes: string[] = [];
    let overdueIncomplete = 0;

    const dueByKey = new Map(dueToDate.map((e) => [e.occurrenceKey, e]));
    const fullByKey = new Map(expected.map((e) => [e.occurrenceKey, e]));

    for (const occ of dueToDate) {
      const hit = completions.get(occ.occurrenceKey);
      if (!hit) {
        overdueIncomplete++;
        continue;
      }
      completed++;
      completionTimes.push(hit.firstCompletedAt);
      const dueMs = parseMs(hit.scheduledDueAt || occ.scheduledDueAt);
      const doneMs = parseMs(hit.firstCompletedAt);
      if (dueMs != null && doneMs != null) {
        const offset = doneMs - dueMs;
        timingOffsetSum += offset;
        timingOffsetCount++;
        if (offset <= 0) {
          onTime++;
        } else {
          late++;
          lateDurationSum += offset;
        }
      } else {
        onTime++;
      }
    }

    // Completions outside due-to-date window but still in full period (future due) —
    // do not inflate completed past expected due-to-date denominator.
    // Spec: completed / expected due-to-date; also don't count future as overdue.
    void fullByKey;
    void dueByKey;

    const completionPercentage =
      expectedCount > 0 ? Math.min(100, (completed / expectedCount) * 100) : null;
    const onTimePercentage =
      completed > 0 ? (onTime / completed) * 100 : null;

    rows.push({
      key,
      templateId: meta.templateId,
      templateName: meta.templateName,
      templateItemId: meta.templateItemId,
      itemTitle: meta.itemTitle,
      section: meta.section,
      storeId: meta.storeId,
      storeCode: meta.storeCode,
      storeName: meta.storeName,
      frequency: meta.recurrence,
      frequencyLabel: meta.frequencyLabel,
      completionDeadline: meta.dueTimeHhmm,
      scheduleSummary: meta.frequencyLabel,
      expected: expectedCount,
      expectedFullPeriod: expectedFull,
      completed,
      completionPercentage,
      onTime,
      onTimePercentage,
      averageCompletionTime: formatAverageCompletionTime(completionTimes),
      averageTimingOffsetMs:
        timingOffsetCount > 0 ? timingOffsetSum / timingOffsetCount : null,
      late,
      averageLateDurationMs: late > 0 ? lateDurationSum / late : null,
      overdueIncomplete,
    });
  }

  rows.sort((a, b) => {
    const t = a.templateName.localeCompare(b.templateName);
    if (t) return t;
    const s = a.storeCode.localeCompare(b.storeCode);
    if (s) return s;
    return a.itemTitle.localeCompare(b.itemTitle);
  });

  const templateIds = [...new Set(rows.map((r) => r.templateId))];

  return { rows, templateIds };
}

export function percentLabel(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}
