/**
 * POST /api/export/process-jobs — worker (cron + fire-and-forget).
 */

import { verifyCronSecret } from '../lib/export/instant-admin.js';
import { processExportJob, processPendingJobs } from '../lib/export/job-runner.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const jobId = req.query.jobId;

    if (jobId && typeof jobId === 'string') {
      const job = await processExportJob(jobId);
      return res.status(200).json({ processed: 1, outcomes: [{ jobId, status: job?.status }] });
    }

    const outcomes = await processPendingJobs(5);
    return res.status(200).json({ processed: outcomes.length, outcomes });
  } catch (e) {
    console.error('[process-jobs]', e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Worker failed',
    });
  }
}
