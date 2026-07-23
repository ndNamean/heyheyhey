/**
 * Vercel Serverless — Logbook Admin SDK actions.
 * - type submit_resolution: Stage A (status + resolutionMedia + timeline)
 * - type resolution_submitted | creator_update | issue_recalled: Stage B inbox
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

function nowIso() {
  return new Date().toISOString();
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
  };
}

function profileStoreIds(profile) {
  return (profile.stores ?? []).map((s) => s.id);
}

function hasStoreAccess(profile, storeId) {
  if (!storeId) return false;
  const ids = profileStoreIds(profile);
  if (ids.includes(storeId)) return true;
  const role = profile.role || '';
  return role === 'owner' || role === 'areaManager' || role === 'admin';
}

function issueSnippet(entry) {
  return String(entry.content || '').trim().slice(0, 120) || 'Logbook issue';
}

function isIssue(entry) {
  return String(entry?.entryType || '') === 'issue';
}

function canSubmitResolution(actor, entry) {
  if (!isIssue(entry)) return false;
  const status = String(entry.status || '');
  if (status !== 'open' && status !== 'in_progress') return false;
  if (actor.approvalStatus !== 'approved') return false;
  if (!entry.storeId || !hasStoreAccess(actor, entry.storeId)) return false;
  const assignee = String(entry.assigneeRole || '').trim();
  if (!assignee || actor.role !== assignee) return false;
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
  const recipients = new Set();
  for (const p of profiles) {
    if (actorUserId && p.userId === actorUserId) continue;
    if (p.approvalStatus !== 'approved') continue;
    if (p.role !== role) continue;
    if (!hasStoreAccess(p, entry.storeId)) continue;
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
  const fileId = String(body.fileId || '').trim();

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

  const priorResolutionId = entry.resolutionMedia?.id || '';
  const priorPhotoId = entry.photo?.id || '';
  const historyIds = new Set(
    (entry.resolutionProofHistory || [])
      .map((f) => f?.id)
      .filter(Boolean),
  );
  const prevStatus = String(entry.status || 'in_progress');
  const createdAt = nowIso();
  const displayName =
    actor.displayName?.trim() ||
    actor.email?.split('@')[0] ||
    actor.userId;

  const txs = [];

  // Preserve prior proof in append-only history before replacing the one-slot current.
  if (priorResolutionId && !historyIds.has(priorResolutionId)) {
    txs.push(
      adminDb.tx.logbookEntries[entryId].link({
        resolutionProofHistory: priorResolutionId,
      }),
    );
    historyIds.add(priorResolutionId);
  }

  if (priorResolutionId) {
    txs.push(
      adminDb.tx.logbookEntries[entryId].unlink({
        resolutionMedia: priorResolutionId,
      }),
    );
  }
  if (priorPhotoId && priorPhotoId === priorResolutionId) {
    txs.push(adminDb.tx.logbookEntries[entryId].unlink({ photo: priorPhotoId }));
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

  if (fileId) {
    if (!historyIds.has(fileId)) {
      txs.push(
        adminDb.tx.logbookEntries[entryId].link({
          resolutionProofHistory: fileId,
        }),
      );
    }
    txs.push(
      adminDb.tx.logbookEntries[entryId].link({ resolutionMedia: fileId }),
    );
  }

  const eventNote = [
    note,
    `attempt:${attemptId}`,
    priorResolutionId ? `priorFileId:${priorResolutionId}` : '',
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
    }
    return res.status(200).json({ ok: true, created: txs.length });
  }
}
