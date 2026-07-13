export interface SpreadsheetScheduleFields {
  scheduleEnabled: boolean;
  scheduleType: string;
  scheduleTime: string;
  scheduleDays: string;
  scheduleAssignedRole: string;
}

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

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
    return {
      scheduleEnabled: parsed.enabled === true,
      scheduleType: typeof parsed.recurrence === 'string' ? parsed.recurrence : '',
      scheduleTime: typeof parsed.dueTime === 'string' ? parsed.dueTime : '',
      scheduleDays: Array.isArray(parsed.days)
        ? parsed.days.filter((d): d is string => typeof d === 'string').join(',')
        : typeof parsed.days === 'string'
          ? parsed.days
          : '',
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
