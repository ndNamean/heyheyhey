import { db } from '../db';
import type { ExportFormat, ExportType } from '../types';

export interface CreateExportJobParams {
  exportType: ExportType;
  format: ExportFormat;
  startDate?: string;
  endDate?: string;
  filterStoreId?: string;
  scope?: string;
  daysBack?: number;
  limit?: number;
}

export interface ExportJobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl: string | null;
  rowCount: number;
  truncated: boolean;
  warningHeader: string;
  errorMessage: string;
  format: ExportFormat;
  exportType: ExportType;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  // db.getAuth() returns the user object directly (not { user }).
  const user = await db.getAuth();
  const token = user?.refresh_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function createExportJob(
  params: CreateExportJobParams,
): Promise<{ jobId: string; status: string; downloadUrl?: string }> {
  const headers = await getAuthHeaders();
  const resp = await fetch('/api/export/create-job', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error ?? 'Failed to create export job');
  }

  return data;
}

export async function fetchExportJobStatus(jobId: string): Promise<ExportJobStatusResponse> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`/api/export/job-status?jobId=${encodeURIComponent(jobId)}`, {
    headers,
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error ?? 'Failed to check export status');
  }

  return data;
}

export async function ackExportDownload(jobId: string): Promise<void> {
  const headers = await getAuthHeaders();
  await fetch('/api/export/download-ack', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jobId }),
  });
}

export function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function pollExportJob(
  jobId: string,
  onProgress?: (status: ExportJobStatusResponse) => void,
  options?: { intervalMs?: number; timeoutMs?: number },
): Promise<ExportJobStatusResponse> {
  const intervalMs = options?.intervalMs ?? 2000;
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await fetchExportJobStatus(jobId);
    onProgress?.(status);

    if (status.status === 'completed') return status;
    if (status.status === 'failed') {
      throw new Error(status.errorMessage || 'Export failed');
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error('Export timed out');
}

export async function runExportFlow(
  params: CreateExportJobParams,
  onProgress?: (phase: 'creating' | 'generating' | 'ready' | 'failed', detail?: string) => void,
): Promise<ExportJobStatusResponse> {
  onProgress?.('creating');
  const created = await createExportJob(params);

  if (created.status === 'completed' && created.downloadUrl) {
    onProgress?.('ready');
    return {
      jobId: created.jobId,
      status: 'completed',
      downloadUrl: created.downloadUrl,
      rowCount: (created as { rowCount?: number }).rowCount ?? 0,
      truncated: (created as { truncated?: boolean }).truncated ?? false,
      warningHeader: '',
      errorMessage: '',
      format: params.format,
      exportType: params.exportType,
    };
  }

  onProgress?.('generating');
  const result = await pollExportJob(created.jobId, () => onProgress?.('generating'));
  onProgress?.('ready');
  return result;
}
