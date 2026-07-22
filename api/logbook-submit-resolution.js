/**
 * Vercel Serverless — Logbook Stage A resolution commit (Admin SDK).
 * Staff client Instant link({ resolutionMedia }) still hits not perms-pass;
 * this route commits lifecycle + media + timeline after auth/assignee checks.
 */

import { id } from '@instantdb/admin';
import { getAdminDb, parseBody } from './_lib/export/instant-admin.js';
import {
  loadProfileContext,
  verifyRequestUser,
} from './_lib/export/auth.js';

function nowIso() {
  return new Date().toISOString();
}

function profileStoreIds(profile) {
  return (profile.stores ?? []).map((s) => s.id);
}

function hasStoreAccess(profile, storeId) {
  if (!storeId) return false;
  if (profileStoreIds(profile).includes(storeId)) return true;
  const role = profile.role || '';
  return role === 'owner' || role === 'areaManager' || role === 'admin';
}

function isIssue(entry) {
  return String(entry?.entryType || '') === 'issue';
}

function canSubmit(actor, entry) {
  if (!isIssue(entry)) return false;
  const status = String(entry.status || '');
  if (status !== 'open' && status !== 'in_progress') return false;
  if (actor.approvalStatus !== 'approved') return false;
  if (!entry.storeId || !hasStoreAccess(actor, entry.storeId)) return false;
  const assignee = String(entry.assigneeRole || '').trim();
  if (!assignee || actor.role !== assignee) return false;
  return true;
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
  const entryId = String(body.entryId || '').trim();
  const attemptId = String(body.attemptId || body.resolutionAttemptId || '').trim();
  const note = String(body.note || '').trim();
  const resolutionNumber = String(body.resolutionNumber || '').trim();
  const resolutionChecked = Boolean(body.resolutionChecked);
  const fileId = String(body.fileId || '').trim();

  if (!entryId || !attemptId) {
    return res.status(400).json({ error: 'Missing entryId or attemptId' });
  }

  const adminDb = getAdminDb();

  let entry;
  try {
    const result = await adminDb.query({
      logbookEntries: {
        $: { where: { id: entryId } },
        photo: {},
        resolutionMedia: {},
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

  if (!canSubmit(actor, entry)) {
    return res.status(403).json({
      error: 'Cannot submit resolution for this issue',
    });
  }

  // Idempotent: same attempt already committed
  if (
    entry.resolutionAttemptId === attemptId &&
    entry.status === 'waiting_approval' &&
    entry.resolutionSubmittedByUserId === actor.userId
  ) {
    return res.status(200).json({ ok: true, deduped: true });
  }

  const priorResolutionId = entry.resolutionMedia?.id || '';
  const priorPhotoId = entry.photo?.id || '';
  const prevStatus = String(entry.status || 'in_progress');
  const createdAt = nowIso();
  const displayName =
    actor.displayName?.trim() ||
    actor.email?.split('@')[0] ||
    actor.userId;

  const txs = [];

  if (priorResolutionId) {
    txs.push(
      adminDb.tx.logbookEntries[entryId].unlink({
        resolutionMedia: priorResolutionId,
      }),
    );
  }
  // Do not dual-link the same file to photo + resolutionMedia (Instant client deny).
  // Clear legacy photo only when it was the prior resolution proof.
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
    txs.push(
      adminDb.tx.logbookEntries[entryId].link({ resolutionMedia: fileId }),
    );
  }

  const eventNote = [note, `attempt:${attemptId}`, priorResolutionId ? `priorFileId:${priorResolutionId}` : '']
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
