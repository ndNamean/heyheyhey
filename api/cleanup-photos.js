/**
 * Vercel Serverless — proof photo cleanup (Admin SDK). Plain JS.
 */

import { init } from '@instantdb/admin';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function getCredentials() {
  const appId =
    process.env.VITE_INSTANT_APP_ID ||
    process.env.INSTANT_APP_ID ||
    DEFAULT_APP_ID;

  const adminToken =
    process.env.INSTANT_ADMIN_TOKEN ||
    process.env.INSTANT_APP_ADMIN_TOKEN ||
    process.env.INSTANT_CLI_AUTH_TOKEN ||
    '';

  if (!adminToken) throw new Error('Missing INSTANT_ADMIN_TOKEN');
  return { appId, adminToken };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'];
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (token !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  let appId;
  let adminToken;
  try {
    ({ appId, adminToken } = getCredentials());
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Missing config' });
  }

  const adminDb = init({ appId, adminToken });

  let allRecords;
  try {
    const result = await adminDb.query({
      mediaRecords: { reportResponse: {} },
    });
    allRecords = result.mediaRecords ?? [];
  } catch (e) {
    console.error('[cleanup] query failed', e);
    return res.status(500).json({ error: 'Query failed', detail: String(e) });
  }

  const now = Date.now();
  let deleted = 0;
  let skipped = 0;
  const errors = [];

  for (const record of allRecords) {
    if (record.storageDeleted || !record.storagePath) {
      skipped++;
      continue;
    }

    const response = record.reportResponse;
    const approvedAt = response?.approvedAt;
    if (!approvedAt || response?.status !== 'approved') {
      skipped++;
      continue;
    }

    const approvedTime = new Date(approvedAt).getTime();
    if (Number.isNaN(approvedTime) || now - approvedTime < SEVEN_DAYS_MS) {
      skipped++;
      continue;
    }

    const storagePath = record.storagePath;
    const recordId = record.id;

    try {
      const filesResult = await adminDb.query({
        $files: { $: { where: { path: storagePath } } },
      });
      const fileEntity = filesResult?.$files?.[0];

      if (fileEntity?.id) {
        await adminDb.transact(adminDb.tx.$files[fileEntity.id].delete());
      }

      await adminDb.transact(
        adminDb.tx.mediaRecords[recordId].update({
          deletedAt: new Date().toISOString(),
          storageDeleted: true,
          storageDeletedReason: 'auto_cleanup_after_7_days_reviewed',
        }),
      );

      deleted++;
    } catch (e) {
      errors.push(`Record ${recordId}: ${String(e)}`);
    }
  }

  return res.status(200).json({ deleted, skipped, errors });
}
