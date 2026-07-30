/**
 * GET/POST /api/push/vapid-public-key
 * Returns VAPID public key only (never the private key).
 */

import { verifyRequestUser, loadProfileContext } from '../_lib/export/auth.js';
import { getVapidConfig } from '../_lib/push/web-push-send.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = await verifyRequestUser(req);
    await loadProfileContext(userId);
    const { publicKey } = getVapidConfig();
    return res.status(200).json({ publicKey });
  } catch (e) {
    const status = e?.status || 500;
    console.error('[push/vapid-public-key]', e);
    return res.status(status).json({
      error: e instanceof Error ? e.message : 'Failed to load VAPID public key',
    });
  }
}
