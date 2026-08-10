/**
 * Pure helpers for Admin `remind_overdue_chat` (Store Chat overdue remind once).
 */

import { chatDeliveryKey } from './notification-content.js';

export const OVERDUE_REMIND_EVENT = 'overdue_remind';
export const OVERDUE_REMIND_VERSION = 'once';

export function overdueRemindChatDeliveryKey(entryId, storeId) {
  return chatDeliveryKey(
    entryId,
    OVERDUE_REMIND_EVENT,
    OVERDUE_REMIND_VERSION,
    storeId || '',
  );
}

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

function isIssue(entry) {
  return String(entry?.entryType || '') === 'issue';
}

function isOverdue(entry, nowMs = Date.now()) {
  if (!isIssue(entry)) return false;
  const status = String(entry?.status || '');
  if (status === 'resolved' || status === 'recalled') return false;
  const dueAt = String(entry?.dueAt || '').trim();
  if (!dueAt) return false;
  const dueMs = new Date(dueAt).getTime();
  if (Number.isNaN(dueMs)) return false;
  return dueMs < nowMs;
}

function matchesAssignee(actor, entry, hasStoreAccessFn) {
  const role = String(entry?.assigneeRole || '').trim();
  const storeId = String(entry?.storeId || '').trim();
  if (!storeId || !role) return false;
  if (actor.role !== role) return false;
  if (!hasStoreAccessFn(actor, storeId)) return false;
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  if (assigneeIds.length === 0) return true;
  return assigneeIds.includes(actor.userId);
}

/**
 * AuthZ: store manager or upper canReview with store access; assignees cannot send.
 */
export function canActorRemindOverdueChat(actor, entry, defs, helpers) {
  const {
    hasStoreAccess,
    canReviewRole,
    rankOf,
  } = helpers;

  if (!actor || actor.approvalStatus !== 'approved') return false;
  if (!isIssue(entry)) return false;
  const storeId = String(entry.storeId || '').trim();
  if (!storeId || !hasStoreAccess(actor, storeId)) return false;
  if (matchesAssignee(actor, entry, hasStoreAccess)) return false;

  if (actor.role === 'manager') return true;
  if (!canReviewRole(actor.role, defs)) return false;

  const assigneeRole = String(entry.assigneeRole || '').trim();
  if (!assigneeRole) return true;
  return rankOf(actor.role, defs) < rankOf(assigneeRole, defs);
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string, status?: number }}
 */
export function evaluateRemindOverdueGuards(entry, assigneeRecipientIds, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const chatNotifyEnabled = opts.chatNotifyEnabled !== false;

  if (!entry) {
    return { ok: false, reason: 'not_found', status: 404 };
  }
  if (!isIssue(entry)) {
    return { ok: false, reason: 'not_an_issue', status: 400 };
  }
  const status = String(entry.status || '');
  if (status === 'resolved' || status === 'recalled') {
    return { ok: false, reason: 'no_longer_overdue', skipped: true };
  }
  if (!isOverdue(entry, nowMs)) {
    return { ok: false, reason: 'no_longer_overdue', skipped: true };
  }
  if ((entry.overdueChatRemindedAt || '').trim()) {
    return { ok: false, reason: 'already_reminded', skipped: true };
  }
  const assigneeRole = String(entry.assigneeRole || '').trim();
  if (!assigneeRole || !Array.isArray(assigneeRecipientIds) || assigneeRecipientIds.length === 0) {
    return { ok: false, reason: 'missing_assignment', skipped: true };
  }
  if (!chatNotifyEnabled) {
    return { ok: false, reason: 'chat_notify_disabled', skipped: true };
  }
  return { ok: true };
}

export function getAssigneeRecipientUserIds(entry, profiles, hasStoreAccessFn) {
  const role = String(entry?.assigneeRole || '').trim();
  const storeId = String(entry?.storeId || '').trim();
  if (!storeId || !role) return [];
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  const recipients = [];
  for (const p of profiles || []) {
    if (p.approvalStatus !== 'approved') continue;
    if (p.role !== role) continue;
    if (!hasStoreAccessFn(p, storeId)) continue;
    if (assigneeIds.length > 0 && !assigneeIds.includes(p.userId)) continue;
    recipients.push(p.userId);
  }
  return recipients;
}
