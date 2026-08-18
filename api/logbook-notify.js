/**
 * Vercel Serverless — Logbook + Report Admin SDK actions.
 * - type submit_resolution: Stage A (status + resolutionMedia + timeline)
 * - type resolution_submitted | creator_update | issue_recalled: Stage B inbox
 * - type deliver_event: Logbook inbox + Store Chat
 * - type remind_overdue_chat: once-only overdue Store Chat remind (explicit)
 * - type deliver_report_event: Report Store Chat handoffs (+ mention inbox)
 *
 * Kept as one function so Hobby stays under the serverless function limit.
 */

import { id } from '@instantdb/admin';
import {
  getAdminDb,
  parseBody,
} from './_lib/export/instant-admin.js';
import {
  loadProfileContext,
  verifyRequestUser,
} from './_lib/export/auth.js';
import { deliverPushForNotificationIds } from './_lib/push/deliver-notifications.js';
import {
  buildNormalizedLogbookNotification,
  chatDeliveryKey,
  deliveryKeyForRecipient,
  isLogbookChatNotifyEnabled,
  LOGBOOK_CHAT_MENTION_MODE,
  resolveChatMentionMode,
} from './_lib/logbook/notification-content.js';
import {
  hasStoreAccess,
  recipientsForChatRoom,
  resolveAckChatStoreIds,
} from './_lib/logbook/ack-chat-rooms.js';
import { resolveActorProfileId } from './_lib/logbook/resolve-actor-profile-id.js';
import {
  canActorRemindOverdueChat,
  evaluateRemindOverdueGuards,
  getAssigneeRecipientUserIds,
  overdueRemindChatDeliveryKey,
} from './_lib/logbook/overdue-remind.js';
import {
  linkedFileIds,
  parseSubmitFileIds,
  planResolutionMediaLinks,
} from './_lib/logbook/submit-resolution-media.js';
import {
  buildNormalizedReportNotification,
  isReportChatNotifyEnabled,
  reportActionRequiredChatKey,
  reportChatDeliveryKey,
  shouldEmitReportFinalizedChat,
} from './_lib/report/notification-content.js';
import {
  selectReportActionRecipients,
  selectReportFinalizedRecipients,
  selectReportSubmittedRecipients,
} from './_lib/report/recipients.js';

/** Max storeChatMessages updates per Instant transact when fan-out is large. */
const CHAT_TX_CHUNK = 25;

function nowIso() {
  return new Date().toISOString();
}

function notificationIdsFromTxs(txs) {
  const ids = [];
  for (const chunk of txs) {
    const ops = chunk?.__ops;
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      if (!Array.isArray(op) || op.length < 3) continue;
      const [cmd, etype, entityId] = op;
      if (
        (cmd === 'update' || cmd === 'merge' || cmd === 'create') &&
        etype === 'notifications' &&
        typeof entityId === 'string'
      ) {
        ids.push(entityId);
      }
    }
  }
  return [...new Set(ids)];
}

/** Fire-and-forget in-process push deliver after inbox writes. */
function schedulePushAfterNotify(txs) {
  const ids = notificationIdsFromTxs(txs);
  if (!ids.length) return;
  void deliverPushForNotificationIds(ids).catch((err) => {
    console.warn('[logbook-notify] push deliver skipped', err?.message || err);
  });
}

function emptyLogbookNotifFields(storeId, entryId, actionStatus) {
  return {
    reportId: entryId,
    reportResponseId: '',
    storeId,
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus,
    deliveryKey: '',
    deepLinkJson: '',
  };
}

function ensureDeepLinkJson(normalized, entry, roomStoreId) {
  const existing = String(normalized?.deepLinkJson || '').trim();
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed?.entryId) return existing;
    } catch {
      /* fall through */
    }
  }
  const entryId = String(entry?.id || '').trim();
  if (!entryId) return existing;
  return JSON.stringify({
    entryId,
    filter: String(normalized?.filter || 'my-assigned'),
    storeId: roomStoreId || entry.storeId || normalized.storeId || undefined,
  });
}

function issueSnippet(entry) {
  return String(entry.content || '').trim().slice(0, 120) || 'Logbook issue';
}

function isIssue(entry) {
  return String(entry?.entryType || '') === 'issue';
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

function canSubmitResolution(actor, entry) {
  if (!isIssue(entry)) return false;
  const status = String(entry.status || '');
  if (status !== 'open' && status !== 'in_progress') return false;
  if (actor.approvalStatus !== 'approved') return false;
  if (!entry.storeId || !hasStoreAccess(actor, entry.storeId)) return false;
  const assignee = String(entry.assigneeRole || '').trim();
  if (!assignee || actor.role !== assignee) return false;
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  if (assigneeIds.length > 0 && !assigneeIds.includes(actor.userId)) return false;
  return true;
}

async function loadRoleDefinitions(adminDb) {
  const result = await adminDb.query({ roleDefinitions: {} });
  return result.roleDefinitions ?? [];
}

function rankOf(roleKey, defs) {
  const found = defs.find((d) => d.key === roleKey && d.active !== false);
  if (found && typeof found.rank === 'number') return found.rank;
  const legacy = {
    owner: 0,
    admin: 1,
    areaManager: 2,
    manager: 3,
    leader: 4,
    subleader: 5,
    hybrid: 6,
    staff: 7,
    viewer: 8,
  };
  return legacy[roleKey] ?? 99;
}

function canReviewRole(roleKey, defs) {
  const found = defs.find((d) => d.key === roleKey && d.active !== false);
  if (found && typeof found.canReview === 'boolean') return found.canReview;
  return ['owner', 'admin', 'areaManager', 'manager', 'leader', 'subleader', 'hybrid'].includes(roleKey);
}

function getReviewerRecipients(entry, profiles, actorUserId, defs) {
  const assigneeRole = entry.assigneeRole || '';
  if (!entry.storeId || !assigneeRole) return [];
  const assigneeRank = rankOf(assigneeRole, defs);
  const recipients = new Set();
  for (const p of profiles) {
    if (p.userId === actorUserId) continue;
    if (p.approvalStatus !== 'approved') continue;
    if (!canReviewRole(p.role, defs)) continue;
    if (rankOf(p.role, defs) >= assigneeRank) continue;
    if (!hasStoreAccess(p, entry.storeId)) continue;
    recipients.add(p.userId);
  }
  return [...recipients];
}

function getAssigneeRecipients(entry, profiles, actorUserId) {
  const role = entry.assigneeRole || '';
  if (!entry.storeId || !role) return [];
  const assigneeIds = parseAssigneeUserIds(entry.assigneeUserIdsJson);
  const recipients = new Set();
  for (const p of profiles) {
    if (actorUserId && p.userId === actorUserId) continue;
    if (p.approvalStatus !== 'approved') continue;
    if (p.role !== role) continue;
    if (!hasStoreAccess(p, entry.storeId)) continue;
    if (assigneeIds.length > 0 && !assigneeIds.includes(p.userId)) continue;
    recipients.add(p.userId);
  }
  return [...recipients];
}

async function handleSubmitResolution(req, res, adminDb, actor, body) {
  const entryId = String(body.entryId || '').trim();
  const attemptId = String(body.attemptId || body.resolutionAttemptId || '').trim();
  const note = String(body.note || '').trim();
  const resolutionNumber = String(body.resolutionNumber || '').trim();
  const resolutionChecked = Boolean(body.resolutionChecked);
  const fileIds = parseSubmitFileIds(body);

  if (!entryId || !attemptId) {
    return res.status(400).json({ error: 'Missing entryId or attemptId' });
  }

  let entry;
  try {
    const result = await adminDb.query({
      logbookEntries: {
        $: { where: { id: entryId } },
        photo: {},
        resolutionMedia: {},
        resolutionProofHistory: {},
      },
    });
    entry = result.logbookEntries?.[0];
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to load entry',
    });
  }

  if (!entry) {
    return res.status(404).json({ error: 'Entry not found' });
  }

  if (!canSubmitResolution(actor, entry)) {
    return res.status(403).json({
      error: 'Cannot submit resolution for this issue',
    });
  }

  if (
    entry.resolutionAttemptId === attemptId &&
    entry.status === 'waiting_approval' &&
    entry.resolutionSubmittedByUserId === actor.userId
  ) {
    return res.status(200).json({ ok: true, deduped: true });
  }

  const priorFileIds = linkedFileIds(entry.resolutionMedia);
  const mediaPlan = planResolutionMediaLinks({
    priorResolutionMedia: entry.resolutionMedia,
    priorPhotoId: entry.photo?.id || '',
    historyIds: (entry.resolutionProofHistory || [])
      .map((f) => f?.id)
      .filter(Boolean),
    newFileIds: fileIds,
  });
  const prevStatus = String(entry.status || 'in_progress');
  const createdAt = nowIso();
  const displayName =
    actor.displayName?.trim() ||
    actor.email?.split('@')[0] ||
    actor.userId;

  const txs = [];

  for (const fid of mediaPlan.unlinkResolutionMediaIds) {
    txs.push(
      adminDb.tx.logbookEntries[entryId].unlink({ resolutionMedia: fid }),
    );
  }
  for (const fid of mediaPlan.unlinkPhotoIds) {
    txs.push(adminDb.tx.logbookEntries[entryId].unlink({ photo: fid }));
  }
  for (const fid of mediaPlan.historyLinkIds) {
    txs.push(
      adminDb.tx.logbookEntries[entryId].link({
        resolutionProofHistory: fid,
      }),
    );
  }

  txs.push(
    adminDb.tx.logbookEntries[entryId].update({
      status: 'waiting_approval',
      resolutionNote: note,
      resolutionNumber,
      resolutionChecked,
      resolutionSubmittedAt: createdAt,
      resolutionSubmittedByUserId: actor.userId,
      resolutionAttemptId: attemptId,
      updatedAt: createdAt,
    }),
  );

  for (const fid of mediaPlan.currentLinkIds) {
    txs.push(
      adminDb.tx.logbookEntries[entryId].link({ resolutionMedia: fid }),
    );
  }

  const eventNote = [
    note,
    `attempt:${attemptId}`,
    priorFileIds.length ? `priorFileIds:${priorFileIds.join(',')}` : '',
    fileIds.length ? `fileIds:${fileIds.join(',')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  txs.push(
    adminDb.tx.reviewEvents[id()].update({
      reportId: '',
      reportResponseId: '',
      storeId: entry.storeId || '',
      eventType: 'resolution_submitted',
      itemTitle: String(entry.content || '').slice(0, 80),
      templateItemId: '',
      sectionSnapshot: '',
      categorySnapshot: '',
      statusAfter: 'waiting_approval',
      previousStatus: prevStatus,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actorDisplayNameSnapshot: displayName,
      note: eventNote,
      feedbackCode: '',
      feedbackNote: '',
      createdAt,
      logbookEntryId: entryId,
      targetType: 'logbook',
    }),
  );

  try {
    await adminDb.transact(txs);
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Submit transaction failed',
    });
  }

  return res.status(200).json({ ok: true, attemptId });
}


const NOTE_AUDIENCE_ROLES = new Set([
  'owner',
  'admin',
  'areaManager',
  'manager',
  'leader',
  'subleader',
  'hybrid',
  'staff',
]);

/** Mirrors client getNoteAnnouncementRecipients / canViewLogbookEntry for notes. */
function getAckRecipients(entry, profiles, actorUserId) {
  if (!entry.requiresAck) return [];
  const storeId = String(entry.storeId || '');
  return profiles
    .filter((p) => {
      if (p.userId === actorUserId) return false;
      if (p.approvalStatus !== 'approved') return false;
      if (p.role === 'viewer') return false;
      if (!NOTE_AUDIENCE_ROLES.has(p.role)) return false;
      if (!storeId) return true;
      return hasStoreAccess(p, storeId);
    })
    .map((p) => p.userId);
}

function getStoreManagerRecipients(entry, profiles, actorUserId) {
  return profiles
    .filter(
      (p) =>
        p.userId !== actorUserId &&
        p.approvalStatus === 'approved' &&
        p.role === 'manager' &&
        hasStoreAccess(p, entry.storeId),
    )
    .map((p) => p.userId);
}

function recipientsForEvent(entry, profiles, actor, defs, eventType) {
  if (eventType === 'issue_assigned') {
    return getAssigneeRecipients(entry, profiles, actor.userId);
  }
  if (eventType === 'resolution_submitted') {
    return getReviewerRecipients(entry, profiles, actor.userId, defs);
  }
  if (eventType === 'ack_required') {
    return getAckRecipients(entry, profiles, actor.userId);
  }
  if (eventType === 'overdue') {
    return [
      ...new Set([
        ...getAssigneeRecipients(entry, profiles, ''),
        ...getStoreManagerRecipients(entry, profiles, ''),
        ...getReviewerRecipients(entry, profiles, actor.userId, defs),
      ]),
    ];
  }
  if (eventType === 'approved' || eventType === 'correction_requested') {
    const result = new Set(getAssigneeRecipients(entry, profiles, actor.userId));
    if (
      entry.resolutionSubmittedByUserId &&
      entry.resolutionSubmittedByUserId !== actor.userId
    ) {
      result.add(entry.resolutionSubmittedByUserId);
    }
    if (
      eventType === 'approved' &&
      entry.authorUserId &&
      entry.authorUserId !== actor.userId
    ) {
      result.add(entry.authorUserId);
    }
    return [...result];
  }
  if (eventType === 'reopened' || eventType === 'recalled') {
    const result = new Set([
      ...getAssigneeRecipients(entry, profiles, actor.userId),
      ...getStoreManagerRecipients(entry, profiles, actor.userId),
    ]);
    if (entry.authorUserId && entry.authorUserId !== actor.userId) {
      result.add(entry.authorUserId);
    }
    if (
      entry.resolutionSubmittedByUserId &&
      entry.resolutionSubmittedByUserId !== actor.userId
    ) {
      result.add(entry.resolutionSubmittedByUserId);
    }
    return [...result];
  }
  return [];
}

function storeLabelFor(entry, stores) {
  const storeId = String(entry.storeId || '');
  if (!storeId) return 'All stores';
  const store = (stores || []).find((s) => s.id === storeId);
  if (!store) return 'Unknown store';
  const code = String(store.code || '').trim();
  const name = String(store.name || '').trim();
  if (code && name) return `${code} — ${name}`;
  return name || code || 'Unknown store';
}

async function deliverEvent(req, res, adminDb, actor, body) {
  const entryId = String(body.entryId || '').trim();
  const eventType = String(body.eventType || '').trim();
  const eventVersion = String(body.eventVersion || '').trim();
  const supported = [
    'issue_assigned',
    'resolution_submitted',
    'ack_required',
    'correction_requested',
    'approved',
    'overdue',
    'reopened',
    'recalled',
  ];
  if (!entryId || !eventVersion || !supported.includes(eventType)) {
    return res.status(400).json({ error: 'Missing or invalid delivery event' });
  }

  let entry;
  let profiles;
  let defs;
  let stores;
  try {
    const [eq, pq, dq, sq] = await Promise.all([
      adminDb.query({ logbookEntries: { $: { where: { id: entryId } } } }),
      adminDb.query({ profiles: { stores: {} } }),
      loadRoleDefinitions(adminDb),
      adminDb.query({ stores: {} }),
    ]);
    entry = eq.logbookEntries?.[0];
    profiles = pq.profiles ?? [];
    defs = dq;
    stores = sq.stores ?? [];
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to load delivery context',
    });
  }
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  // Ack events with requiresAck=false create nothing (inbox/chat/push).
  if (eventType === 'ack_required' && !entry.requiresAck) {
    return res.status(200).json({
      ok: true,
      created: 0,
      chatCreated: 0,
      chatDeduped: 0,
      deduped: 0,
    });
  }

  const recipients = recipientsForEvent(entry, profiles, actor, defs, eventType);
  const normalized = buildNormalizedLogbookNotification({
    entry,
    eventType,
    eventVersion,
    recipients,
    note: String(body.note || '').trim(),
    reason: String(body.reason || '').trim(),
    actor,
    profiles,
    storeLabel: storeLabelFor(entry, stores),
  });

  const notificationIds = [];
  const inboxTxs = [];
  let created = 0;
  let deduped = 0;

  for (const recipientUserId of recipients) {
    const deliveryKey = deliveryKeyForRecipient(
      entryId,
      eventType,
      eventVersion,
      recipientUserId,
    );
    let exists = false;
    try {
      exists = Boolean(
        (
          await adminDb.query({
            notifications: { $: { where: { deliveryKey } } },
          })
        ).notifications?.length,
      );
    } catch {
      /* migration fallback */
    }
    if (exists) {
      deduped += 1;
      continue;
    }
    const notificationId = id();
    notificationIds.push(notificationId);
    created += 1;
    inboxTxs.push(
      adminDb.tx.notifications[notificationId].update({
        recipientUserId,
        type: normalized.type,
        title: normalized.copy.pushTitle || normalized.title,
        body: normalized.copy.inboxBody || normalized.body,
        actorUserId: actor.userId,
        actorRole: actor.role,
        readAt: '',
        createdAt: nowIso(),
        deliveryKey,
        deepLinkJson: ensureDeepLinkJson(normalized, entry, entry.storeId),
        ...emptyLogbookNotifFields(
          entry.storeId || '',
          entry.id,
          normalized.actionStatus,
        ),
      }),
    );
  }

  if (inboxTxs.length) {
    await adminDb.transact(inboxTxs);
  }

  let chatCreated = 0;
  let chatDeduped = 0;
  // Single-store: one room. All-store (storeId ''): fan out to recipient-linked rooms.
  if (isLogbookChatNotifyEnabled()) {
    const roomStoreIds = resolveAckChatStoreIds(
      entry,
      recipients,
      profiles,
      stores,
    );
    const senderProfileId = resolveActorProfileId(actor, profiles);
    if (!senderProfileId) {
      console.warn(
        '[logbook-notify] missing actor profileId; chat messages will not link sender',
        { userId: actor?.userId },
      );
    }
    const chatTxs = [];
    const createdAt = nowIso();
    for (const roomStoreId of roomStoreIds) {
      const key = chatDeliveryKey(
        entryId,
        eventType,
        eventVersion,
        roomStoreId,
      );
      let exists = false;
      try {
        exists = Boolean(
          (
            await adminDb.query({
              storeChatMessages: { $: { where: { chatDeliveryKey: key } } },
            })
          ).storeChatMessages?.length,
        );
      } catch {
        /* migration fallback */
      }
      if (exists) {
        chatDeduped += 1;
        deduped += 1;
        continue;
      }
      const roomRecipients = recipientsForChatRoom(
        recipients,
        profiles,
        roomStoreId,
      );
      const mentionMode = resolveChatMentionMode(eventType);
      const roomNormalized = buildNormalizedLogbookNotification({
        entry,
        eventType,
        eventVersion,
        recipients:
          mentionMode === LOGBOOK_CHAT_MENTION_MODE.NAMED ? roomRecipients : [],
        note: String(body.note || '').trim(),
        reason: String(body.reason || '').trim(),
        actor,
        profiles,
        storeLabel: normalized.storeLabel,
        chatMentionMode: mentionMode,
      });
      const chatBody = String(roomNormalized.copy.chatBody || roomNormalized.body || '').trim();
      const mentionAll = mentionMode === LOGBOOK_CHAT_MENTION_MODE.ALL;
      const mentionedUserIdsJson = mentionAll
        ? '[]'
        : JSON.stringify(roomRecipients);
      // Match human Store Chat sends: fields + Instant store/sender links.
      let chatTx = adminDb.tx.storeChatMessages[id()].update({
        storeId: roomStoreId,
        senderUserId: actor.userId,
        senderProfileId: senderProfileId || '',
        senderNameSnapshot:
          actor.displayName || actor.email || 'System',
        senderRoleSnapshot: actor.role || '',
        messageType: 'logbook_system',
        body: chatBody,
        createdAt,
        editedAt: '',
        deletedAt: '',
        status: 'active',
        replyToMessageId: '',
        mentionedUserIdsJson,
        mentionAll,
        giphyId: '',
        giphyKind: '',
        giphyTitle: '',
        giphyWidth: '',
        giphyHeight: '',
        giphyUrl: '',
        giphyPreviewUrl: '',
        attachmentKind: '',
        attachmentPath: '',
        attachmentFileId: '',
        attachmentUrl: '',
        attachmentMimeType: '',
        attachmentFileName: '',
        attachmentBytes: '',
        attachmentWidth: '',
        attachmentHeight: '',
        forwardedFromMessageId: '',
        forwardedFromUserId: '',
        clientMutationId: '',
        sourceType: 'logbook',
        logbookEntryId: entry.id,
        reportId: '',
        logbookEventType: eventType,
        actionType: normalized.actionType,
        targetUserIdsJson: JSON.stringify(roomRecipients),
        deepLinkJson: ensureDeepLinkJson(
          normalized,
          entry,
          roomStoreId || entry.storeId,
        ),
        statusSnapshot: normalized.statusSnapshot,
        chatDeliveryKey: key,
      });
      if (senderProfileId) {
        chatTx = chatTx.link({ store: roomStoreId, sender: senderProfileId });
      } else {
        chatTx = chatTx.link({ store: roomStoreId });
      }
      chatTxs.push(chatTx);
      chatCreated += 1;
    }
    for (let i = 0; i < chatTxs.length; i += CHAT_TX_CHUNK) {
      await adminDb.transact(chatTxs.slice(i, i + CHAT_TX_CHUNK));
    }
  }

  if (notificationIds.length) {
    void deliverPushForNotificationIds(notificationIds, { adminDb }).catch(
      (err) => {
        console.warn(
          '[logbook-notify] push deliver skipped',
          err?.message || err,
        );
      },
    );
  }

  return res.status(200).json({
    ok: true,
    created,
    chatCreated,
    chatDeduped,
    deduped,
    dedupedFully: created === 0 && chatCreated === 0 && deduped > 0,
  });
}

async function handleRemindOverdueChat(req, res, adminDb, actor, body) {
  const entryId = String(body.entryId || '').trim();
  if (!entryId) {
    return res.status(400).json({ error: 'Missing entryId' });
  }

  let entry;
  let profiles;
  let defs;
  let stores;
  try {
    const [eq, pq, dq, sq] = await Promise.all([
      adminDb.query({ logbookEntries: { $: { where: { id: entryId } } } }),
      adminDb.query({ profiles: { stores: {} } }),
      loadRoleDefinitions(adminDb),
      adminDb.query({ stores: {} }),
    ]);
    entry = eq.logbookEntries?.[0];
    profiles = pq.profiles ?? [];
    defs = dq;
    stores = sq.stores ?? [];
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to load remind context',
    });
  }

  if (!entry) {
    return res.status(404).json({ error: 'Entry not found', reason: 'not_found' });
  }

  const authOk = canActorRemindOverdueChat(actor, entry, defs, {
    hasStoreAccess,
    canReviewRole,
    rankOf,
  });
  if (!authOk) {
    return res.status(403).json({ error: 'Not authorized to remind overdue', reason: 'forbidden' });
  }

  const assigneeRecipients = getAssigneeRecipientUserIds(entry, profiles, hasStoreAccess);
  const guard = evaluateRemindOverdueGuards(entry, assigneeRecipients, {
    chatNotifyEnabled: isLogbookChatNotifyEnabled(),
  });
  if (!guard.ok) {
    const status = guard.status || 200;
    return res.status(status).json({
      ok: false,
      skipped: Boolean(guard.skipped),
      reason: guard.reason,
      error: guard.reason,
      chatCreated: 0,
      deduped: guard.reason === 'already_reminded',
    });
  }

  const storeId = String(entry.storeId || '').trim();
  const key = overdueRemindChatDeliveryKey(entryId, storeId);
  let existingChatMessage = null;
  try {
    existingChatMessage =
      (
        await adminDb.query({
          storeChatMessages: { $: { where: { chatDeliveryKey: key } } },
        })
      ).storeChatMessages?.[0] ?? null;
  } catch {
    /* migration fallback */
  }
  const chatExists = Boolean(existingChatMessage);
  const existingMessageId = String(existingChatMessage?.id || '').trim();
  const alreadyStampedMessageId = String(entry.overdueChatRemindMessageId || '').trim();

  const stampedAt = nowIso();
  const senderProfileId = resolveActorProfileId(actor, profiles);
  if (!senderProfileId) {
    console.warn(
      '[logbook-notify] missing actor profileId; overdue remind chat will not link sender',
      { userId: actor?.userId },
    );
  }

  if (chatExists) {
    const stampPayload = {
      overdueChatRemindedAt: stampedAt,
      updatedAt: stampedAt,
    };
    if (existingMessageId && !alreadyStampedMessageId) {
      stampPayload.overdueChatRemindMessageId = existingMessageId;
    }
    try {
      await adminDb.transact([adminDb.tx.logbookEntries[entryId].update(stampPayload)]);
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : 'Failed to stamp overdue remind',
      });
    }
    return res.status(200).json({
      ok: true,
      chatCreated: 0,
      chatDeduped: 1,
      deduped: true,
      reason: 'already_reminded',
    });
  }

  const mentionMode = resolveChatMentionMode('overdue');
  const normalized = buildNormalizedLogbookNotification({
    entry,
    eventType: 'overdue',
    eventVersion: 'once',
    recipients: assigneeRecipients,
    actor,
    profiles,
    storeLabel: storeLabelFor(entry, stores),
    chatMentionMode: mentionMode,
  });
  const chatBody = String(normalized.copy.chatBody || normalized.body || '').trim();
  const mentionedUserIdsJson = JSON.stringify(assigneeRecipients);
  const messageId = id();
  const stampTx = adminDb.tx.logbookEntries[entryId].update({
    overdueChatRemindedAt: stampedAt,
    overdueChatRemindMessageId: messageId,
    updatedAt: stampedAt,
  });

  let chatTx = adminDb.tx.storeChatMessages[messageId].update({
    storeId,
    senderUserId: actor.userId,
    senderProfileId: senderProfileId || '',
    senderNameSnapshot: actor.displayName || actor.email || 'System',
    senderRoleSnapshot: actor.role || '',
    messageType: 'logbook_system',
    body: chatBody,
    createdAt: stampedAt,
    editedAt: '',
    deletedAt: '',
    status: 'active',
    replyToMessageId: '',
    mentionedUserIdsJson,
    mentionAll: false,
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    giphyWidth: '',
    giphyHeight: '',
    giphyUrl: '',
    giphyPreviewUrl: '',
    attachmentKind: '',
    attachmentPath: '',
    attachmentFileId: '',
    attachmentUrl: '',
    attachmentMimeType: '',
    attachmentFileName: '',
    attachmentBytes: '',
    attachmentWidth: '',
    attachmentHeight: '',
    forwardedFromMessageId: '',
    forwardedFromUserId: '',
    clientMutationId: '',
    sourceType: 'logbook',
    logbookEntryId: entry.id,
    reportId: '',
    logbookEventType: 'overdue',
    actionType: normalized.actionType,
    targetUserIdsJson: JSON.stringify(assigneeRecipients),
    deepLinkJson: ensureDeepLinkJson(normalized, entry, storeId),
    statusSnapshot: normalized.statusSnapshot,
    chatDeliveryKey: key,
  });
  if (senderProfileId) {
    chatTx = chatTx.link({ store: storeId, sender: senderProfileId });
  } else {
    chatTx = chatTx.link({ store: storeId });
  }

  try {
    await adminDb.transact([chatTx, stampTx]);
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Remind transaction failed',
    });
  }

  return res.status(200).json({
    ok: true,
    chatCreated: 1,
    chatDeduped: 0,
    deduped: false,
  });
}

function storeLabelForReport(report, stores) {
  const code = String(report?.storeCode || '').trim();
  const name = String(report?.storeName || '').trim();
  if (code || name) return [code, name].filter(Boolean).join(' — ');
  const storeId = String(report?.storeId || '').trim();
  if (!storeId) return 'Unknown store';
  const match = (stores || []).find((s) => s.id === storeId);
  if (match) {
    return [match.code, match.name].filter(Boolean).join(' — ') || storeId;
  }
  return storeId;
}

function emptyStoreChatMentionNotifFields(storeId, messageId) {
  return {
    reportId: messageId,
    reportResponseId: '',
    storeId,
    itemTitle: '',
    completionPercent: 0,
    compliancePercent: 0,
    actionStatus: '',
    deliveryKey: '',
    deepLinkJson: '',
  };
}

async function deliverReportEvent(req, res, adminDb, actor, body) {
  const reportId = String(body.reportId || '').trim();
  const eventType = String(body.eventType || '').trim();
  const eventVersion = String(body.eventVersion || '').trim();
  const responseId = String(body.responseId || '').trim();
  const reportStatusHint = String(body.reportStatus || '').trim();

  if (!reportId || !eventType || !eventVersion) {
    return res.status(400).json({
      error: 'Missing reportId, eventType, or eventVersion',
    });
  }
  if (
    eventType !== 'report_submitted' &&
    eventType !== 'report_action_required' &&
    eventType !== 'report_finalized'
  ) {
    return res.status(400).json({ error: 'Unsupported report event type' });
  }

  if (!isReportChatNotifyEnabled()) {
    return res.status(200).json({
      ok: true,
      created: 0,
      chatCreated: 0,
      chatDeduped: 0,
      deduped: 0,
      skipped: true,
      reason: 'report_chat_notify_disabled',
    });
  }

  let report;
  let responses;
  let profiles;
  let defs;
  let stores;
  try {
    const [reportResult, profilesResult, roleDefs, storesResult] = await Promise.all([
      adminDb.query({
        reports: {
          $: { where: { id: reportId } },
          responses: {},
        },
      }),
      adminDb.query({
        profiles: { stores: {} },
      }),
      loadRoleDefinitions(adminDb),
      adminDb.query({ stores: {} }),
    ]);
    report = reportResult.reports?.[0];
    responses = report?.responses ?? [];
    profiles = profilesResult.profiles ?? [];
    defs = roleDefs;
    stores = storesResult.stores ?? [];
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to load report',
    });
  }

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const storeId = String(report.storeId || '').trim();
  if (!storeId) {
    return res.status(400).json({ error: 'Report has no storeId' });
  }

  let recipients = [];
  let itemTitle = String(body.itemTitle || '').trim();
  let response = null;
  if (responseId) {
    response = responses.find((r) => r.id === responseId) || null;
    if (response && !itemTitle) itemTitle = String(response.title || '').trim();
  }

  if (eventType === 'report_submitted') {
    recipients = selectReportSubmittedRecipients(
      report,
      responses,
      profiles,
      actor.userId,
      defs,
    );
  } else if (eventType === 'report_action_required') {
    if (!response) {
      response =
        responses.find((r) => r.status === 'need_correction') ||
        responses.find((r) => r.status === 'rejected') ||
        responses.find((r) => r.status === 'not_started') ||
        null;
    }
    if (!response) {
      return res.status(200).json({
        ok: true,
        created: 0,
        chatCreated: 0,
        chatDeduped: 0,
        deduped: 0,
        skipped: true,
        reason: 'no_actionable_response',
      });
    }
    recipients = selectReportActionRecipients(
      report,
      response,
      actor,
      profiles,
      defs,
    );
  } else {
    // report_finalized — skip chat when action_required already delivered this cycle
    const actionKey = reportActionRequiredChatKey(reportId, eventVersion, storeId);
    let actionRequiredExists = false;
    try {
      actionRequiredExists = Boolean(
        (
          await adminDb.query({
            storeChatMessages: { $: { where: { chatDeliveryKey: actionKey } } },
          })
        ).storeChatMessages?.length,
      );
    } catch {
      /* migration fallback */
    }
    const statusForPolicy =
      reportStatusHint || String(report.status || '').trim() || 'rejected';
    if (
      !shouldEmitReportFinalizedChat({
        reportStatus: statusForPolicy,
        actionRequiredAlreadyDelivered: actionRequiredExists,
      })
    ) {
      return res.status(200).json({
        ok: true,
        created: 0,
        chatCreated: 0,
        chatDeduped: actionRequiredExists ? 1 : 0,
        deduped: actionRequiredExists ? 1 : 0,
        skipped: true,
        reason: actionRequiredExists
          ? 'action_required_already_delivered'
          : 'clean_or_non_issue_finalize',
      });
    }
    recipients = selectReportFinalizedRecipients(report, actor, profiles, defs);
  }

  if (!recipients.length) {
    return res.status(200).json({
      ok: true,
      created: 0,
      chatCreated: 0,
      chatDeduped: 0,
      deduped: 0,
      skipped: true,
      reason: 'no_recipients',
    });
  }

  const key = reportChatDeliveryKey(reportId, eventType, eventVersion, storeId);
  let exists = false;
  try {
    exists = Boolean(
      (
        await adminDb.query({
          storeChatMessages: { $: { where: { chatDeliveryKey: key } } },
        })
      ).storeChatMessages?.length,
    );
  } catch {
    /* migration fallback */
  }
  if (exists) {
    return res.status(200).json({
      ok: true,
      created: 0,
      chatCreated: 0,
      chatDeduped: 1,
      deduped: 1,
      dedupedFully: true,
    });
  }

  const normalized = buildNormalizedReportNotification({
    report: reportStatusHint ? { ...report, status: reportStatusHint } : report,
    eventType,
    eventVersion,
    recipients,
    note: String(body.note || '').trim(),
    itemTitle,
    responseStatus: response ? String(response.status || '').trim() : undefined,
    actor,
    profiles,
    storeLabel: storeLabelForReport(report, stores),
  });

  const senderProfileId = resolveActorProfileId(actor, profiles);
  if (!senderProfileId) {
    console.warn(
      '[logbook-notify] missing actor profileId; report chat will not link sender',
      { userId: actor?.userId },
    );
  }

  const chatBody = String(normalized.copy.chatBody || normalized.body || '').trim();
  const mentionedUserIdsJson = JSON.stringify(recipients);
  const messageId = id();
  const createdAt = nowIso();

  let chatTx = adminDb.tx.storeChatMessages[messageId].update({
    storeId,
    senderUserId: actor.userId,
    senderProfileId: senderProfileId || '',
    senderNameSnapshot: actor.displayName || actor.email || 'System',
    senderRoleSnapshot: actor.role || '',
    messageType: 'report_system',
    body: chatBody,
    createdAt,
    editedAt: '',
    deletedAt: '',
    status: 'active',
    replyToMessageId: '',
    mentionedUserIdsJson,
    mentionAll: false,
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    giphyWidth: '',
    giphyHeight: '',
    giphyUrl: '',
    giphyPreviewUrl: '',
    attachmentKind: '',
    attachmentPath: '',
    attachmentFileId: '',
    attachmentUrl: '',
    attachmentMimeType: '',
    attachmentFileName: '',
    attachmentBytes: '',
    attachmentWidth: '',
    attachmentHeight: '',
    forwardedFromMessageId: '',
    forwardedFromUserId: '',
    clientMutationId: '',
    sourceType: 'report',
    logbookEntryId: '',
    reportId,
    logbookEventType: eventType,
    actionType: normalized.actionType,
    targetUserIdsJson: JSON.stringify(recipients),
    deepLinkJson: normalized.deepLinkJson,
    statusSnapshot: normalized.statusSnapshot,
    chatDeliveryKey: key,
  });
  if (senderProfileId) {
    chatTx = chatTx.link({ store: storeId, sender: senderProfileId });
  } else {
    chatTx = chatTx.link({ store: storeId });
  }

  await adminDb.transact([chatTx]);

  // Phase 4 — Store Chat mention inbox + push for named recipients
  const notificationIds = [];
  const mentionTxs = [];
  const actorName =
    actor.displayName?.trim() || actor.email?.split('@')[0] || 'Someone';
  const preview = chatBody.replace(/\s+/g, ' ').slice(0, 120);
  const storePart = normalized.storeLabel || storeId;
  for (const uid of recipients) {
    if (!uid || uid === actor.userId) continue;
    const notificationId = id();
    notificationIds.push(notificationId);
    mentionTxs.push(
      adminDb.tx.notifications[notificationId].update({
        recipientUserId: uid,
        type: 'store_chat_mention',
        title: `${actorName} mentioned you in Store Chat`,
        body: [`Store: ${storePart}`, preview].filter(Boolean).join('\n'),
        actorUserId: actor.userId,
        actorRole: actor.role,
        readAt: '',
        createdAt,
        ...emptyStoreChatMentionNotifFields(storeId, messageId),
      }),
    );
  }
  if (mentionTxs.length) {
    await adminDb.transact(mentionTxs);
    void deliverPushForNotificationIds(notificationIds, { adminDb }).catch(
      (err) => {
        console.warn(
          '[logbook-notify] report mention push skipped',
          err?.message || err,
        );
      },
    );
  }

  return res.status(200).json({
    ok: true,
    created: mentionTxs.length,
    chatCreated: 1,
    chatDeduped: 0,
    deduped: 0,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let userId;
  try {
    ({ userId } = await verifyRequestUser(req));
  } catch (e) {
    return res.status(e.status || 401).json({
      error: e instanceof Error ? e.message : 'Unauthorized',
    });
  }

  let actor;
  try {
    actor = await loadProfileContext(userId);
  } catch (e) {
    return res.status(e.status || 403).json({
      error: e instanceof Error ? e.message : 'Forbidden',
    });
  }

  const body = parseBody(req.body) || {};
  const type = String(body.type || '').trim();
  const adminDb = getAdminDb();

  if (type === 'submit_resolution') {
    return handleSubmitResolution(req, res, adminDb, actor, body);
  }

  if (type === 'deliver_event') {
    return deliverEvent(req, res, adminDb, actor, body);
  }

  if (type === 'remind_overdue_chat') {
    return handleRemindOverdueChat(req, res, adminDb, actor, body);
  }

  if (type === 'deliver_report_event') {
    return deliverReportEvent(req, res, adminDb, actor, body);
  }

  const entryId = String(body.entryId || '').trim();
  const attemptId = String(body.attemptId || body.resolutionAttemptId || '').trim();

  if (!entryId) {
    return res.status(400).json({ error: 'Missing entryId' });
  }
  if (
    type !== 'resolution_submitted' &&
    type !== 'creator_update' &&
    type !== 'issue_recalled'
  ) {
    return res.status(400).json({ error: 'Unsupported notification type' });
  }

  let entry;
  let profiles;
  let defs;
  try {
    const [entryResult, profilesResult, roleDefs] = await Promise.all([
      adminDb.query({
        logbookEntries: {
          $: { where: { id: entryId } },
        },
      }),
      adminDb.query({
        profiles: { stores: {} },
      }),
      loadRoleDefinitions(adminDb),
    ]);
    entry = entryResult.logbookEntries?.[0];
    profiles = profilesResult.profiles ?? [];
    defs = roleDefs;
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Failed to load entry',
    });
  }

  if (!entry) {
    return res.status(404).json({ error: 'Entry not found' });
  }

  if (type === 'resolution_submitted') {
    if (entry.status !== 'waiting_approval') {
      return res.status(409).json({
        error: 'Entry is not waiting approval',
        skipped: true,
      });
    }
    if (attemptId && entry.resolutionAttemptId && entry.resolutionAttemptId !== attemptId) {
      return res.status(409).json({
        error: 'Attempt id mismatch',
        skipped: true,
      });
    }
    const submitter = String(entry.resolutionSubmittedByUserId || '').trim();
    if (submitter && submitter !== actor.userId && actor.role === 'staff') {
      return res.status(403).json({ error: 'Not the resolution submitter' });
    }

    try {
      const existing = await adminDb.query({
        notifications: {
          $: {
            where: {
              reportId: entryId,
              type: 'logbook_resolution_submitted',
            },
          },
        },
      });
      const prior = (existing.notifications ?? []).filter(
        (n) =>
          n.actorUserId === actor.userId &&
          (!attemptId || String(n.body || '').includes(attemptId)),
      );
      if (prior.length > 0 && attemptId) {
        return res.status(200).json({ ok: true, created: 0, deduped: true });
      }
    } catch {
      /* continue without dedupe */
    }

    const recipients = getReviewerRecipients(entry, profiles, actor.userId, defs);
    const bodyText = [
      'Resolution submitted for review',
      `Issue: ${issueSnippet(entry)}`,
      entry.resolutionNote?.trim() ? `Note: ${entry.resolutionNote.trim()}` : '',
      attemptId ? `attempt:${attemptId}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const txs = recipients.map((recipientUserId) =>
      adminDb.tx.notifications[id()].update({
        recipientUserId,
        type: 'logbook_resolution_submitted',
        title: 'Logbook resolution submitted',
        body: bodyText,
        actorUserId: actor.userId,
        actorRole: actor.role,
        readAt: '',
        createdAt: nowIso(),
        ...emptyLogbookNotifFields(entry.storeId, entry.id, 'waiting_approval'),
      }),
    );

    if (txs.length) {
      await adminDb.transact(txs);
      schedulePushAfterNotify(txs);
    }
    return res.status(200).json({ ok: true, created: txs.length });
  }

  if (type === 'creator_update') {
    const note = String(body.note || '').trim();
    const recipients = getAssigneeRecipients(entry, profiles, actor.userId);
    const bodyText = [
      'Logbook issue updated by creator',
      `Issue: ${issueSnippet(entry)}`,
      note ? `Update: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const txs = recipients.map((recipientUserId) =>
      adminDb.tx.notifications[id()].update({
        recipientUserId,
        type: 'logbook_creator_update',
        title: 'Logbook issue updated',
        body: bodyText,
        actorUserId: actor.userId,
        actorRole: actor.role,
        readAt: '',
        createdAt: nowIso(),
        ...emptyLogbookNotifFields(
          entry.storeId,
          entry.id,
          entry.status || 'open',
        ),
      }),
    );
    if (txs.length) {
      await adminDb.transact(txs);
      schedulePushAfterNotify(txs);
    }
    return res.status(200).json({ ok: true, created: txs.length });
  }

  // issue_recalled
  {
    const reason = String(body.reason || entry.recallReason || '').trim();
    const recipients = new Set([
      ...getAssigneeRecipients(entry, profiles, actor.userId),
    ]);
    if (entry.authorUserId && entry.authorUserId !== actor.userId) {
      recipients.add(entry.authorUserId);
    }
    const bodyText = [
      'Logbook issue recalled',
      `Issue: ${issueSnippet(entry)}`,
      reason ? `Reason: ${reason}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const txs = [...recipients].map((recipientUserId) =>
      adminDb.tx.notifications[id()].update({
        recipientUserId,
        type: 'logbook_issue_recalled',
        title: 'Logbook issue recalled',
        body: bodyText,
        actorUserId: actor.userId,
        actorRole: actor.role,
        readAt: '',
        createdAt: nowIso(),
        ...emptyLogbookNotifFields(entry.storeId, entry.id, 'recalled'),
      }),
    );
    if (txs.length) {
      await adminDb.transact(txs);
      schedulePushAfterNotify(txs);
    }
    return res.status(200).json({ ok: true, created: txs.length });
  }
}
