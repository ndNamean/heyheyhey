/**
 * POST /api/export/create-job — create async export job.
 */

import { id } from '@instantdb/admin';
import { getAdminDb, parseBody } from '../_lib/export/instant-admin.js';
import { authenticateExportRequest } from '../_lib/export/auth.js';
import { assertExportJobAccess } from '../_lib/export/rbac.js';
import { resolveDashboardScope, resolveReviewStatusScope } from '../_lib/export/scope.js';
import { logExportRequested } from '../_lib/export/audit.js';
import { processExportJob } from '../_lib/export/job-runner.js';

const INLINE_BUDGET_MS = 5000;

function triggerBackgroundProcess(jobId, host) {
  const base = host ? `https://${host}` : '';
  if (!base) return;
  fetch(`${base}/api/export/process-jobs?jobId=${encodeURIComponent(jobId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
    },
  }).catch((err) => console.error('[create-job] background trigger failed', err));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const profileCtx = await authenticateExportRequest(req);
    const body = parseBody(req.body) ?? {};

    const exportType = body.exportType;
    const format = body.format === 'pdf' ? 'pdf' : 'csv';

    if (!exportType || !['dashboard', 'review_status'].includes(exportType)) {
      return res.status(400).json({ error: 'Invalid exportType' });
    }

    assertExportJobAccess(profileCtx.role, exportType);

    let scopeMeta;
    if (exportType === 'dashboard') {
      scopeMeta = resolveDashboardScope(profileCtx, body);
    } else {
      scopeMeta = resolveReviewStatusScope(profileCtx, body);
    }

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
  } catch (e) {
    const status = e.status ?? 500;
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Failed to create export job',
    });
  }
}
