/**
 * Template schedule helpers.
 *
 * Weekday convention (JavaScript Date.getDay()):
 *   0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday,
 *   4 = Thursday, 5 = Friday, 6 = Saturday.
 *
 * Default timezone: Asia/Ho_Chi_Minh.
 */

export const DEFAULT_SCHEDULE_TIMEZONE = 'Asia/Ho_Chi_Minh';

export type ScheduleRecurrence = 'daily' | 'weekly' | 'monthly';

export type TemplateSchedule = {
  version: 2;
  enabled: boolean;
  recurrence?: ScheduleRecurrence;
  timezone?: string;
  daily?: {
    daysOfWeek: number[];
  };
  weekly?: {
    dayOfWeek: number;
  };
  monthly?: {
    dayOfMonth: number | 'last';
  };
  itemDueTimes?: Record<string, string>;
  effectiveFrom?: string;
};

export const DISABLED_SCHEDULE: TemplateSchedule = {
  version: 2,
  enabled: false,
};

export const ALL_DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const WEEKENDS = [6, 0] as const;

export const WEEKDAY_LABELS: Record<number, { en: string; short: string }> = {
  1: { en: 'Monday', short: 'Mon' },
  2: { en: 'Tuesday', short: 'Tue' },
  3: { en: 'Wednesday', short: 'Wed' },
  4: { en: 'Thursday', short: 'Thu' },
  5: { en: 'Friday', short: 'Fri' },
  6: { en: 'Saturday', short: 'Sat' },
  0: { en: 'Sunday', short: 'Sun' },
};

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDueTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

export function isValidWeekday(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6;
}

export function isValidMonthDay(value: unknown): value is number | 'last' {
  if (value === 'last') return true;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 28;
}

function normalizeDaysOfWeek(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...ALL_DAYS_OF_WEEK];
  const days = raw.filter(isValidWeekday);
  const unique = [...new Set(days)];
  return unique.length ? unique : [...ALL_DAYS_OF_WEEK];
}

function normalizeItemDueTimes(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && isValidDueTime(value)) {
      out[key] = value.trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function migrateLegacySchedule(parsed: Record<string, unknown>): TemplateSchedule {
  const enabled = parsed.enabled === true;
  if (!enabled) return { ...DISABLED_SCHEDULE };

  const recurrenceRaw =
    typeof parsed.recurrence === 'string' ? parsed.recurrence.trim().toLowerCase() : '';
  let recurrence: ScheduleRecurrence | undefined;
  if (recurrenceRaw === 'daily' || recurrenceRaw === 'weekly' || recurrenceRaw === 'monthly') {
    recurrence = recurrenceRaw;
  }

  const schedule: TemplateSchedule = {
    version: 2,
    enabled: true,
    timezone: DEFAULT_SCHEDULE_TIMEZONE,
  };

  if (recurrence) schedule.recurrence = recurrence;

  if (recurrence === 'daily') {
    const fromDays = Array.isArray(parsed.days)
      ? parsed.days
          .map((d) => {
            if (typeof d === 'number' && isValidWeekday(d)) return d;
            if (typeof d === 'string') {
              const n = Number(d.trim());
              if (isValidWeekday(n)) return n;
              const lower = d.trim().toLowerCase().slice(0, 3);
              const entry = Object.entries(WEEKDAY_LABELS).find(
                ([, v]) => v.en.toLowerCase().startsWith(lower) || v.short.toLowerCase() === lower,
              );
              return entry ? Number(entry[0]) : null;
            }
            return null;
          })
          .filter((d): d is number => d !== null)
      : [];
    schedule.daily = { daysOfWeek: fromDays.length ? [...new Set(fromDays)] : [...ALL_DAYS_OF_WEEK] };
  } else if (recurrence === 'weekly') {
    let dayOfWeek = 1;
    if (Array.isArray(parsed.days) && parsed.days.length) {
      const first = parsed.days[0];
      if (typeof first === 'number' && isValidWeekday(first)) dayOfWeek = first;
      else if (typeof first === 'string') {
        const n = Number(first.trim());
        if (isValidWeekday(n)) dayOfWeek = n;
      }
    }
    schedule.weekly = { dayOfWeek };
  } else if (recurrence === 'monthly') {
    schedule.monthly = { dayOfMonth: 1 };
  }

  const dueTime = typeof parsed.dueTime === 'string' && isValidDueTime(parsed.dueTime)
    ? parsed.dueTime.trim()
    : undefined;
  if (dueTime) {
    schedule.itemDueTimes = {};
  }

  return schedule;
}

/**
 * Safe parser for templates.scheduleJson.
 * Falls back to `{ version: 2, enabled: false }` for blank/invalid data.
 */
export function parseTemplateSchedule(scheduleJson: string | null | undefined): TemplateSchedule {
  if (!scheduleJson?.trim()) return { ...DISABLED_SCHEDULE };

  try {
    const parsed = JSON.parse(scheduleJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('[templateSchedule] malformed scheduleJson (not an object)', scheduleJson);
      return { ...DISABLED_SCHEDULE };
    }

    if (parsed.version === 2 || parsed.version === '2') {
      const enabled = parsed.enabled === true;
      if (!enabled) return { ...DISABLED_SCHEDULE };

      const recurrenceRaw =
        typeof parsed.recurrence === 'string' ? parsed.recurrence.trim().toLowerCase() : '';
      const recurrence: ScheduleRecurrence | undefined =
        recurrenceRaw === 'daily' || recurrenceRaw === 'weekly' || recurrenceRaw === 'monthly'
          ? recurrenceRaw
          : undefined;

      const schedule: TemplateSchedule = {
        version: 2,
        enabled: true,
        timezone:
          typeof parsed.timezone === 'string' && parsed.timezone.trim()
            ? parsed.timezone.trim()
            : DEFAULT_SCHEDULE_TIMEZONE,
      };

      if (recurrence) schedule.recurrence = recurrence;

      if (recurrence === 'daily') {
        const days =
          parsed.daily && typeof parsed.daily === 'object' && !Array.isArray(parsed.daily)
            ? (parsed.daily as { daysOfWeek?: unknown }).daysOfWeek
            : undefined;
        schedule.daily = { daysOfWeek: normalizeDaysOfWeek(days) };
      } else if (recurrence === 'weekly') {
        const dayRaw =
          parsed.weekly && typeof parsed.weekly === 'object' && !Array.isArray(parsed.weekly)
            ? (parsed.weekly as { dayOfWeek?: unknown }).dayOfWeek
            : undefined;
        schedule.weekly = {
          dayOfWeek: isValidWeekday(dayRaw) ? dayRaw : 1,
        };
      } else if (recurrence === 'monthly') {
        const dayRaw =
          parsed.monthly && typeof parsed.monthly === 'object' && !Array.isArray(parsed.monthly)
            ? (parsed.monthly as { dayOfMonth?: unknown }).dayOfMonth
            : undefined;
        schedule.monthly = {
          dayOfMonth: isValidMonthDay(dayRaw) ? dayRaw : 1,
        };
      }

      const itemDueTimes = normalizeItemDueTimes(parsed.itemDueTimes);
      if (itemDueTimes) schedule.itemDueTimes = itemDueTimes;

      if (typeof parsed.effectiveFrom === 'string' && parsed.effectiveFrom.trim()) {
        schedule.effectiveFrom = parsed.effectiveFrom.trim();
      }

      return schedule;
    }

    // Legacy shape without version
    return migrateLegacySchedule(parsed);
  } catch {
    console.warn('[templateSchedule] malformed scheduleJson (invalid JSON)', scheduleJson);
    return { ...DISABLED_SCHEDULE };
  }
}

export function serializeTemplateSchedule(schedule: TemplateSchedule): string {
  if (!schedule.enabled) {
    return JSON.stringify({ version: 2, enabled: false });
  }

  const out: TemplateSchedule = {
    version: 2,
    enabled: true,
    timezone: schedule.timezone ?? DEFAULT_SCHEDULE_TIMEZONE,
  };

  if (schedule.recurrence) out.recurrence = schedule.recurrence;
  if (schedule.recurrence === 'daily' && schedule.daily) {
    out.daily = { daysOfWeek: [...schedule.daily.daysOfWeek] };
  }
  if (schedule.recurrence === 'weekly' && schedule.weekly) {
    out.weekly = { dayOfWeek: schedule.weekly.dayOfWeek };
  }
  if (schedule.recurrence === 'monthly' && schedule.monthly) {
    out.monthly = { dayOfMonth: schedule.monthly.dayOfMonth };
  }
  if (schedule.itemDueTimes && Object.keys(schedule.itemDueTimes).length) {
    out.itemDueTimes = { ...schedule.itemDueTimes };
  }
  if (schedule.effectiveFrom) out.effectiveFrom = schedule.effectiveFrom;

  return JSON.stringify(out);
}

/** Compare two schedules for versioning (ignores object key order). */
export function schedulesEqual(a: TemplateSchedule, b: TemplateSchedule): boolean {
  return serializeTemplateSchedule(a) === serializeTemplateSchedule(b);
}

export function formatWeekdayList(days: number[]): string {
  const ordered = ALL_DAYS_OF_WEEK.filter((d) => days.includes(d));
  if (ordered.length === 7) return 'Monday–Sunday';
  if (
    ordered.length === 5 &&
    WEEKDAYS.every((d) => ordered.includes(d))
  ) {
    return 'Monday–Friday';
  }
  if (ordered.length === 2 && ordered.includes(6) && ordered.includes(0)) {
    return 'Saturday–Sunday';
  }
  return ordered.map((d) => WEEKDAY_LABELS[d].en).join(', ');
}

export function summarizeSchedule(schedule: TemplateSchedule): string {
  if (!schedule.enabled || !schedule.recurrence) return 'Schedule disabled';

  const deadlinesVary =
    schedule.itemDueTimes && Object.keys(schedule.itemDueTimes).length > 0
      ? 'Item deadlines vary'
      : 'No item deadlines';

  if (schedule.recurrence === 'daily') {
    const days = schedule.daily?.daysOfWeek ?? [...ALL_DAYS_OF_WEEK];
    return `Daily · ${formatWeekdayList(days)} · ${deadlinesVary}`;
  }
  if (schedule.recurrence === 'weekly') {
    const day = schedule.weekly?.dayOfWeek ?? 1;
    return `Weekly · Every ${WEEKDAY_LABELS[day].en} · ${deadlinesVary}`;
  }
  const monthDay = schedule.monthly?.dayOfMonth ?? 1;
  const dayLabel = monthDay === 'last' ? 'Last day' : `Day ${monthDay}`;
  return `Monthly · ${dayLabel} · ${deadlinesVary}`;
}

export type ScheduleValidationIssue = {
  field: string;
  message: string;
};

export function validateTemplateSchedule(
  schedule: TemplateSchedule,
  items: { id: string; required: boolean }[],
): ScheduleValidationIssue[] {
  const issues: ScheduleValidationIssue[] = [];
  if (!schedule.enabled) return issues;

  if (!schedule.recurrence) {
    issues.push({ field: 'recurrence', message: 'Recurrence type is required.' });
  }

  if (schedule.recurrence === 'daily') {
    const days = schedule.daily?.daysOfWeek ?? [];
    if (!days.length) {
      issues.push({ field: 'daily', message: 'Select at least one weekday.' });
    }
  }

  if (schedule.recurrence === 'weekly') {
    if (!isValidWeekday(schedule.weekly?.dayOfWeek)) {
      issues.push({ field: 'weekly', message: 'Select a weekday.' });
    }
  }

  if (schedule.recurrence === 'monthly') {
    if (!isValidMonthDay(schedule.monthly?.dayOfMonth)) {
      issues.push({ field: 'monthly', message: 'Select a valid day of month (1–28 or last).' });
    }
  }

  if (!schedule.effectiveFrom?.trim()) {
    issues.push({ field: 'effectiveFrom', message: 'Effective date is required.' });
  } else {
    const ymd = schedule.effectiveFrom.slice(0, 10);
    if (!YMD_RE.test(ymd)) {
      issues.push({ field: 'effectiveFrom', message: 'Effective date must be a valid date.' });
    }
  }

  if (!schedule.timezone?.trim()) {
    issues.push({ field: 'timezone', message: 'Timezone is required.' });
  }

  for (const item of items) {
    if (!item.required) continue;
    const time = schedule.itemDueTimes?.[item.id]?.trim() ?? '';
    if (!time) {
      issues.push({
        field: `itemDueTime:${item.id}`,
        message: 'Completion time is required.',
      });
    } else if (!isValidDueTime(time)) {
      issues.push({
        field: `itemDueTime:${item.id}`,
        message: 'Completion time must use HH:mm format.',
      });
    }
  }

  return issues;
}

/** Build ISO effectiveFrom from a YYYY-MM-DD date in Asia/Ho_Chi_Minh (+07:00). */
export function effectiveFromIso(ymd: string): string {
  const day = ymd.slice(0, 10);
  return `${day}T00:00:00+07:00`;
}

export function effectiveFromYmd(isoOrYmd: string | undefined): string {
  if (!isoOrYmd?.trim()) return '';
  return isoOrYmd.trim().slice(0, 10);
}

export function parseYmdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** Weekday of a calendar YMD using UTC noon so local TZ does not shift the day. */
export function weekdayOfYmd(ymd: string): number {
  const { y, m, d } = parseYmdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

export function lastDayOfMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

/** ISO week token like `2026-W29` for weekly occurrence keys. */
export function isoWeekPeriodToken(ymd: string): string {
  const { y, m, d } = parseYmdParts(ymd);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

export function buildScheduleOccurrenceKey(opts: {
  templateId: string;
  itemId: string;
  storeId: string;
  recurrence: ScheduleRecurrence;
  dateYmd: string;
}): string {
  const day = opts.dateYmd.slice(0, 10);
  let period: string;
  if (opts.recurrence === 'daily') {
    period = day;
  } else if (opts.recurrence === 'weekly') {
    period = isoWeekPeriodToken(day);
  } else {
    period = day.slice(0, 7);
  }
  return `${opts.templateId}:${opts.itemId}:${opts.storeId}:${period}`;
}

/**
 * Scheduled due timestamp for an item on a calendar date.
 * Asia/Ho_Chi_Minh is fixed UTC+7 (no DST).
 */
export function getScheduledDueAt(opts: {
  dateYmd: string;
  dueTimeHhmm: string;
  timezone?: string;
}): string {
  const day = opts.dateYmd.slice(0, 10);
  const time = opts.dueTimeHhmm.trim();
  if (!isValidDueTime(time)) {
    throw new Error(`Invalid due time: ${opts.dueTimeHhmm}`);
  }
  const [hh, mm] = time.split(':');
  const offset =
    !opts.timezone || opts.timezone === DEFAULT_SCHEDULE_TIMEZONE ? '+07:00' : '+07:00';
  return `${day}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00${offset}`;
}

/** Whether `dateYmd` is an expected occurrence date for the given schedule. */
export function isScheduledDateForSchedule(
  schedule: TemplateSchedule,
  dateYmd: string,
): boolean {
  if (!schedule.enabled || !schedule.recurrence) return false;

  const day = dateYmd.slice(0, 10);
  if (schedule.effectiveFrom) {
    const from = schedule.effectiveFrom.slice(0, 10);
    if (day < from) return false;
  }

  const dow = weekdayOfYmd(day);

  if (schedule.recurrence === 'daily') {
    return (schedule.daily?.daysOfWeek ?? []).includes(dow);
  }

  if (schedule.recurrence === 'weekly') {
    return schedule.weekly?.dayOfWeek === dow;
  }

  const { y, m, d } = parseYmdParts(day);
  const target = schedule.monthly?.dayOfMonth ?? 1;
  if (target === 'last') return d === lastDayOfMonth(y, m);
  return d === target;
}

export type ScheduleVersionRow = {
  id: string;
  scheduleJson: string;
  effectiveFrom: string;
  effectiveTo: string;
};

/**
 * Resolve the schedule version active on `dateYmd`.
 * `effectiveTo` is treated as exclusive (version applies while date < effectiveTo).
 */
export function resolveActiveScheduleVersion(
  versions: ScheduleVersionRow[],
  dateYmd: string,
): { id: string; schedule: TemplateSchedule } | null {
  const day = dateYmd.slice(0, 10);
  const candidates = versions
    .filter((v) => {
      const from = (v.effectiveFrom || '').slice(0, 10);
      const to = (v.effectiveTo || '').trim().slice(0, 10);
      if (from && day < from) return false;
      if (to && day >= to) return false;
      return true;
    })
    .sort((a, b) => (b.effectiveFrom || '').localeCompare(a.effectiveFrom || ''));

  for (const v of candidates) {
    const schedule = parseTemplateSchedule(v.scheduleJson);
    if (schedule.enabled) return { id: v.id, schedule };
  }
  return null;
}

export type ScheduleCaptureFields = {
  scheduleOccurrenceKey: string;
  scheduledDueAt: string;
  firstCompletedAt: string;
  scheduleVersionId: string;
};

/**
 * Build additive schedule capture fields for a completed checklist item.
 * Returns null when scheduling does not apply (disabled, wrong day, missing time, etc.).
 */
export function buildScheduleCaptureForItem(opts: {
  templateId: string;
  itemId: string;
  storeId: string;
  reportDateYmd: string;
  completedAtIso: string;
  schedule: TemplateSchedule;
  scheduleVersionId: string;
}): ScheduleCaptureFields | null {
  const { schedule } = opts;
  if (!schedule.enabled || !schedule.recurrence) return null;
  if (!isScheduledDateForSchedule(schedule, opts.reportDateYmd)) return null;

  const dueTime = schedule.itemDueTimes?.[opts.itemId]?.trim();
  if (!dueTime || !isValidDueTime(dueTime)) return null;

  return {
    scheduleOccurrenceKey: buildScheduleOccurrenceKey({
      templateId: opts.templateId,
      itemId: opts.itemId,
      storeId: opts.storeId,
      recurrence: schedule.recurrence,
      dateYmd: opts.reportDateYmd,
    }),
    scheduledDueAt: getScheduledDueAt({
      dateYmd: opts.reportDateYmd,
      dueTimeHhmm: dueTime,
      timezone: schedule.timezone,
    }),
    firstCompletedAt: opts.completedAtIso,
    scheduleVersionId: opts.scheduleVersionId,
  };
}

export function findDuplicateOccurrenceKeys(
  existingKeys: Iterable<string>,
  candidateKeys: string[],
): string[] {
  const set = new Set(
    [...existingKeys].map((k) => k.trim()).filter(Boolean),
  );
  return [...new Set(candidateKeys.filter((k) => k && set.has(k)))];
}

// ─── Spreadsheet (Excel) helpers — preserved for import/export ───────────────

export interface SpreadsheetScheduleFields {
  scheduleEnabled: boolean;
  scheduleType: string;
  scheduleTime: string;
  scheduleDays: string;
  scheduleAssignedRole: string;
}

export function spreadsheetScheduleFromJson(scheduleJson: string): SpreadsheetScheduleFields {
  const defaults: SpreadsheetScheduleFields = {
    scheduleEnabled: false,
    scheduleType: '',
    scheduleTime: '',
    scheduleDays: '',
    scheduleAssignedRole: '',
  };

  if (!scheduleJson?.trim()) return defaults;

  try {
    const parsed = JSON.parse(scheduleJson) as Record<string, unknown>;
    const schedule = parseTemplateSchedule(scheduleJson);

    let scheduleDays = '';
    if (schedule.recurrence === 'daily' && schedule.daily) {
      scheduleDays = schedule.daily.daysOfWeek
        .map((d) => WEEKDAY_LABELS[d]?.short ?? String(d))
        .join(',');
    } else if (schedule.recurrence === 'weekly' && schedule.weekly) {
      scheduleDays = WEEKDAY_LABELS[schedule.weekly.dayOfWeek]?.short ?? '';
    } else if (schedule.recurrence === 'monthly' && schedule.monthly) {
      scheduleDays =
        schedule.monthly.dayOfMonth === 'last' ? 'Last' : String(schedule.monthly.dayOfMonth);
    } else if (Array.isArray(parsed.days)) {
      scheduleDays = parsed.days.filter((d): d is string => typeof d === 'string').join(',');
    } else if (typeof parsed.days === 'string') {
      scheduleDays = parsed.days;
    }

    const times = schedule.itemDueTimes ? Object.values(schedule.itemDueTimes) : [];
    const scheduleTime =
      times.length === 1
        ? times[0]
        : typeof parsed.dueTime === 'string'
          ? parsed.dueTime
          : '';

    return {
      scheduleEnabled: schedule.enabled,
      scheduleType: schedule.recurrence
        ? schedule.recurrence.charAt(0).toUpperCase() + schedule.recurrence.slice(1)
        : typeof parsed.recurrence === 'string'
          ? parsed.recurrence
          : '',
      scheduleTime,
      scheduleDays,
      scheduleAssignedRole:
        typeof parsed.assignedRole === 'string' ? parsed.assignedRole : '',
    };
  } catch {
    return defaults;
  }
}

export function scheduleJsonFromSpreadsheet(fields: SpreadsheetScheduleFields): string {
  const obj: Record<string, unknown> = {
    enabled: fields.scheduleEnabled,
  };
  if (fields.scheduleType.trim()) obj.recurrence = fields.scheduleType.trim();
  if (fields.scheduleTime.trim()) obj.dueTime = fields.scheduleTime.trim();
  if (fields.scheduleDays.trim()) {
    obj.days = fields.scheduleDays
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
  }
  if (fields.scheduleAssignedRole.trim()) {
    obj.assignedRole = fields.scheduleAssignedRole.trim();
  }
  return JSON.stringify(obj);
}

export interface ScheduleParseError {
  field: string;
  message: string;
}

export function validateSpreadsheetSchedule(
  fields: SpreadsheetScheduleFields,
): ScheduleParseError[] {
  const errors: ScheduleParseError[] = [];

  if (fields.scheduleTime.trim() && !TIME_RE.test(fields.scheduleTime.trim())) {
    errors.push({
      field: 'Schedule Time',
      message: 'Schedule Time must use HH:mm format.',
    });
  }

  return errors;
}

export function booleanToSpreadsheet(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

export function normalizeSpreadsheetBoolean(
  raw: unknown,
  field: string,
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  if (typeof raw === 'number') {
    if (raw === 1) return { ok: true, value: true };
    if (raw === 0) return { ok: true, value: false };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: `${field} must be a boolean value.` };
  }

  const normalized = raw.trim().toLowerCase();
  if (['true', 'yes', '1'].includes(normalized)) return { ok: true, value: true };
  if (['false', 'no', '0'].includes(normalized)) return { ok: true, value: false };

  return {
    ok: false,
    error: `${field} contains "${raw}". Use TRUE, FALSE, Yes, No, 1, or 0.`,
  };
}
