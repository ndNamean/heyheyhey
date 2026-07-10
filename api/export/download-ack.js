/**
 * POST /api/export/download-ack — record download timestamp for audit.
 */

import { parseBody } from '../_lib/export/instant-admin.js';
import { authenticateExportRequest } from '../_lib/export/auth.js';
import { logExportDownloaded } from '../_lib/export/audit.js';
import { getAdminDb } from '../_lib/export/instant-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const profileCtx = await authenticateExportRequest(req);
    const body = parseBody(req.body) ?? {};
    const jobId = body.jobId;

    if (!jobId) {
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

    await logExportDownloaded(jobId);

    return res.status(200).json({ ok: true });
  } catch (e) {
    const status = e.status ?? 500;
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Download ack failed',
    });
  }
}
