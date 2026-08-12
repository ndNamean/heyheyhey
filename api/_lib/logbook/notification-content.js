/**
 * Server twin of src/lib/logbookNotificationContent.ts — keep in sync.
 */

export const LOGBOOK_MENTION_CAP = 15;
export const LOGBOOK_CHAT_MENTION_MODE = {
  NAMED: 'named',
  ALL: 'all',
};

const EVENT_META = {
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

export function entryDisplayId(entryId) {
  const id = String(entryId || '').trim();
  return id ? `#${id.slice(0, 6)}` : '#------';
}

export function deliveryKeyPrefix(entryId, eventType, eventVersion) {
  return `logbook:${entryId}:${eventType}:${eventVersion}`;
}

export function deliveryKeyForRecipient(entryId, eventType, eventVersion, recipientUserId) {
  return `${deliveryKeyPrefix(entryId, eventType, eventVersion)}:${recipientUserId}`;
}

export function chatDeliveryKey(entryId, eventType, eventVersion, storeId) {
  return `logbook-chat:${entryId}:${eventType}:${eventVersion}:${storeId || ''}`;
}

export function profileMentionLabel(profile) {
  const name = profile?.displayName?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  if (email) return email.split('@')[0] || 'Someone';
  return 'Someone';
}

export function selectMentionUserIds(recipientUserIds) {
  const ids = [...new Set((recipientUserIds || []).filter(Boolean))];
  if (ids.length === 0 || ids.length > LOGBOOK_MENTION_CAP) return [];
  return ids;
}

export function selectMentionLabels(profiles, ids) {
  return ids.map((userId) => {
    const p = (profiles || []).find((x) => x.userId === userId);
    return profileMentionLabel(p || { userId });
  });
}

export function isLogbookChatNotifyEnabled(
  value = process.env.VITE_LOGBOOK_CHAT_NOTIFY || process.env.LOGBOOK_CHAT_NOTIFY,
) {
  const raw = String(value ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

export function resolveChatMentionMode(eventType) {
  if (eventType === 'ack_required') return LOGBOOK_CHAT_MENTION_MODE.ALL;
  if (eventType === 'issue_assigned' || eventType === 'resolution_submitted') {
    return LOGBOOK_CHAT_MENTION_MODE.NAMED;
  }
  return LOGBOOK_CHAT_MENTION_MODE.NAMED;
}

export function filterForLogbookNotificationType(type) {
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

function resolveEntryType(entry) {
  if (entry.entryType === 'issue') return 'issue';
  if (entry.entryType === 'announcement' || entry.isAnnouncement) return 'announcement';
  if (entry.entryType === 'note') return 'note';
  return 'issue';
}

function trimSummary(content) {
  const s = String(content || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) return 'Logbook entry';
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function formatDue(dueAt, isOverdue) {
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

function responsibilityLabel(reason) {
  if (reason === 'assignee') return 'Assignees';
  if (reason === 'reviewer') return 'Reviewers';
  if (reason === 'ack_required') return 'Ack required';
  return 'Stakeholders';
}

const ROSTER_NOTIFY_EVENTS = new Set([
  'resolution_submitted',
  'overdue',
  'correction_requested',
  'approved',
]);

function parseAssigneeUserIds(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string' && id.trim() !== '');
  } catch {
    return [];
  }
}

function rosterMentionLabel(profile) {
  const name = profile?.displayName?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  if (email) return email.split('@')[0] || 'Someone';
  return 'Someone';
}

function listNotifyAssigneeUserIds(entry, profiles) {
  const named = parseAssigneeUserIds(entry?.assigneeUserIdsJson);
  if (named.length > 0) return named;
  const role = String(entry?.assigneeRole || '').trim();
  const storeId = String(entry?.storeId || '').trim();
  if (!role || !storeId || !profiles?.length) return [];
  const ids = [];
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

function resolveRosterState(userId, submitterId, status, reviewNote) {
  const submitter = String(submitterId || '').trim();
  if (!submitter || userId !== submitter) return 'not_submitted';
  const st = String(status || '').trim();
  if (st === 'waiting_approval') return 'waiting_approval';
  if (st === 'resolved') return 'approved';
  if (st === 'in_progress' && String(reviewNote || '').trim()) return 'correction';
  return 'submitted';
}

/** Keep in sync with src/lib/logbookAssigneeRoster.ts notify line. */
function formatAssigneeRosterNotifyLine(entry, profiles, eventType) {
  if (!ROSTER_NOTIFY_EVENTS.has(eventType)) return '';
  const ids = listNotifyAssigneeUserIds(entry, profiles);
  const submitterId = String(entry?.resolutionSubmittedByUserId || '').trim();
  if (ids.length === 0) return '';
  if (ids.length === 1 && !submitterId) return '';
  const rows = ids.map((userId) => {
    const p = (profiles || []).find((x) => x.userId === userId);
    return {
      label: rosterMentionLabel(p || { userId }),
      state: resolveRosterState(userId, submitterId, entry?.status, entry?.reviewNote),
    };
  });
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  const submitted = rows.filter((r) => r.state !== 'not_submitted').map((r) => r.label);
  const pending = rows.filter((r) => r.state === 'not_submitted').map((r) => r.label);
  if (submitted.length && pending.length) {
    return `Submitted: ${submitted.join(', ')} · Not submitted: ${pending.join(', ')}`;
  }
  if (submitted.length) return `Submitted: ${submitted.join(', ')}`;
  if (pending.length) return `Not submitted: ${pending.join(', ')}`;
  return '';
}

export function buildNormalizedLogbookNotification(input) {
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
  const mentionMode =
    input.chatMentionMode || resolveChatMentionMode(input.eventType);
  const mentionLine =
    mentionMode === LOGBOOK_CHAT_MENTION_MODE.ALL
      ? '@all'
      : mentionLabels.length > 0
        ? mentionLabels.map((l) => `@${l}`).join(' ')
        : '';

  const rosterLine = formatAssigneeRosterNotifyLine(
    entry,
    input.profiles,
    input.eventType,
  );
  if (rosterLine) pushBodyParts.push(rosterLine);

  const chatLines = [
    `${meta.icon} ${meta.eventLabel} · ${displayId} · ${summary}`,
    `${storeLabel} · ${duePart} → ${meta.requiredAction}`,
  ];
  if (mentionLine) chatLines.push(mentionLine);
  if (detail) chatLines.push(detail);
  if (rosterLine) chatLines.push(rosterLine);

  const inboxBody = [
    meta.eventLabel,
    `Entry ${displayId}: ${summary}`,
    `Store: ${storeLabel}`,
    `${responsibility} · ${duePart}`,
    `Action: ${meta.requiredAction}`,
    detail ? `Note: ${detail}` : '',
    rosterLine,
  ]
    .filter(Boolean)
    .join('\n');

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
    recipientUserIds: [...(input.recipients || [])],
    recipientReason: meta.recipientReason,
    requiredAction: meta.requiredAction,
    actionType: meta.actionType,
    statusSnapshot,
    deepLink: {
      page: 'logbook',
      entryId,
      storeId,
      filter: meta.filter,
    },
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
