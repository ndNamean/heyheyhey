/**
 * Pure guards for owner hard-remove of a rejected profile.
 * Used by api/remove-user.js; kept free of Instant deps for unit tests.
 */

const OWNER_ROLE = 'owner';

/**
 * @param {object} params
 * @param {string} params.actorRole
 * @param {string} params.actorUserId
 * @param {object|null|undefined} params.target
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
export function validateRemoveUserTarget({ actorRole, actorUserId, target }) {
  if (actorRole !== OWNER_ROLE) {
    return { ok: false, status: 403, error: 'Forbidden: owner only' };
  }
  if (!target) {
    return { ok: false, status: 404, error: 'Profile not found' };
  }
  if (target.approvalStatus !== 'rejected') {
    return { ok: false, status: 400, error: 'Profile must be rejected before removal' };
  }
  if (target.userId === actorUserId) {
    return { ok: false, status: 400, error: 'Cannot remove your own profile' };
  }
  if (target.role === OWNER_ROLE) {
    return { ok: false, status: 400, error: 'Cannot remove owner profile' };
  }
  return { ok: true };
}
