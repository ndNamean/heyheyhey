/**
 * POST /api/export/review-status-csv — sync CSV export (Phase 1 testing + direct use).
 */

import { parseBody } from '../lib/export/instant-admin.js';
import { authenticateExportRequest } from '../lib/export/auth.js';
import { assertReviewStatusExportRole } from '../lib/export/rbac.js';
import { generateReviewStatusCsv } from '../lib/export/generators/review-status-csv.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const profileCtx = await authenticateExportRequest(req);
    assertReviewStatusExportRole(profileCtx.role);

    const body = parseBody(req.body) ?? {};
    const result = await generateReviewStatusCsv(profileCtx, body);

    return res.status(200).json({
      csv: result.csv,
      rowCount: result.rowCount,
      truncated: result.truncated,
      warningHeader: result.warningHeader,
    });
  } catch (e) {
    const status = e.status ?? 500;
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Export failed',
    });
  }
}
