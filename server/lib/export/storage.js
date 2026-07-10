/**
 * Upload export files to Instant Storage.
 */

import { getAdminDb } from './instant-admin.js';

export async function uploadExportFile(jobId, format, content) {
  const adminDb = getAdminDb();
  const ext = format === 'pdf' ? 'pdf' : 'csv';
  const path = `exports/${jobId}.${ext}`;
  const contentType = format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8';

  const buffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, format === 'pdf' ? undefined : 'utf8');

  const { data: fileData } = await adminDb.storage.uploadFile(path, buffer, {
    contentType,
  });

  if (!fileData?.id) throw new Error('Export upload returned no file ID');

  const filesResult = await adminDb.query({
    $files: { $: { where: { id: fileData.id } } },
  });

  const downloadUrl = filesResult?.$files?.[0]?.url ?? '';

  return { filePath: path, downloadUrl, fileId: fileData.id };
}
