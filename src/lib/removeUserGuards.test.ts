import { describe, expect, it } from 'vitest';
import { validateRemoveUserTarget } from '../../api/_lib/remove-user-guards.js';

const rejectedStaff = {
  id: 'p1',
  userId: 'u-target',
  role: 'staff',
  approvalStatus: 'rejected',
};

describe('validateRemoveUserTarget', () => {
  it('allows owner to remove a rejected non-owner non-self profile', () => {
    expect(
      validateRemoveUserTarget({
        actorRole: 'owner',
        actorUserId: 'u-owner',
        target: rejectedStaff,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects non-owner actors', () => {
    expect(
      validateRemoveUserTarget({
        actorRole: 'areaManager',
        actorUserId: 'u-am',
        target: rejectedStaff,
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects missing target', () => {
    expect(
      validateRemoveUserTarget({
        actorRole: 'owner',
        actorUserId: 'u-owner',
        target: null,
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it('rejects non-rejected profiles', () => {
    expect(
      validateRemoveUserTarget({
        actorRole: 'owner',
        actorUserId: 'u-owner',
        target: { ...rejectedStaff, approvalStatus: 'approved' },
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects self-removal', () => {
    expect(
      validateRemoveUserTarget({
        actorRole: 'owner',
        actorUserId: 'u-target',
        target: rejectedStaff,
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects removing another owner', () => {
    expect(
      validateRemoveUserTarget({
        actorRole: 'owner',
        actorUserId: 'u-owner',
        target: { ...rejectedStaff, role: 'owner' },
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});
