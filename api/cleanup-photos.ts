/**
 * Vercel Serverless Function — Proof-photo storage cleanup
 *
 * Invoked daily by Vercel Cron (see vercel.json).
 * Uses the InstantDB Admin SDK (bypasses client permissions) to:
 *   1. Find mediaRecords where the storage file has not yet been deleted AND
 *      the linked reportResponse has been approved for ≥ 7 days.
 *   2. Delete the actual $files entity (which removes the S3 object).
 *   3. Mark the mediaRecord as deleted in metadata (report audit trail is kept).
 *
 * Required environment variables (set in Vercel dashboard):
 *   VITE_INSTANT_APP_ID   — public app ID (already in .env.production)
 *   INSTANT_ADMIN_TOKEN   — secret admin token (never commit to git)
 *   CRON_SECRET           — shared secret; Vercel Cron sends Authorization: Bearer <secret>
 */

import { init } from '@instantdb/admin';

const APP_ID      = process.env.VITE_INSTANT_APP_ID ?? '';
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN ?? '';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ── Minimal Vercel handler types (avoids needing @vercel/node as a dep) ────
interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
}

export default async function handler(req: Req, res: Res) {
  // ── Auth: only Vercel Cron or a call with CRON_SECRET may proceed ─────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'];
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (token !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!APP_ID || !ADMIN_TOKEN) {
    return res.status(500).json({ error: 'Missing VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN' });
  }

  const adminDb = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

  // ── 1. Fetch all non-deleted mediaRecords with their reportResponse ────────
  let allRecords: Array<Record<string, unknown>>;
  try {
    const result = await adminDb.query({
      mediaRecords: { reportResponse: {} },
    } as Parameters<typeof adminDb.query>[0]);

    allRecords = ((result as { mediaRecords?: Array<Record<string, unknown>> }).mediaRecords ?? []);
  } catch (e) {
    console.error('[cleanup] Failed to query mediaRecords:', e);
    return res.status(500).json({ error: 'Query failed', detail: String(e) });
  }

  const now = Date.now();
  let deleted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const record of allRecords) {
    // Skip records already cleaned up or missing the storage path
    if (record.storageDeleted || !record.storagePath) { skipped++; continue; }

    // The forward link label is 'reportResponse' (see mediaRecordResponse link in schema)
    const response = record.reportResponse as Record<string, unknown> | undefined;
    const approvedAt = response?.approvedAt as string | undefined;

    // Only clean up photos from *approved* responses
    if (!approvedAt || response?.status !== 'approved') { skipped++; continue; }

    // Check the 7-day eligibility window
    const approvedTime = new Date(approvedAt).getTime();
    if (isNaN(approvedTime) || now - approvedTime < SEVEN_DAYS_MS) { skipped++; continue; }

    const storagePath = record.storagePath as string;
    const recordId    = record.id as string;

    try {
      // ── 2a. Look up the $files entity by path to get its ID ───────────────
      const filesResult = await adminDb.query({
        $files: { $: { where: { path: storagePath } } },
      } as Parameters<typeof adminDb.query>[0]);

      const fileEntity = ((filesResult as { $files?: Array<{ id: string }> }).$files ?? [])[0];

      if (fileEntity?.id) {
        // ── 2b. Delete the $files entity (removes the S3 object too) ─────────
        // @ts-expect-error — admin tx types are not generic over schema
        await adminDb.transact(adminDb.tx.$files[fileEntity.id].delete());
      }
      // If fileEntity is missing the file was already removed — still mark as deleted below.

      // ── 3. Update mediaRecord metadata (keep audit trail) ─────────────────
      const deletedAt = new Date().toISOString();
      // @ts-expect-error — admin tx types are not generic over schema
      await adminDb.transact(
        // @ts-expect-error
        adminDb.tx.mediaRecords[recordId].update({
          deletedAt,
          storageDeleted:       true,
          storageDeletedReason: 'auto_cleanup_after_7_days_reviewed',
        }),
      );

      deleted++;
      console.log(`[cleanup] ✓ Deleted photo ${recordId} path=${storagePath}`);
    } catch (e) {
      const msg = `Record ${recordId}: ${String(e)}`;
      errors.push(msg);
      console.error(`[cleanup] ✗ ${msg}`);
    }
  }

  console.log(`[cleanup] Done — deleted=${deleted} skipped=${skipped} errors=${errors.length}`);
  return res.status(200).json({ deleted, skipped, errors });
}
