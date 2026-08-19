/**
 * Optional nearest-tier leadership escalation inbox for overdue/reopened/recalled.
 * Gated by STORE_OPS_LEADERSHIP_OVERSIGHT_NOTIFY (default off).
 * Does not write groupChatMessages.
 */

import {
  leadershipEscalationDeliveryKey,
  nearestLeadershipEscalationRecipients,
} from '../group-chat/store-ops-leadership.js';

export const LEADERSHIP_OVERSIGHT_EVENTS = new Set(['overdue', 'reopened', 'recalled']);

export function shouldDeliverLeadershipOversight(eventType, storeId, flagOn) {
  if (!flagOn) return false;
  if (!LEADERSHIP_OVERSIGHT_EVENTS.has(String(eventType || ''))) return false;
  return Boolean(String(storeId || '').trim());
}

export function additionalLeadershipOversightRecipients({
  storeId,
  profiles,
  defs,
  existingRecipients,
}) {
  return nearestLeadershipEscalationRecipients({
    storeId,
    profiles,
    defs,
    existingRecipients,
  });
}

export function leadershipOversightDeliveryKey(entryId, eventType, stage, recipientUserId) {
  return leadershipEscalationDeliveryKey(entryId, eventType, stage, recipientUserId);
}

export function buildLeadershipOversightNotification({
  recipientUserId,
  entry,
  eventType,
  eventVersion,
  actor,
  title,
  body,
  deepLinkJson,
  actionStatus,
  now,
}) {
  const storeId = String(entry?.storeId || '');
  return {
    recipientUserId,
    type: 'leadership_escalation',
    title,
    body,
    actorUserId: actor?.userId || '',
    actorRole: actor?.role || '',
    readAt: '',
    createdAt: now,
    deliveryKey: leadershipOversightDeliveryKey(
      entry.id,
      eventType,
      eventVersion,
      recipientUserId,
    ),
    deepLinkJson,
    reportId: entry.id,
    reportResponseId: '',
    storeId,
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: actionStatus || '',
  };
}
