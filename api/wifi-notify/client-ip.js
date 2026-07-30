/**
 * GET/POST /api/wifi-notify/client-ip
 * Returns the caller's public IP from trusted proxy headers (master only).
 * Never accepts a body-supplied IP.
 */

import { getAdminDb } from '../_lib/export/instant-admin.js';
import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import { getClientPublicIp } from '../_lib/wifi-notify/request-ip.js';
import { roleCanEditMaster } from '../_lib/wifi-notify/access.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = await verifyRequestUser(req);
    const ctx = await loadProfileContext(userId);
    if (!roleCanEditMaster(ctx.role, ctx.roleDefinition, ctx.roleDefinitions)) {
      return res.status(403).json({ error: 'Forbidden: canEditMaster required' });
    }

    // Touch admin db so missing token fails consistently with other routes.
    getAdminDb();

    const publicIp = getClientPublicIp(req);
    return res.status(200).json({ publicIp });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[wifi-notify/client-ip]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Failed to detect client IP',
    });
  }
}
