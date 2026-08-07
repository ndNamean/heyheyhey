import { describe, expect, it } from 'vitest';
import {
  roleCanCreateGroupChat,
  roleCanCreateCrossStoreGroupChat,
  assertInviteeEligible,
} from '../../api/_lib/group-chat/capabilities.js';

describe('group-chat capabilities (server)', () => {
  it('defaults create for operational roles', () => {
    expect(roleCanCreateGroupChat({ role: 'manager', roleDefinition: null })).toBe(true);
    expect(roleCanCreateGroupChat({ role: 'staff', roleDefinition: null })).toBe(false);
    expect(roleCanCreateGroupChat({ role: 'viewer', roleDefinition: null })).toBe(false);
  });

  it('respects roleDefinition booleans', () => {
    expect(
      roleCanCreateGroupChat({
        role: 'staff',
        roleDefinition: { canCreateGroupChat: true },
      }),
    ).toBe(true);
    expect(
      roleCanCreateCrossStoreGroupChat({
        role: 'subleader',
        roleDefinition: { canCreateCrossStoreGroupChat: false },
      }),
    ).toBe(false);
  });

  it('blocks cross-store invitees without capability', () => {
    const actor = { userId: 'a', storeIds: ['s1'] };
    const invitee = {
      userId: 'b',
      approvalStatus: 'approved',
      stores: [{ id: 's2' }],
    };
    expect(assertInviteeEligible(actor, invitee, false)).toMatch(/cross-store/i);
    expect(assertInviteeEligible(actor, invitee, true)).toBeNull();
  });
});
