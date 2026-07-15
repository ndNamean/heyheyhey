/**
 * Legacy endpoint — forwards to /api/invites?action=create
 * so older clients keep working.
 */

import handler from './invites.js';

export default async function legacyInviteUser(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  req.query = { ...(req.query || {}), action: 'create' };
  return handler(req, res);
}
