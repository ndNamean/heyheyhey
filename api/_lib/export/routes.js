/**
 * Unified export API handler (bundled into api/export.js).
 * Actions: create (POST), status (GET), ack (POST), process (POST cron).
 */

import { id } from '@instantdb/admin';
import {
  getAdminDb,
  parseBody,
  verifyCronSecret,
} from './instant-admin.js';
import { authenticateExportRequest } from './auth.js';
import { assertExportJobAccess } from './rbac.js';
import { resolveDashboardScope, resolveReviewStatusScope } from './scope.js';
import { logExportRequested, logExportDownloaded } from './audit.js';
import { processExportJob, processPendingJobs } from './job-runner.js';

const INLINE_BUDGET_MS = 5000;

function triggerBackgroundProcess(jobId, host) {
  const base = host ? `https://${host}` : '';
  if (!base) return;
  fetch(`${base}/api/export?action=process&jobId=${encodeURIComponent(jobId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
    },
  }).catch((err) => console.error('[export] background trigger failed', err));
}

async function handleCreate(req, res) {
  const profileCtx = await authenticateExportRequest(req);
  const body = parseBody(req.body) ?? {};

  const exportType = body.exportType;
  const format = body.format === 'pdf' ? 'pdf' : 'csv';

  if (!exportType || !['dashboard', 'review_status'].includes(exportType)) {
    return res.status(400).json({ error: 'Invalid exportType' });
  }

  assertExportJobAccess(profileCtx.role, exportType, profileCtx.roleDefinition);

  const scopeMeta =
    exportType === 'dashboard'
      ? resolveDashboardScope(profileCtx, body)
      : resolveReviewStatusScope(profileCtx, body);

  const jobId = id();
  const now = new Date().toISOString();
  const adminDb = getAdminDb();
  const paramsJson = JSON.stringify(body);

  await adminDb.transact(
    adminDb.tx.exportJobs[jobId].update({
      requesterUserId: profileCtx.userId,
      exportType,
      format,
      status: 'pending',
      paramsJson,
      rowCount: 0,
      truncated: false,
      warningHeader: '',
      filePath: '',
      downloadUrl: '',
      errorMessage: '',
      startedAt: '',
      completedAt: '',
      createdAt: now,
    }),
  );

  await logExportRequested({
    userId: profileCtx.userId,
    role: profileCtx.role,
    exportType,
    format,
    dateRangeJson: scopeMeta.dateRangeJson,
    storeScopeJson: scopeMeta.storeScopeJson,
    paramsJson,
    jobId,
  });

  const start = Date.now();
  let completedInline = false;

  try {
    const job = await processExportJob(jobId);
    if (job?.status === 'completed' && Date.now() - start < INLINE_BUDGET_MS) {
      completedInline = true;
      return res.status(200).json({
        jobId,
        status: 'completed',
        downloadUrl: job.downloadUrl,
        rowCount: job.rowCount,
        truncated: job.truncated,
      });
    }
  } catch {
    await adminDb.transact(
      adminDb.tx.exportJobs[jobId].update({
        status: 'pending',
        errorMessage: '',
        startedAt: '',
      }),
    );
  }

  if (!completedInline) {
    triggerBackgroundProcess(jobId, req.headers.host);
  }

  return res.status(202).json({ jobId, status: 'pending' });
}

async function handleStatus(req, res) {
  const profileCtx = await authenticateExportRequest(req);
  const jobId = req.query.jobId;
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'Missing jobId' });
  }

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    exportJobs: { $: { where: { id: jobId } } },
  });

  const job = result.exportJobs?.[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.requesterUserId !== profileCtx.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return res.status(200).json({
    jobId: job.id,
    status: job.status,
    downloadUrl: job.downloadUrl || null,
    rowCount: job.rowCount ?? 0,
    truncated: job.truncated ?? false,
    warningHeader: job.warningHeader ?? '',
    errorMessage: job.errorMessage ?? '',
    format: job.format,
    exportType: job.exportType,
  });
}

async function handleAck(req, res) {
  const profileCtx = await authenticateExportRequest(req);
  const body = parseBody(req.body) ?? {};
  const jobId = body.jobId;
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });

  const adminDb = getAdminDb();
  const result = await adminDb.query({
    exportJobs: { $: { where: { id: jobId } } },
  });

  const job = result.exportJobs?.[0];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.requesterUserId !== profileCtx.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await logExportDownloaded(jobId);
  return res.status(200).json({ ok: true });
}

async function handleProcess(req, res) {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const jobId = req.query.jobId;
  if (jobId && typeof jobId === 'string') {
    const job = await processExportJob(jobId);
    return res.status(200).json({ processed: 1, outcomes: [{ jobId, status: job?.status }] });
  }

  const outcomes = await processPendingJobs(5);
  return res.status(200).json({ processed: outcomes.length, outcomes });
}

export default async function handler(req, res) {
  const actionFromQuery =
    typeof req.query.action === 'string' ? req.query.action : '';

  // Vercel Cron sends GET to the path with CRON_SECRET Authorization.
  const isCronGet =
    req.method === 'GET' &&
    verifyCronSecret(req) &&
    !req.query.jobId &&
    (!actionFromQuery || actionFromQuery === 'process');

  const action =
    actionFromQuery ||
    (isCronGet ? 'process' : req.method === 'GET' ? 'status' : 'create');

  try {
    if (action === 'create' && req.method === 'POST') {
      return await handleCreate(req, res);
    }
    if (action === 'status' && req.method === 'GET') {
      return await handleStatus(req, res);
    }
    if (action === 'ack' && req.method === 'POST') {
      return await handleAck(req, res);
    }
    if (action === 'process' && (req.method === 'POST' || req.method === 'GET')) {
      return await handleProcess(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[export]', e);
    const status = e.status ?? 500;
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Export request failed',
    });
  }
}
