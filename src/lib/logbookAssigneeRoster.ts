/**
 * Derived per-assignee submission roster for logbook issues.
 * Surfaces who submitted the current shared resolution — no per-person storage.
 */

import { parseAssigneeUserIds, profileStoreIds } from './logbook';
import { userCanAccessStore } from './roles';
import type { LogbookEntry, Profile, RoleDefinition } from '../types';

export const LOGBOOK_ASSIGNEE_ROSTER_VISIBLE_CAP = 8;

export type AssigneeRosterState =
  | 'not_submitted'
  | 'submitted'
  | 'waiting_approval'
  | 'correction'
  | 'approved';

export type AssigneeRosterRow = {
  userId: string;
  label: string;
  profile?: Profile;
  state: AssigneeRosterState;
};

export type LogbookAssigneeRosterEntry = Pick<
  LogbookEntry,
  | 'storeId'
  | 'assigneeRole'
  | 'assigneeUserIdsJson'
  | 'resolutionSubmittedByUserId'
  | 'status'
  | 'reviewNote'
>;

export type LogbookAssigneeRosterNotifyCopy = {
  assigneeRosterNotifyLine: string;
  assigneeSubmitted?: string;
  assigneeNotSubmitted?: string;
};

export const DEFAULT_ASSIGNEE_ROSTER_NOTIFY_COPY: Required<LogbookAssigneeRosterNotifyCopy> = {
  assigneeRosterNotifyLine: 'Submitted: {submitted} · Not submitted: {pending}',
  assigneeSubmitted: 'Submitted',
  assigneeNotSubmitted: 'Not submitted',
};

export const LOGBOOK_ASSIGNEE_ROSTER_NOTIFY_EVENTS = [
  'resolution_submitted',
  'overdue',
  'correction_requested',
  'approved',
] as const;

export function isLogbookAssigneeRosterRoleWide(
  entry: Pick<LogbookEntry, 'assigneeUserIdsJson'>,
): boolean {
  return parseAssigneeUserIds(entry.assigneeUserIdsJson).length === 0;
}

function mentionLabel(profile?: { displayName?: string; email?: string }): string {
  const name = profile?.displayName?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  if (email) return email.split('@')[0] || 'Someone';
  return 'Someone';
}

/** Same people as `listLogbookAssigneeRecipientUserIds` (role-wide [] expands). */
function listRosterAssigneeUserIds(
  entry: Pick<LogbookEntry, 'storeId' | 'assigneeRole' | 'assigneeUserIdsJson'>,
  profiles: Profile[],
  defs?: RoleDefinition[],
): string[] {
  const role = (entry.assigneeRole ?? '').trim();
  if (!entry.storeId || !role) return [];
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  const recipients: string[] = [];
  for (const p of profiles) {
    if (p.approvalStatus !== 'approved') continue;
    if (p.role !== role) continue;
    if (!userCanAccessStore(p.role, profileStoreIds(p), entry.storeId, defs)) continue;
    if (assigneeIds.length > 0 && !assigneeIds.includes(p.userId)) continue;
    recipients.push(p.userId);
  }
  return recipients;
}

export function resolveLogbookAssigneeRosterState(opts: {
  userId: string;
  submitterId: string;
  status?: string | null;
  reviewNote?: string | null;
}): AssigneeRosterState {
  const submitterId = (opts.submitterId ?? '').trim();
  if (!submitterId || opts.userId !== submitterId) return 'not_submitted';
  const status = String(opts.status || '').trim();
  if (status === 'waiting_approval') return 'waiting_approval';
  if (status === 'resolved') return 'approved';
  if (status === 'in_progress' && String(opts.reviewNote || '').trim()) return 'correction';
  return 'submitted';
}

export function buildLogbookAssigneeRoster(
  entry: LogbookAssigneeRosterEntry,
  profiles: Profile[],
  defs?: RoleDefinition[],
): AssigneeRosterRow[] {
  const ids = listRosterAssigneeUserIds(entry, profiles, defs);
  const submitterId = (entry.resolutionSubmittedByUserId ?? '').trim();
  const rows: AssigneeRosterRow[] = ids.map((userId) => {
    const profile = profiles.find((p) => p.userId === userId);
    return {
      userId,
      label: mentionLabel(profile || { userId }),
      profile,
      state: resolveLogbookAssigneeRosterState({
        userId,
        submitterId,
        status: entry.status,
        reviewNote: entry.reviewNote,
      }),
    };
  });
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return rows;
}

export function formatLogbookAssigneeRosterLine(
  rows: AssigneeRosterRow[],
  copy: LogbookAssigneeRosterNotifyCopy = DEFAULT_ASSIGNEE_ROSTER_NOTIFY_COPY,
): string {
  if (!rows.length) return '';
  const submitted = rows.filter((r) => r.state !== 'not_submitted').map((r) => r.label);
  const pending = rows.filter((r) => r.state === 'not_submitted').map((r) => r.label);
  if (!submitted.length && !pending.length) return '';
  const submittedLabel = copy.assigneeSubmitted || DEFAULT_ASSIGNEE_ROSTER_NOTIFY_COPY.assigneeSubmitted;
  const pendingLabel = copy.assigneeNotSubmitted || DEFAULT_ASSIGNEE_ROSTER_NOTIFY_COPY.assigneeNotSubmitted;
  if (submitted.length && pending.length) {
    return copy.assigneeRosterNotifyLine
      .replace('{submitted}', submitted.join(', '))
      .replace('{pending}', pending.join(', '));
  }
  if (submitted.length) return `${submittedLabel}: ${submitted.join(', ')}`;
  return `${pendingLabel}: ${pending.join(', ')}`;
}

/** Multi-assignee, or one assignee plus a known submitter. Skip empty / single-assignee noise. */
export function shouldIncludeLogbookAssigneeRosterNotify(
  rows: AssigneeRosterRow[],
  submitterId?: string | null,
): boolean {
  if (rows.length === 0) return false;
  if (rows.length > 1) return true;
  return Boolean((submitterId ?? '').trim());
}

type NotifyProfile = {
  userId: string;
  displayName?: string;
  email?: string;
  role?: string;
  approvalStatus?: string;
  stores?: Array<{ id?: string } | string>;
};

/**
 * Notify-path ids: named `assigneeUserIdsJson` as-is; role-wide [] expands from
 * profiles that include role / store (same idea as remind recipients).
 */
export function listLogbookAssigneeIdsForNotify(
  entry: {
    storeId?: string;
    assigneeRole?: string;
    assigneeUserIdsJson?: string;
  },
  profiles?: NotifyProfile[],
): string[] {
  const named = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  if (named.length > 0) return named;
  const role = String(entry.assigneeRole || '').trim();
  const storeId = String(entry.storeId || '').trim();
  if (!role || !storeId || !profiles?.length) return [];
  const ids: string[] = [];
  for (const p of profiles) {
    if (p.approvalStatus && p.approvalStatus !== 'approved') continue;
    if (!p.role || p.role !== role) continue;
    const storeIds = (p.stores || [])
      .map((s) => (typeof s === 'string' ? s : String(s?.id || '')))
      .filter(Boolean);
    if (storeIds.length > 0 && !storeIds.includes(storeId)) continue;
    ids.push(p.userId);
  }
  return ids;
}

export function buildLogbookAssigneeRosterForNotify(
  entry: {
    storeId?: string;
    assigneeRole?: string;
    assigneeUserIdsJson?: string;
    resolutionSubmittedByUserId?: string;
    status?: string;
    reviewNote?: string;
  },
  profiles?: NotifyProfile[],
): AssigneeRosterRow[] {
  const ids = listLogbookAssigneeIdsForNotify(entry, profiles);
  const submitterId = String(entry.resolutionSubmittedByUserId || '').trim();
  const rows: AssigneeRosterRow[] = ids.map((userId) => {
    const profile = (profiles || []).find((p) => p.userId === userId);
    return {
      userId,
      label: mentionLabel(profile || { userId }),
      state: resolveLogbookAssigneeRosterState({
        userId,
        submitterId,
        status: entry.status,
        reviewNote: entry.reviewNote,
      }),
    };
  });
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return rows;
}

export function formatLogbookAssigneeRosterNotifyLine(
  entry: Parameters<typeof buildLogbookAssigneeRosterForNotify>[0],
  profiles?: NotifyProfile[],
  copy: LogbookAssigneeRosterNotifyCopy = DEFAULT_ASSIGNEE_ROSTER_NOTIFY_COPY,
): string {
  const rows = buildLogbookAssigneeRosterForNotify(entry, profiles);
  const submitterId = String(entry.resolutionSubmittedByUserId || '').trim();
  if (!shouldIncludeLogbookAssigneeRosterNotify(rows, submitterId)) return '';
  return formatLogbookAssigneeRosterLine(rows, copy);
}
