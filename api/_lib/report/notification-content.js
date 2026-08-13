/**
 * Server twin of src/lib/reportNotificationContent.ts — keep in sync.
 * Recipient selection that needs role graphs lives in recipients.js.
 */

export const REPORT_CHAT_MENTION_CAP = 15;

const EVENT_META = {
  report_submitted: {
    type: 'report_submitted_chat',
    icon: '📋',
    eventLabel: 'Report ready for review',
    actionType: 'open_review',
    requiredAction: 'Open Review',
    defaultStatus: 'waiting_approval',
  },
  report_action_required: {
    type: 'report_action_required_chat',
    icon: '✏️',
    eventLabel: 'Action required on report',
    actionType: 'fix_resubmit',
    requiredAction: 'Fix and resubmit',
    defaultStatus: 'need_correction',
  },
  report_finalized: {
    type: 'report_finalized_chat',
    icon: '🏁',
    eventLabel: 'Report finalized with issues',
    actionType: 'view',
    requiredAction: 'View / fix',
    defaultStatus: 'rejected',
  },
};

/** Branch report_finalized copy by live report status (approved vs issues). */
export function resolveReportEventMeta(eventType, reportStatus) {
  const base = EVENT_META[eventType];
  if (eventType !== 'report_finalized') return base;
  const status = String(reportStatus || '').trim();
  if (status === 'approved') {
    return {
      ...base,
      eventLabel: 'Report approved',
      actionType: 'view',
      requiredAction: 'View',
      defaultStatus: 'approved',
    };
  }
  return base;
}

export function reportDisplayId(reportId) {
  const id = String(reportId || '').trim();
  return id ? `#${id.slice(0, 6)}` : '#------';
}

export function reportDeliveryKeyPrefix(reportId, eventType, eventVersion) {
  return `report:${reportId}:${eventType}:${eventVersion}`;
}

export function reportDeliveryKeyForRecipient(
  reportId,
  eventType,
  eventVersion,
  recipientUserId,
) {
  return `${reportDeliveryKeyPrefix(reportId, eventType, eventVersion)}:${recipientUserId}`;
}

export function reportChatDeliveryKey(reportId, eventType, eventVersion, storeId) {
  return `report-chat:${reportId}:${eventType}:${eventVersion}:${storeId || ''}`;
}

export function reportActionRequiredChatKey(reportId, eventVersion, storeId) {
  return reportChatDeliveryKey(
    reportId,
    'report_action_required',
    eventVersion,
    storeId,
  );
}

export function profileMentionLabel(profile) {
  const name = profile?.displayName?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  if (email) return email.split('@')[0] || 'Someone';
  return 'Someone';
}

export function selectReportMentionUserIds(recipientUserIds) {
  const ids = [...new Set((recipientUserIds || []).filter(Boolean))];
  if (ids.length === 0 || ids.length > REPORT_CHAT_MENTION_CAP) return [];
  return ids;
}

export function selectReportMentionLabels(profiles, ids) {
  return ids.map((userId) => {
    const p = (profiles || []).find((x) => x.userId === userId);
    return profileMentionLabel(p || { userId });
  });
}

/**
 * Report Store Chat notify — default OFF (opt-in).
 * Enabled only when value is 1 / true / on / yes.
 */
export function isReportChatNotifyEnabled(
  value = process.env.VITE_REPORT_CHAT_NOTIFY || process.env.REPORT_CHAT_NOTIFY,
) {
  const raw = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

function trimSummary(report) {
  const parts = [
    String(report.templateName || '').trim(),
    String(report.reportDate || '').trim(),
  ].filter(Boolean);
  const s = parts.join(' · ') || 'Checklist report';
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

export function buildNormalizedReportNotification(input) {
  if (!EVENT_META[input.eventType]) {
    throw new Error(`Unsupported report notify event: ${input.eventType}`);
  }

  const report = input.report;
  const reportId = String(report.id || '').trim();
  const storeId = String(report.storeId || '');
  const displayId = reportDisplayId(reportId);
  const summary = trimSummary(report);
  const actorUserId = String(input.actor?.userId || '').trim();
  const actorLabel = profileMentionLabel(input.actor);
  const storeLabel =
    String(input.storeLabel || '').trim() ||
    [report.storeCode, report.storeName].filter(Boolean).join(' — ') ||
    (storeId ? 'Unknown store' : 'Unknown store');
  const statusHint = String(report.status || '').trim();
  const meta = resolveReportEventMeta(input.eventType, statusHint);
  const statusSnapshot = statusHint || meta.defaultStatus;
  const detail =
    String(input.note || '').trim() || String(input.itemTitle || '').trim();

  const scannableLine =
    [
      `${meta.icon} ${meta.eventLabel}`,
      `${displayId} · ${summary}`,
      storeLabel,
    ].join(' · ') + ` → ${meta.requiredAction}`;

  const pushBodyParts = [`${displayId} · ${summary}`, storeLabel, meta.requiredAction];
  if (detail) pushBodyParts.push(detail);

  const mentionIds = selectReportMentionUserIds(input.recipients);
  const mentionLabels = selectReportMentionLabels(input.profiles || [], mentionIds);
  const mentionLine =
    mentionLabels.length > 0 ? mentionLabels.map((l) => `@${l}`).join(' ') : '';

  const chatLines = [
    `${meta.icon} ${meta.eventLabel} · ${displayId} · ${summary}`,
    `${storeLabel} → ${meta.requiredAction}`,
  ];
  if (mentionLine) chatLines.push(mentionLine);
  if (detail) chatLines.push(detail);

  const inboxBody = [
    meta.eventLabel,
    `Report ${displayId}: ${summary}`,
    `Store: ${storeLabel}`,
    `Action: ${meta.requiredAction}`,
    detail ? `Note: ${detail}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const deepLink = {
    page: 'review',
    surface: 'reports',
    reportId,
    storeId,
  };
  const prefix = reportDeliveryKeyPrefix(reportId, input.eventType, input.eventVersion);
  const chatKey = reportChatDeliveryKey(
    reportId,
    input.eventType,
    input.eventVersion,
    storeId,
  );

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
    reportId,
    reportDisplayId: displayId,
    summary,
    storeId,
    storeLabel,
    actorUserId,
    actorLabel,
    recipientUserIds: [...(input.recipients || [])],
    requiredAction: meta.requiredAction,
    actionType: meta.actionType,
    statusSnapshot,
    deepLink,
    copy,
    type: meta.type,
    title: copy.inboxTitle,
    body: copy.inboxBody,
    deepLinkJson: JSON.stringify(deepLink),
    deliveryKeyPrefix: prefix,
    chatDeliveryKey: chatKey,
  };
}

export function shouldEmitReportChatOnItemApprove() {
  return false;
}

export function shouldEmitReportFinalizedChat(opts) {
  const status = String(opts?.reportStatus || '');
  if (status === 'waiting_approval') return false;
  if (status === 'approved') return true;
  if (status !== 'rejected' && status !== 'need_correction') return false;
  if (opts?.actionRequiredAlreadyDelivered) return false;
  return true;
}
