/**
 * Process a single export job (CSV or PDF).
 */

import { getAdminDb } from './instant-admin.js';
import { loadProfileContext } from './auth.js';
import { assertExportJobAccess } from './rbac.js';
import { generateDashboardCsv } from './generators/dashboard-csv.js';
import { generateReviewStatusCsv } from './generators/review-status-csv.js';
import { generateFailureHistoryCsv } from './generators/failure-history-csv.js';
import { uploadExportFile } from './storage.js';
import {
  logExportCompleted,
  logExportFailed,
} from './audit.js';
import { renderExportPdf } from './pdf/render-pdf.js';

const MEDIA_EXPIRY_FOOTER =
  'Note: Photo/Video links expire 7 days after report approval.';

async function renderPdf(job, profileCtx, params, reports, statusRows) {
  return renderExportPdf({
    exportType: job.exportType,
    format: job.format,
    params,
    profileCtx,
    reports,
    statusRows,
    mediaExpiryFooter: MEDIA_EXPIRY_FOOTER,
  });
}

export async function processExportJob(jobId) {
  const adminDb = getAdminDb();

  const result = await adminDb.query({
    exportJobs: { $: { where: { id: jobId } } },
  });

  const job = result.exportJobs?.[0];
  if (!job) throw new Error('Job not found');
  if (job.status === 'completed') return job;

  if (job.status === 'processing') {
    const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
    const stale = !started || Date.now() - started > 5 * 60 * 1000;
    if (!stale) return job;
  }

  const now = new Date().toISOString();
  await adminDb.transact(
    adminDb.tx.exportJobs[jobId].update({
      status: 'processing',
      startedAt: now,
    }),
  );

  try {
    const profileCtx = await loadProfileContext(job.requesterUserId);
    assertExportJobAccess(profileCtx.role, job.exportType, profileCtx.roleDefinition);

    const params = JSON.parse(job.paramsJson || '{}');
    let content;
    let rowCount = 0;
    let truncated = false;
    let warningHeader = '';
    let reports = [];
    let statusRows = [];

    if (job.format === 'csv') {
      if (job.exportType === 'dashboard') {
        const gen = await generateDashboardCsv(profileCtx, params);
        content = gen.csv;
        rowCount = gen.rowCount;
        truncated = gen.truncated;
        warningHeader = gen.warningHeader;
        reports = gen.reports;
      } else if (job.exportType === 'failure_history') {
        if (job.format !== 'csv') {
          throw new Error('Failure history export supports CSV only');
        }
        const gen = await generateFailureHistoryCsv(profileCtx, params);
        content = gen.csv;
        rowCount = gen.rowCount;
        truncated = gen.truncated;
        warningHeader = gen.warningHeader;
        reports = gen.reports;
      } else {
        const gen = await generateReviewStatusCsv(profileCtx, params);
        content = gen.csv;
        rowCount = gen.rowCount;
        truncated = gen.truncated;
        warningHeader = gen.warningHeader;
        statusRows = gen.statusRows;
        reports = gen.reports;
      }
    } else if (job.format === 'pdf') {
      if (job.exportType === 'dashboard') {
        const gen = await generateDashboardCsv(profileCtx, params);
        reports = gen.reports;
        rowCount = gen.rowCount;
        truncated = gen.truncated;
        warningHeader = gen.warningHeader;
      } else {
        const gen = await generateReviewStatusCsv(profileCtx, params);
        statusRows = gen.statusRows;
        reports = gen.reports;
        rowCount = gen.rowCount;
        truncated = gen.truncated;
        warningHeader = gen.warningHeader;
      }
      content = await renderPdf(job, profileCtx, params, reports, statusRows);
    } else {
      throw new Error(`Unsupported format: ${job.format}`);
    }

    const { filePath, downloadUrl } = await uploadExportFile(jobId, job.format, content);

    const completedAt = new Date().toISOString();
    await adminDb.transact(
      adminDb.tx.exportJobs[jobId].update({
        status: 'completed',
        rowCount,
        truncated,
        warningHeader,
        filePath,
        downloadUrl,
        completedAt,
        errorMessage: '',
      }),
    );

    await logExportCompleted(jobId, { rowCount, truncated });

    const updated = await adminDb.query({
      exportJobs: { $: { where: { id: jobId } } },
    });
    return updated.exportJobs?.[0];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await adminDb.transact(
      adminDb.tx.exportJobs[jobId].update({
        status: 'failed',
        errorMessage: msg,
        completedAt: new Date().toISOString(),
      }),
    );
    await logExportFailed(jobId, msg);
    throw e;
  }
}

export async function processPendingJobs(limit = 5) {
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    exportJobs: {},
  });

  const staleMs = 5 * 60 * 1000;
  const now = Date.now();

  const jobs = (result.exportJobs ?? [])
    .filter((job) => {
      if (job.status === 'pending') return true;
      if (job.status === 'processing') {
        const started = job.startedAt ? new Date(job.startedAt).getTime() : 0;
        return !started || now - started > staleMs;
      }
      return false;
    })
    .slice(0, limit);
  const outcomes = [];

  for (const job of jobs) {
    try {
      const completed = await processExportJob(job.id);
      outcomes.push({ jobId: job.id, status: completed?.status ?? 'completed' });
    } catch (e) {
      outcomes.push({
        jobId: job.id,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return outcomes;
}
