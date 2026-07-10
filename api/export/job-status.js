/**
 * GET /api/export/job-status — poll export job status.
 */

import { getAdminDb } from '../../server/lib/export/instant-admin.js';
import { authenticateExportRequest } from '../../server/lib/export/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

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
  } catch (e) {
    const status = e.status ?? 500;
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Status check failed',
    });
  }
}
