/**
 * Shared Logbook notification content builder (inbox + push + Store Chat).
 * Server twin: api/_lib/logbook/notification-content.js — keep in sync.
 */

export const LOGBOOK_MENTION_CAP = 15;
export const LOGBOOK_CHAT_MENTION_MODE = {
  NAMED: 'named',
  ALL: 'all',
} as const;
export type LogbookChatMentionMode =
  (typeof LOGBOOK_CHAT_MENTION_MODE)[keyof typeof LOGBOOK_CHAT_MENTION_MODE];

export type LogbookNotifyEventType =
  | 'issue_assigned'
  | 'resolution_submitted'
  | 'ack_required'
  | 'correction_requested'
  | 'approved'
  | 'overdue'
  | 'reopened'
  | 'recalled';

export type LogbookDeepLinkFilter =
  | 'my-assigned'
  | 'waiting_approval'
  | 'requires_ack'
  | 'all';

export type LogbookRecipientReason = 'assignee' | 'reviewer' | 'ack_required' | 'stakeholder';

export type LogbookActionType = 'open_resolve' | 'review' | 'acknowledge' | 'view';

export interface NormalizedLogbookNotification {
  eventType: LogbookNotifyEventType;
  eventVersion: string;
  logbookEntryId: string;
  entryDisplayId: string;
  entryType: 'issue' | 'note' | 'announcement';
  summary: string;
  storeId: string;
  storeLabel: string;
  severity: string;
  dueAt: string | null;
  isOverdue: boolean;
  actorUserId: string;
  actorLabel: string;
  recipientUserIds: string[];
  recipientReason: LogbookRecipientReason;
  requiredAction: string;
  actionType: LogbookActionType;
  statusSnapshot: string;
  deepLink: {
    page: 'logbook';
    entryId: string;
    storeId: string;
    filter: LogbookDeepLinkFilter;
  };
  copy: {
    icon: string;
    eventLabel: string;
    scannableLine: string;
    pushTitle: string;
    pushBody: string;
    chatBody: string;
    inboxTitle: string;
    inboxBody: string;
  };
  type: string;
  title: string;
  body: string;
  filter: LogbookDeepLinkFilter;
  actionStatus: string;
  deepLinkJson: string;
  deliveryKeyPrefix: string;
  chatDeliveryKey: string;
}

export type BuildNormalizedLogbookNotificationInput = {
  entry: {
    id: string;
    content?: string;
    storeId?: string;
    status?: string;
    dueAt?: string;
    severity?: string;
    entryType?: string;
    isAnnouncement?: boolean;
    requiresAck?: boolean;
    resolutionNote?: string;
    reviewNote?: string;
  };
  eventType: LogbookNotifyEventType;
  eventVersion: string;
  recipients: string[];
  actor?: { userId?: string; displayName?: string; email?: string };
  storeLabel?: string;
  note?: string;
  reason?: string;
  nowMs?: number;
  profiles?: Array<{ userId: string; displayName?: string; email?: string }>;
  chatMentionMode?: LogbookChatMentionMode;
};

const EVENT_META: Record<
  LogbookNotifyEventType,
  {
    type: string;
    icon: string;
    eventLabel: string;
    recipientReason: LogbookRecipientReason;
    filter: LogbookDeepLinkFilter;
    actionType: LogbookActionType;
    requiredAction: string;
    defaultStatus: string;
  }
> = {
  issue_assigned: {
    type: 'logbook_issue_assigned',
    icon: '📋',
    eventLabel: 'New issue assigned',
    recipientReason: 'assignee',
    filter: 'my-assigned',
    actionType: 'open_resolve',
    requiredAction: 'Open and resolve',
    defaultStatus: 'open',
  },
  resolution_submitted: {
    type: 'logbook_resolution_submitted',
    icon: '✅',
    eventLabel: 'Resolution submitted',
    recipientReason: 'reviewer',
    filter: 'waiting_approval',
    actionType: 'review',
    requiredAction: 'Approve or request changes',
    defaultStatus: 'waiting_approval',
  },
  ack_required: {
    type: 'logbook_note_created',
    icon: '📣',
    eventLabel: 'Acknowledgment required',
    recipientReason: 'ack_required',
    filter: 'requires_ack',
    actionType: 'acknowledge',
    requiredAction: 'Open and acknowledge',
    defaultStatus: 'requires_ack',
  },
  correction_requested: {
    type: 'logbook_resolution_correction_requested',
    icon: '✏️',
    eventLabel: 'Correction requested',
    recipientReason: 'assignee',
    filter: 'my-assigned',
    actionType: 'open_resolve',
    requiredAction: 'Open and resolve',
    defaultStatus: 'in_progress',
  },
  approved: {
    type: 'logbook_resolution_approved',
    icon: '👍',
    eventLabel: 'Resolution approved',
    recipientReason: 'stakeholder',
    filter: 'my-assigned',
    actionType: 'view',
    requiredAction: 'View entry',
    defaultStatus: 'resolved',
  },
  overdue: {
    type: 'logbook_issue_overdue',
    icon: '⏰',
    eventLabel: 'Issue overdue',
    recipientReason: 'assignee',
    filter: 'my-assigned',
    actionType: 'open_resolve',
    requiredAction: 'Open and resolve',
    defaultStatus: 'open',
  },
  reopened: {
    type: 'logbook_issue_reopened',
    icon: '🔄',
    eventLabel: 'Issue reopened',
    recipientReason: 'assignee',
    filter: 'my-assigned',
    actionType: 'open_resolve',
    requiredAction: 'Open and resolve',
    defaultStatus: 'in_progress',
  },
  recalled: {
    type: 'logbook_issue_recalled',
    icon: '🚫',
    eventLabel: 'Issue recalled',
    recipientReason: 'stakeholder',
    filter: 'my-assigned',
    actionType: 'view',
    requiredAction: 'View entry',
    defaultStatus: 'recalled',
  },
};

export function entryDisplayId(entryId: string): string {
  const id = String(entryId || '').trim();
  return id ? `#${id.slice(0, 6)}` : '#------';
}

export function deliveryKeyPrefix(
  entryId: string,
  eventType: string,
  eventVersion: string,
): string {
  return `logbook:${entryId}:${eventType}:${eventVersion}`;
}

export function deliveryKeyForRecipient(
  entryId: string,
  eventType: string,
  eventVersion: string,
  recipientUserId: string,
): string {
  return `${deliveryKeyPrefix(entryId, eventType, eventVersion)}:${recipientUserId}`;
}

export function chatDeliveryKey(
  entryId: string,
  eventType: string,
  eventVersion: string,
  storeId: string,
): string {
  return `logbook-chat:${entryId}:${eventType}:${eventVersion}:${storeId || ''}`;
}

export function profileMentionLabel(profile?: {
  displayName?: string;
  email?: string;
  userId?: string;
}): string {
  const name = profile?.displayName?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  if (email) return email.split('@')[0] || 'Someone';
  return 'Someone';
}

/** Cap @mentions at LOGBOOK_MENTION_CAP; above that return []. */
export function selectMentionUserIds(recipientUserIds: string[]): string[] {
  const ids = [...new Set(recipientUserIds.filter(Boolean))];
  if (ids.length === 0 || ids.length > LOGBOOK_MENTION_CAP) return [];
  return ids;
}

export function selectMentionLabels(
  profiles: Array<{ userId: string; displayName?: string; email?: string }>,
  ids: string[],
): string[] {
  return ids.map((userId) => {
    const p = profiles.find((x) => x.userId === userId);
    return profileMentionLabel(p || { userId });
  });
}

/** Missing/off/false → ON (default enabled). */
export function isLogbookChatNotifyEnabled(
  value:
    | string
    | undefined
    | null = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: Record<string, string> }).env
        ?.VITE_LOGBOOK_CHAT_NOTIFY
    : undefined,
): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

export function resolveChatMentionMode(
  eventType: LogbookNotifyEventType,
): LogbookChatMentionMode {
  if (eventType === 'ack_required') return LOGBOOK_CHAT_MENTION_MODE.ALL;
  if (eventType === 'issue_assigned' || eventType === 'resolution_submitted') {
    return LOGBOOK_CHAT_MENTION_MODE.NAMED;
  }
  return LOGBOOK_CHAT_MENTION_MODE.NAMED;
}

export function filterForLogbookNotificationType(type: string): LogbookDeepLinkFilter {
  if (type === 'logbook_issue_assigned') return 'my-assigned';
  if (type === 'logbook_resolution_submitted') return 'waiting_approval';
  if (
    type === 'logbook_note_created' ||
    type === 'logbook_announcement_created' ||
    type === 'logbook_ack_required'
  ) {
    return 'requires_ack';
  }
  return 'my-assigned';
}

/** True only for issue notifications that should auto-open Submit resolution. */
export function shouldOpenLogbookResolutionFromNotification(type: string): boolean {
  return (
    type === 'logbook_issue_assigned' ||
    type === 'logbook_resolution_correction_requested' ||
    type === 'logbook_issue_overdue' ||
    type === 'logbook_issue_reopened'
  );
}

function resolveEntryType(
  entry: BuildNormalizedLogbookNotificationInput['entry'],
): 'issue' | 'note' | 'announcement' {
  if (entry.entryType === 'issue') return 'issue';
  if (entry.entryType === 'announcement' || entry.isAnnouncement) return 'announcement';
  if (entry.entryType === 'note') return 'note';
  return 'note';
}

function trimSummary(content?: string): string {
  const s = String(content || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) return 'Logbook entry';
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function formatDue(dueAt: string | null, isOverdue: boolean): string {
  if (!dueAt) return 'Due —';
  try {
    const d = new Date(dueAt);
    if (Number.isNaN(d.getTime())) return isOverdue ? 'Overdue' : `Due ${dueAt}`;
    const label = d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return isOverdue ? `Overdue · ${label}` : `Due ${label}`;
  } catch {
    return isOverdue ? 'Overdue' : `Due ${dueAt}`;
  }
}

function responsibilityLabel(reason: LogbookRecipientReason): string {
  if (reason === 'assignee') return 'Assignees';
  if (reason === 'reviewer') return 'Reviewers';
  if (reason === 'ack_required') return 'Ack required';
  return 'Stakeholders';
}

export function buildNormalizedLogbookNotification(
  input: BuildNormalizedLogbookNotificationInput,
): NormalizedLogbookNotification {
  const meta = EVENT_META[input.eventType];
  if (!meta) {
    throw new Error(`Unsupported logbook notify event: ${input.eventType}`);
  }

  const entry = input.entry;
  const entryId = String(entry.id || '').trim();
  const storeId = String(entry.storeId || '');
  const displayId = entryDisplayId(entryId);
  const summary = trimSummary(entry.content);
  const entryType = resolveEntryType(entry);
  const notificationType =
    input.eventType === 'ack_required'
      ? entryType === 'announcement'
        ? 'logbook_announcement_created'
        : 'logbook_note_created'
      : meta.type;
  const dueAt = entry.dueAt ? String(entry.dueAt) : null;
  const nowMs = input.nowMs ?? Date.now();
  const isOverdue =
    input.eventType === 'overdue' ||
    Boolean(dueAt && !Number.isNaN(Date.parse(dueAt)) && Date.parse(dueAt) < nowMs);
  const actorUserId = String(input.actor?.userId || '').trim();
  const actorLabel = profileMentionLabel(input.actor);
  const storeLabel =
    String(input.storeLabel || '').trim() || (storeId ? 'Unknown store' : 'All stores');
  const statusSnapshot = String(entry.status || '').trim() || meta.defaultStatus;
  const detail =
    String(input.reason || '').trim() ||
    String(input.note || '').trim() ||
    (input.eventType === 'resolution_submitted'
      ? String(entry.resolutionNote || '').trim()
      : '') ||
    (input.eventType === 'correction_requested' || input.eventType === 'approved'
      ? String(entry.reviewNote || '').trim()
      : '');

  const duePart = formatDue(dueAt, isOverdue);
  const responsibility = responsibilityLabel(meta.recipientReason);
  const scannableLine =
    [
      `${meta.icon} ${meta.eventLabel}`,
      `${displayId} · ${summary}`,
      storeLabel,
      responsibility,
      duePart,
    ].join(' · ') + ` → ${meta.requiredAction}`;

  const pushBodyParts = [
    `${displayId} · ${summary}`,
    storeLabel,
    responsibility,
    duePart,
    meta.requiredAction,
  ];
  if (detail) pushBodyParts.push(detail);

  const mentionIds = selectMentionUserIds(input.recipients);
  const mentionLabels = selectMentionLabels(input.profiles || [], mentionIds);
  const mentionMode = input.chatMentionMode ?? resolveChatMentionMode(input.eventType);
  const mentionLine =
    mentionMode === LOGBOOK_CHAT_MENTION_MODE.ALL
      ? '@all'
      : mentionLabels.length > 0
        ? mentionLabels.map((l) => `@${l}`).join(' ')
        : '';

  const chatLines = [
    `${meta.icon} ${meta.eventLabel} · ${displayId} · ${summary}`,
    `${storeLabel} · ${duePart} → ${meta.requiredAction}`,
  ];
  if (mentionLine) chatLines.push(mentionLine);
  if (detail) chatLines.push(detail);

  const inboxBody = [
    meta.eventLabel,
    `Entry ${displayId}: ${summary}`,
    `Store: ${storeLabel}`,
    `${responsibility} · ${duePart}`,
    `Action: ${meta.requiredAction}`,
    detail ? `Note: ${detail}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const deepLink = {
    page: 'logbook' as const,
    entryId,
    storeId,
    filter: meta.filter,
  };
  const prefix = deliveryKeyPrefix(entryId, input.eventType, input.eventVersion);
  const chatKey = chatDeliveryKey(entryId, input.eventType, input.eventVersion, storeId);

  const copy = {
    icon: meta.icon,
    eventLabel: meta.eventLabel,
    scannableLine,
    pushTitle: meta.eventLabel,
    pushBody: pushBodyParts.join(' · '),
    chatBody: chatLines.join('\n'),
    inboxTitle: meta.eventLabel,
    inboxBody,
  };

  return {
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    logbookEntryId: entryId,
    entryDisplayId: displayId,
    entryType,
    summary,
    storeId,
    storeLabel,
    severity: String(entry.severity || ''),
    dueAt,
    isOverdue,
    actorUserId,
    actorLabel,
    recipientUserIds: [...input.recipients],
    recipientReason: meta.recipientReason,
    requiredAction: meta.requiredAction,
    actionType: meta.actionType,
    statusSnapshot,
    deepLink,
    copy,
    type: notificationType,
    title: copy.inboxTitle,
    body: copy.inboxBody,
    filter: meta.filter,
    actionStatus: statusSnapshot,
    deepLinkJson: JSON.stringify({
      entryId,
      filter: meta.filter,
      storeId,
    }),
    deliveryKeyPrefix: prefix,
    chatDeliveryKey: chatKey,
  };
}
