import { describe, expect, it } from 'vitest';
import {
  canRequestChangeFor,
  canActorFirstApprove,
  canActorFinalApprove,
  canActorCancel,
  resolveApprovers,
  filterUserChangeRequestsForViewer,
} from './userChangeRequests';
import { canAccessUsersPage, canRequestUserChanges } from './roles';
import { defaultDefinitionsAsEntities } from './roleResolver';
import type { Profile, Store, UserChangeRequest } from '../types';

const defs = defaultDefinitionsAsEntities();

const storeA: Store = {
  id: 's1',
  code: 'A',
  name: 'Store A',
  address: '',
  timezone: '',
  active: true,
  createdAt: '',
  updatedAt: '',
} as Store;

const storeB: Store = {
  id: 's2',
  code: 'B',
  name: 'Store B',
  address: '',
  timezone: '',
  active: true,
  createdAt: '',
  updatedAt: '',
} as Store;

function profile(partial: Partial<Profile> & Pick<Profile, 'id' | 'userId' | 'email' | 'role'>): Profile {
  return {
    displayName: partial.displayName ?? partial.email,
    approvalStatus: partial.approvalStatus ?? 'approved',
    stores: partial.stores ?? [],
    createdAt: '',
    updatedAt: '',
    ...partial,
  } as Profile;
}

describe('canRequestUserChanges / canAccessUsersPage', () => {
  it('enables manager and leader; keeps staff/subleader false', () => {
    expect(canRequestUserChanges('manager', defs)).toBe(true);
    expect(canRequestUserChanges('leader', defs)).toBe(true);
    expect(canRequestUserChanges('subleader', defs)).toBe(false);
    expect(canRequestUserChanges('staff', defs)).toBe(false);
    expect(canAccessUsersPage('leader', defs)).toBe(true);
    expect(canAccessUsersPage('staff', defs)).toBe(false);
  });
});

describe('canRequestChangeFor', () => {
  const leader = profile({
    id: 'p-leader',
    userId: 'u-leader',
    email: 'leader@x.com',
    role: 'leader',
    stores: [storeA],
  });
  const staffSame = profile({
    id: 'p-staff',
    userId: 'u-staff',
    email: 'staff@x.com',
    role: 'staff',
    stores: [storeA],
  });
  const staffOtherStore = profile({
    id: 'p-staff2',
    userId: 'u-staff2',
    email: 'staff2@x.com',
    role: 'staff',
    stores: [storeB],
  });
  const peerLeader = profile({
    id: 'p-leader2',
    userId: 'u-leader2',
    email: 'leader2@x.com',
    role: 'leader',
    stores: [storeA],
  });

  it('allows leader for approved lower-rank shared-store users', () => {
    expect(canRequestChangeFor(leader, staffSame, defs)).toBe(true);
  });

  it('blocks self, peers, and non-overlapping stores', () => {
    expect(canRequestChangeFor(leader, leader, defs)).toBe(false);
    expect(canRequestChangeFor(leader, peerLeader, defs)).toBe(false);
    expect(canRequestChangeFor(leader, staffOtherStore, defs)).toBe(false);
  });

  it('blocks pending targets', () => {
    expect(
      canRequestChangeFor(
        leader,
        { ...staffSame, approvalStatus: 'pending' },
        defs,
      ),
    ).toBe(false);
  });
});

describe('resolveApprovers', () => {
  const manager = profile({
    id: 'p-mgr',
    userId: 'u-mgr',
    email: 'mgr@x.com',
    role: 'manager',
    stores: [storeA],
  });
  const owner = profile({
    id: 'p-owner',
    userId: 'u-owner',
    email: 'owner@x.com',
    role: 'owner',
  });
  const admin = profile({
    id: 'p-admin',
    userId: 'u-admin',
    email: 'admin@x.com',
    role: 'admin',
  });
  const profiles = [manager, owner, admin];

  it('routes leader through managers then owner/admin/AM', () => {
    const routing = resolveApprovers({
      requesterUserId: 'u-leader',
      requesterRole: 'leader',
      storeIds: ['s1'],
      profiles,
    });
    expect(routing.needsFirstApproval).toBe(true);
    expect(routing.initialStatus).toBe('pending_first_approval');
    expect(routing.firstApproverUserIds).toEqual(['u-mgr']);
    expect(routing.finalApproverUserIds).toContain('u-owner');
    expect(routing.finalApproverUserIds).toContain('u-admin');
  });

  it('routes manager directly to final approvers', () => {
    const routing = resolveApprovers({
      requesterUserId: 'u-mgr',
      requesterRole: 'manager',
      storeIds: ['s1'],
      profiles,
    });
    expect(routing.needsFirstApproval).toBe(false);
    expect(routing.initialStatus).toBe('pending_final_approval');
    expect(routing.firstApproverUserIds).toEqual([]);
    expect(routing.finalApproverUserIds).not.toContain('u-mgr');
    expect(routing.finalApproverUserIds).toContain('u-owner');
  });

  it('throws when no managers available for leader path', () => {
    expect(() =>
      resolveApprovers({
        requesterUserId: 'u-leader',
        requesterRole: 'leader',
        storeIds: ['s1'],
        profiles: [owner],
      }),
    ).toThrow(/manager/i);
  });
});

describe('approval gates', () => {
  const baseRequest: UserChangeRequest = {
    id: 'r1',
    type: 'role_change',
    status: 'pending_first_approval',
    targetUserId: 'u-staff',
    targetEmail: 'staff@x.com',
    fromRole: 'staff',
    toRole: 'hybrid',
    storeIdsJson: '["s1"]',
    note: '',
    requestedByUserId: 'u-leader',
    firstApproverUserIdsJson: '["u-mgr"]',
    firstApproverUserId: '',
    firstApproverAt: '',
    firstApproverNote: '',
    finalApproverUserIdsJson: '["u-owner"]',
    finalApproverUserId: '',
    finalApproverAt: '',
    finalApproverNote: '',
    rejectionReason: '',
    createdAt: '',
    updatedAt: '',
  };

  const manager = profile({
    id: 'p-mgr',
    userId: 'u-mgr',
    email: 'mgr@x.com',
    role: 'manager',
    stores: [storeA],
  });
  const owner = profile({
    id: 'p-owner',
    userId: 'u-owner',
    email: 'owner@x.com',
    role: 'owner',
  });
  const leader = profile({
    id: 'p-leader',
    userId: 'u-leader',
    email: 'leader@x.com',
    role: 'leader',
    stores: [storeA],
  });

  it('lets assigned manager first-approve; owner can override first step', () => {
    expect(canActorFirstApprove(manager, baseRequest)).toBe(true);
    expect(canActorFirstApprove(owner, baseRequest)).toBe(true);
    expect(canActorFirstApprove(leader, baseRequest)).toBe(false);
  });

  it('lets owner final-approve only in pending_final_approval', () => {
    expect(canActorFinalApprove(owner, baseRequest)).toBe(false);
    expect(
      canActorFinalApprove(owner, { ...baseRequest, status: 'pending_final_approval' }),
    ).toBe(true);
    expect(
      canActorFinalApprove(manager, { ...baseRequest, status: 'pending_final_approval' }),
    ).toBe(false);
  });

  it('lets requester cancel while pending', () => {
    expect(canActorCancel(leader, baseRequest)).toBe(true);
    expect(canActorCancel(manager, baseRequest)).toBe(false);
    expect(canActorCancel(leader, { ...baseRequest, status: 'approved' })).toBe(false);
  });
});

describe('filterUserChangeRequestsForViewer', () => {
  const requests: UserChangeRequest[] = [
    {
      id: 'r1',
      type: 'delete',
      status: 'pending_first_approval',
      targetUserId: 'u-staff',
      targetEmail: 'staff@x.com',
      fromRole: 'staff',
      toRole: '',
      storeIdsJson: '["s1"]',
      note: '',
      requestedByUserId: 'u-leader',
      firstApproverUserIdsJson: '["u-mgr"]',
      firstApproverUserId: '',
      firstApproverAt: '',
      firstApproverNote: '',
      finalApproverUserIdsJson: '["u-owner"]',
      finalApproverUserId: '',
      finalApproverAt: '',
      finalApproverNote: '',
      rejectionReason: '',
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('returns all for owner; scopes manager/leader', () => {
    const owner = profile({ id: 'p-o', userId: 'u-owner', email: 'o@x.com', role: 'owner' });
    const manager = profile({ id: 'p-m', userId: 'u-mgr', email: 'm@x.com', role: 'manager' });
    const other = profile({ id: 'p-x', userId: 'u-other', email: 'x@x.com', role: 'leader' });
    expect(filterUserChangeRequestsForViewer(requests, owner)).toHaveLength(1);
    expect(filterUserChangeRequestsForViewer(requests, manager)).toHaveLength(1);
    expect(filterUserChangeRequestsForViewer(requests, other)).toHaveLength(0);
  });
});
