/**
 * Export audit logging via Admin SDK.
 */

import { id } from '@instantdb/admin';
import { getAdminDb } from './instant-admin.js';

export async function logExportRequested({
  userId,
  role,
  exportType,
  format,
  dateRangeJson,
  storeScopeJson,
  paramsJson,
  jobId,
}) {
  const adminDb = getAdminDb();
  const logId = id();
  const now = new Date().toISOString();

  await adminDb.transact(
    adminDb.tx.exportAuditLogs[logId].update({
      userId,
      role,
      exportType,
      format,
      dateRangeJson: dateRangeJson ?? '{}',
      storeScopeJson: storeScopeJson ?? '{}',
      paramsJson: paramsJson ?? '{}',
      rowCount: 0,
      truncated: false,
      jobId,
      status: 'requested',
      downloadAt: '',
      createdAt: now,
    }),
  );

  return logId;
}

export async function logExportCompleted(jobId, { rowCount, truncated }) {
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    exportAuditLogs: { $: { where: { jobId, status: 'requested' } } },
  });

  const log = result.exportAuditLogs?.[0];
  if (!log) return;

  await adminDb.transact(
    adminDb.tx.exportAuditLogs[log.id].update({
      status: 'completed',
      rowCount: rowCount ?? 0,
      truncated: truncated ?? false,
    }),
  );
}

export async function logExportFailed(jobId, errorMessage) {
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    exportAuditLogs: { $: { where: { jobId, status: 'requested' } } },
  });

  const log = result.exportAuditLogs?.[0];
  if (!log) return;

  await adminDb.transact(
    adminDb.tx.exportAuditLogs[log.id].update({
      status: 'failed',
      paramsJson: JSON.stringify({ error: errorMessage }),
    }),
  );
}

export async function logExportDownloaded(jobId) {
  const adminDb = getAdminDb();
  const result = await adminDb.query({
    exportAuditLogs: { $: { where: { jobId } } },
  });

  const log = result.exportAuditLogs?.[0];
  if (!log) return;

  await adminDb.transact(
    adminDb.tx.exportAuditLogs[log.id].update({
      status: 'downloaded',
      downloadAt: new Date().toISOString(),
    }),
  );
}
