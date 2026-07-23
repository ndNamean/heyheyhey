/**
 * Progressive Logbook filter state + matching (client-side only).
 * Permissions stay in logbook.ts — filters only narrow canViewLogbookEntry results.
 */

import {
  canEditLogbookAssignment,
  canReviewLogbookIssue,
  getIssueConfigurationState,
  isIssueOverdue,
  isLogbookIssue,
  profileMatchesAssignee,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
} from './logbook';
import { hasCorrectionFeedback } from './logbookResolution';
import { canReview, canUseOpsTools, userCanAccessStore } from './roles';
import { rankOf } from './roleResolver';
import type {
  LogbookEntry,
  LogbookEntryType,
  Profile,
  Role,
  RoleDefinition,
  Store,
} from '../types';

export type LogbookQuickView =
  | 'all_visible'
  | 'needs_my_action'
  | 'assigned_to_my_role'
  | 'created_by_me'
  | 'my_teams_issues';

export type LogbookLifecycleFilter =
  | 'active'
  | 'open'
  | 'in_progress'
  | 'waiting_approval'
  | 'correction_requested'
  | 'resolved'
  | 'recalled'
  | 'overdue';

export type LogbookAckFilter = 'requires_ack' | 'missing_my_ack' | 'acknowledged_by_me';

export type LogbookDateBasedOn = 'created' | 'due' | 'resolved';

export interface LogbookFilterState {
  quickView: LogbookQuickView;
  storeId: string;
  entryType: 'all' | LogbookEntryType;
  dateFrom: string;
  dateTo: string;
  search: string;
  issueLifecycles: LogbookLifecycleFilter[];
  severities: string[];
  assigneeRoles: string[];
  proofTypes: string[];
  dateBasedOn: LogbookDateBasedOn;
  ackStatuses: LogbookAckFilter[];
}

export type LogbookFilterChip = {
  id: string;
  kind:
    | 'store'
    | 'entryType'
    | 'dateFrom'
    | 'dateTo'
    | 'lifecycle'
    | 'severity'
    | 'assignee'
    | 'proof'
    | 'ack'
    | 'dateBasedOn';
  value: string;
};

export const LOGBOOK_LIFECYCLE_OPTIONS: LogbookLifecycleFilter[] = [
  'active',
  'open',
  'in_progress',
  'waiting_approval',
  'correction_requested',
  'resolved',
  'recalled',
  'overdue',
];

export const LOGBOOK_ACK_OPTIONS: LogbookAckFilter[] = [
  'requires_ack',
  'missing_my_ack',
  'acknowledged_by_me',
];

export const LOGBOOK_QUICK_VIEWS: LogbookQuickView[] = [
  'all_visible',
  'needs_my_action',
  'assigned_to_my_role',
  'created_by_me',
  'my_teams_issues',
];

export function emptyLogbookFilterState(
  quickView: LogbookQuickView = 'all_visible',
): LogbookFilterState {
  return {
    quickView,
    storeId: 'all',
    entryType: 'all',
    dateFrom: '',
    dateTo: '',
    search: '',
    issueLifecycles: [],
    severities: [],
    assigneeRoles: [],
    proofTypes: [],
    dateBasedOn: 'created',
    ackStatuses: [],
  };
}

/** staff/hybrid → assigned; manager+ → needs_my_action; others → all_visible */
export function defaultLogbookQuickView(
  profile: Profile,
  defs: RoleDefinition[],
): LogbookQuickView {
  if (profile.role === 'staff' || profile.role === 'hybrid') {
    return 'assigned_to_my_role';
  }
  if (!canUseOpsTools(profile.role, defs) && !canReview(profile.role, defs)) {
    return 'assigned_to_my_role';
  }
  if (rankOf(profile.role, defs) <= rankOf('manager', defs)) {
    return 'needs_my_action';
  }
  return 'all_visible';
}

/**
 * Map legacy FilterTab / session values (and new quick-view ids) into filter state.
 */
export function parseLogbookInitialFilter(
  raw: string | null | undefined,
): Partial<LogbookFilterState> | null {
  const key = (raw ?? '').trim();
  if (!key) return null;
  switch (key) {
    case 'all':
    case 'all_visible':
      return { quickView: 'all_visible' };
    case 'my-assigned':
    case 'assigned_to_my_role':
      return { quickView: 'assigned_to_my_role' };
    case 'needs_my_action':
      return { quickView: 'needs_my_action' };
    case 'created_by_me':
      return { quickView: 'created_by_me' };
    case 'my_teams_issues':
      return { quickView: 'my_teams_issues' };
    case 'open':
      return { quickView: 'all_visible', issueLifecycles: ['open'] };
    case 'waiting_approval':
      return { quickView: 'all_visible', issueLifecycles: ['waiting_approval'] };
    case 'overdue':
      return { quickView: 'all_visible', issueLifecycles: ['overdue'] };
    case 'resolved':
      return { quickView: 'all_visible', issueLifecycles: ['resolved'] };
    case 'correction':
      return { quickView: 'all_visible', issueLifecycles: ['correction_requested'] };
    default:
      return null;
  }
}

export function countActiveDetailedFilters(filters: LogbookFilterState): number {
  let n = 0;
  if (filters.storeId !== 'all') n += 1;
  if (filters.entryType !== 'all') n += 1;
  if (filters.dateFrom) n += 1;
  if (filters.dateTo) n += 1;
  n += filters.issueLifecycles.length;
  n += filters.severities.length;
  n += filters.assigneeRoles.length;
  n += filters.proofTypes.length;
  n += filters.ackStatuses.length;
  if (filters.dateBasedOn !== 'created') n += 1;
  return n;
}

export function listActiveDetailedFilterChips(
  filters: LogbookFilterState,
): LogbookFilterChip[] {
  const chips: LogbookFilterChip[] = [];
  if (filters.storeId !== 'all') {
    chips.push({ id: `store:${filters.storeId}`, kind: 'store', value: filters.storeId });
  }
  if (filters.entryType !== 'all') {
    chips.push({
      id: `entryType:${filters.entryType}`,
      kind: 'entryType',
      value: filters.entryType,
    });
  }
  if (filters.dateFrom) {
    chips.push({ id: `dateFrom:${filters.dateFrom}`, kind: 'dateFrom', value: filters.dateFrom });
  }
  if (filters.dateTo) {
    chips.push({ id: `dateTo:${filters.dateTo}`, kind: 'dateTo', value: filters.dateTo });
  }
  for (const value of filters.issueLifecycles) {
    chips.push({ id: `lifecycle:${value}`, kind: 'lifecycle', value });
  }
  for (const value of filters.severities) {
    chips.push({ id: `severity:${value}`, kind: 'severity', value });
  }
  for (const value of filters.assigneeRoles) {
    chips.push({ id: `assignee:${value}`, kind: 'assignee', value });
  }
  for (const value of filters.proofTypes) {
    chips.push({ id: `proof:${value}`, kind: 'proof', value });
  }
  for (const value of filters.ackStatuses) {
    chips.push({ id: `ack:${value}`, kind: 'ack', value });
  }
  if (filters.dateBasedOn !== 'created') {
    chips.push({
      id: `dateBasedOn:${filters.dateBasedOn}`,
      kind: 'dateBasedOn',
      value: filters.dateBasedOn,
    });
  }
  return chips;
}

export function removeDetailedFilterChip(
  filters: LogbookFilterState,
  chip: LogbookFilterChip,
): LogbookFilterState {
  switch (chip.kind) {
    case 'store':
      return { ...filters, storeId: 'all' };
    case 'entryType':
      return clearIncompatibleFiltersOnEntryTypeChange(filters, 'all');
    case 'dateFrom':
      return { ...filters, dateFrom: '' };
    case 'dateTo':
      return { ...filters, dateTo: '' };
    case 'lifecycle':
      return {
        ...filters,
        issueLifecycles: filters.issueLifecycles.filter((v) => v !== chip.value),
      };
    case 'severity':
      return {
        ...filters,
        severities: filters.severities.filter((v) => v !== chip.value),
      };
    case 'assignee':
      return {
        ...filters,
        assigneeRoles: filters.assigneeRoles.filter((v) => v !== chip.value),
      };
    case 'proof':
      return {
        ...filters,
        proofTypes: filters.proofTypes.filter((v) => v !== chip.value),
      };
    case 'ack':
      return {
        ...filters,
        ackStatuses: filters.ackStatuses.filter((v) => v !== (chip.value as LogbookAckFilter)),
      };
    case 'dateBasedOn':
      return { ...filters, dateBasedOn: 'created' };
    default:
      return filters;
  }
}

/** Clear incompatible More-filters fields when Entry type changes. */
export function clearIncompatibleFiltersOnEntryTypeChange(
  filters: LogbookFilterState,
  nextType: 'all' | LogbookEntryType,
): LogbookFilterState {
  const next = { ...filters, entryType: nextType };
  if (nextType === 'issue') {
    return { ...next, ackStatuses: [] };
  }
  if (nextType === 'note' || nextType === 'announcement') {
    return {
      ...next,
      issueLifecycles: [],
      assigneeRoles: [],
      proofTypes: [],
      dateBasedOn: 'created',
    };
  }
  return next;
}

/** manager / areaManager / admin / owner (rank ≤ manager). */
export function canSeeMyTeamQuickView(
  profile: Profile,
  defs: RoleDefinition[],
): boolean {
  return rankOf(profile.role, defs) <= rankOf('manager', defs);
}

/**
 * Team quick view: issues in accessible stores whose assignee rank is
 * strictly below the actor. Caller still applies canViewLogbookEntry.
 */
export function isMyTeamLogbookIssue(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!canSeeMyTeamQuickView(profile, defs)) return false;
  if (!isLogbookIssue(entry)) return false;
  if (!entry.storeId) return false;
  const storeIds = (profile.stores ?? []).map((s) => s.id);
  if (!userCanAccessStore(profile.role, storeIds, entry.storeId, defs)) return false;
  const assigneeRole = (entry.assigneeRole ?? '').trim() as Role;
  if (!assigneeRole) return false;
  return rankOf(assigneeRole, defs) > rankOf(profile.role, defs);
}

/**
 * Needs my action — OR of:
 * (1) assigned issue needing work (open / in_progress / correction),
 * (2) waiting_approval I can review,
 * (3) incomplete setup I can edit.
 */
export function needsMyLogbookAction(
  profile: Profile,
  entry: LogbookEntry,
  defs: RoleDefinition[],
): boolean {
  if (!isLogbookIssue(entry)) return false;

  const status = resolveLogbookIssueStatus(entry);

  // (1) Assigned work queue
  if (
    profileMatchesAssignee(profile, entry, defs) &&
    (status === 'open' || status === 'in_progress' || hasCorrectionFeedback(entry))
  ) {
    if (getIssueConfigurationState(entry) !== 'missing_assignment') {
      return true;
    }
  }

  // (2) Waiting my review
  if (status === 'waiting_approval' && canReviewLogbookIssue(profile, entry, defs)) {
    return true;
  }

  // (3) Incomplete setup I can edit
  if (
    getIssueConfigurationState(entry) !== 'ready' &&
    canEditLogbookAssignment(profile, entry, defs)
  ) {
    return true;
  }

  return false;
}

function entryYmd(
  entry: LogbookEntry,
  dateBasedOn: LogbookDateBasedOn,
): string {
  const type = resolveLogbookEntryType(entry);
  if (type !== 'issue' || dateBasedOn === 'created') {
    const d = (entry.date ?? '').trim();
    if (d) return d.slice(0, 10);
    return (entry.createdAt ?? '').trim().slice(0, 10);
  }
  if (dateBasedOn === 'due') {
    return (entry.dueAt ?? '').trim().slice(0, 10);
  }
  return (entry.resolvedAt ?? '').trim().slice(0, 10);
}

function matchesDateRange(
  entry: LogbookEntry,
  filters: LogbookFilterState,
): boolean {
  if (!filters.dateFrom && !filters.dateTo) return true;
  const ymd = entryYmd(entry, filters.dateBasedOn);
  if (!ymd) return false;
  if (filters.dateFrom && ymd < filters.dateFrom) return false;
  if (filters.dateTo && ymd > filters.dateTo) return false;
  return true;
}

function matchesSearch(
  entry: LogbookEntry,
  search: string,
  storeById?: Map<string, Pick<Store, 'code' | 'name'>>,
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystacks: string[] = [
    entry.content ?? '',
    entry.resolutionRequirement ?? '',
    entry.resolutionNote ?? '',
  ];
  const store = entry.storeId
    ? storeById?.get(entry.storeId) || entry.store
    : undefined;
  if (store) {
    haystacks.push(store.code ?? '', store.name ?? '');
  }
  return haystacks.some((h) => h.toLowerCase().includes(q));
}

function matchesStoreFilter(entry: LogbookEntry, storeId: string): boolean {
  if (storeId === 'all') return true;
  if (entry.storeId === storeId) return true;
  // All-stores notes/announcements (blank storeId) stay visible when a store is selected
  const type = resolveLogbookEntryType(entry);
  if ((type === 'note' || type === 'announcement') && !entry.storeId) return true;
  return false;
}

function matchesLifecycle(
  entry: LogbookEntry,
  lifecycles: LogbookLifecycleFilter[],
  now: number,
): boolean {
  if (lifecycles.length === 0) return true;
  if (!isLogbookIssue(entry)) return false;
  const status = resolveLogbookIssueStatus(entry);
  return lifecycles.some((lc) => {
    switch (lc) {
      case 'active':
        return (
          status === 'open' ||
          status === 'in_progress' ||
          status === 'waiting_approval' ||
          hasCorrectionFeedback(entry)
        );
      case 'open':
        return status === 'open';
      case 'in_progress':
        return status === 'in_progress';
      case 'waiting_approval':
        return status === 'waiting_approval';
      case 'correction_requested':
        return hasCorrectionFeedback(entry);
      case 'resolved':
        return status === 'resolved';
      case 'recalled':
        return status === 'recalled';
      case 'overdue':
        return isIssueOverdue(entry, now);
      default:
        return false;
    }
  });
}

function parseAckIds(entry: LogbookEntry): string[] {
  try {
    const ids = JSON.parse(entry.ackUserIdsJson || '[]') as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function matchesAck(
  entry: LogbookEntry,
  profile: Profile,
  ackStatuses: LogbookAckFilter[],
): boolean {
  if (ackStatuses.length === 0) return true;
  const type = resolveLogbookEntryType(entry);
  if (type !== 'note' && type !== 'announcement') return false;
  const acks = parseAckIds(entry);
  return ackStatuses.some((a) => {
    switch (a) {
      case 'requires_ack':
        return Boolean(entry.requiresAck);
      case 'missing_my_ack':
        return Boolean(entry.requiresAck) && !acks.includes(profile.userId);
      case 'acknowledged_by_me':
        return acks.includes(profile.userId);
      default:
        return false;
    }
  });
}

function matchesQuickView(
  entry: LogbookEntry,
  profile: Profile,
  defs: RoleDefinition[],
  quickView: LogbookQuickView,
): boolean {
  switch (quickView) {
    case 'all_visible':
      return true;
    case 'needs_my_action':
      return needsMyLogbookAction(profile, entry, defs);
    case 'assigned_to_my_role': {
      const status = resolveLogbookIssueStatus(entry);
      return (
        isLogbookIssue(entry) &&
        status !== 'recalled' &&
        profileMatchesAssignee(profile, entry, defs)
      );
    }
    case 'created_by_me':
      return entry.authorUserId === profile.userId;
    case 'my_teams_issues':
      return isMyTeamLogbookIssue(profile, entry, defs);
    default:
      return true;
  }
}

export type EntryMatchOptions = {
  now?: number;
  storeById?: Map<string, Pick<Store, 'code' | 'name'>>;
};

/**
 * Match after canViewLogbookEntry. OR within each multi-select; AND across fields.
 */
export function entryMatchesLogbookFilters(
  entry: LogbookEntry,
  profile: Profile,
  defs: RoleDefinition[],
  filters: LogbookFilterState,
  opts: EntryMatchOptions = {},
): boolean {
  const now = opts.now ?? Date.now();
  const type = resolveLogbookEntryType(entry);

  if (!matchesQuickView(entry, profile, defs, filters.quickView)) return false;
  if (!matchesStoreFilter(entry, filters.storeId)) return false;
  if (filters.entryType !== 'all' && type !== filters.entryType) return false;
  if (!matchesDateRange(entry, filters)) return false;
  if (!matchesSearch(entry, filters.search, opts.storeById)) return false;

  // Detailed filters (AND). Empty multi-select = no constraint.
  const showIssueDetail =
    filters.entryType === 'all' || filters.entryType === 'issue';
  const showNoteDetail =
    filters.entryType === 'all' ||
    filters.entryType === 'note' ||
    filters.entryType === 'announcement';

  if (showIssueDetail) {
    if (filters.issueLifecycles.length > 0) {
      if (!matchesLifecycle(entry, filters.issueLifecycles, now)) return false;
    }
    if (filters.assigneeRoles.length > 0) {
      if (!isLogbookIssue(entry)) return false;
      if (!filters.assigneeRoles.includes(entry.assigneeRole || '')) return false;
    }
    if (filters.proofTypes.length > 0) {
      if (!isLogbookIssue(entry)) return false;
      if (!filters.proofTypes.includes((entry.resolutionProofType || '').trim() || 'photo')) {
        return false;
      }
    }
  }

  if (filters.severities.length > 0) {
    if (!filters.severities.includes(entry.severity)) return false;
  }

  if (showNoteDetail && filters.ackStatuses.length > 0) {
    if (!matchesAck(entry, profile, filters.ackStatuses)) return false;
  }

  return true;
}

export function toggleMultiValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}
