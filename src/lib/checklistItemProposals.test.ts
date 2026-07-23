import { describe, expect, it } from 'vitest';
import {
  canFinalApproveTemplateItemProposal,
  canFirstApproveTemplateItemProposal,
  canProposeTemplateItem,
  canPublishTemplateItemProposal,
} from './roles';
import {
  computeChecklistItemProposalMetrics,
  findSimilarChecklistItemsAndProposals,
  normalizeComparableText,
  resolveChecklistItemProposalApprovers,
  canActorElevatedFullApprove,
  canActorFinalApprove,
  canActorFirstApprove,
  canActorPublish,
  canActorRequestApprovalCheck,
} from './checklistItemProposals';
import type { ChecklistItemProposal, Profile, TemplateItem } from '../types';

function profile(partial: Partial<Profile> & Pick<Profile, 'userId' | 'role'>): Profile {
  return {
    id: partial.id ?? `id-${partial.userId}`,
    userId: partial.userId,
    email: partial.email ?? `${partial.userId}@ex.com`,
    displayName: partial.displayName ?? partial.userId,
    role: partial.role,
    approvalStatus: partial.approvalStatus ?? 'approved',
    approvedAt: '',
    approvedByEmail: '',
    createdAt: '',
    updatedAt: '',
    stores: partial.stores ?? [{ id: 'store-1', code: 'S1', name: 'Store 1', address: '', area: '', lat: 0, lng: 0, geofenceRadiusM: 0, active: true, createdAt: '', updatedAt: '' }],
  };
}

describe('checklist item proposal role defaults', () => {
  it('allows subleader/leader/manager to propose and blocks staff/hybrid/viewer', () => {
    expect(canProposeTemplateItem('staff')).toBe(false);
    expect(canProposeTemplateItem('hybrid')).toBe(false);
    expect(canProposeTemplateItem('viewer')).toBe(false);
    expect(canProposeTemplateItem('subleader')).toBe(true);
    expect(canProposeTemplateItem('leader')).toBe(true);
    expect(canProposeTemplateItem('manager')).toBe(true);
    expect(canProposeTemplateItem('owner')).toBe(false);
  });

  it('sets first/final/publish capabilities per plan defaults', () => {
    expect(canFirstApproveTemplateItemProposal('manager')).toBe(true);
    expect(canFirstApproveTemplateItemProposal('subleader')).toBe(false);
    expect(canFinalApproveTemplateItemProposal('areaManager')).toBe(true);
    expect(canFinalApproveTemplateItemProposal('manager')).toBe(false);
    expect(canPublishTemplateItemProposal('admin')).toBe(true);
    expect(canPublishTemplateItemProposal('manager')).toBe(false);
  });
});

describe('resolveChecklistItemProposalApprovers', () => {
  const profiles = [
    profile({ userId: 'u-sub', role: 'subleader' }),
    profile({ userId: 'u-lead', role: 'leader' }),
    profile({ userId: 'u-mgr', role: 'manager' }),
    profile({ userId: 'u-am', role: 'areaManager', stores: [] }),
    profile({ userId: 'u-admin', role: 'admin', stores: [] }),
    profile({ userId: 'u-owner', role: 'owner', stores: [] }),
  ];

  it('routes subleader through manager then area manager', () => {
    const r = resolveChecklistItemProposalApprovers({
      requesterUserId: 'u-sub',
      requesterRole: 'subleader',
      requesterStoreId: 'store-1',
      profiles,
    });
    expect(r.firstApproverRole).toBe('manager');
    expect(r.firstApproverUserIds).toContain('u-mgr');
    expect(r.finalApproverRole).toBe('areaManager');
    expect(r.finalApproverUserIds).toContain('u-am');
  });

  it('routes manager through area manager then admin/owner', () => {
    const r = resolveChecklistItemProposalApprovers({
      requesterUserId: 'u-mgr',
      requesterRole: 'manager',
      requesterStoreId: 'store-1',
      profiles,
    });
    expect(r.firstApproverRole).toBe('areaManager');
    expect(r.finalApproverUserIds).toEqual(expect.arrayContaining(['u-admin', 'u-owner']));
  });

  it('rejects staff proposers', () => {
    expect(() =>
      resolveChecklistItemProposalApprovers({
        requesterUserId: 'u-staff',
        requesterRole: 'staff',
        requesterStoreId: 'store-1',
        profiles,
      }),
    ).toThrow(/Sub-Leader/i);
  });
});

describe('similarity and metrics', () => {
  it('normalizes and finds similar titles', () => {
    expect(normalizeComparableText('Check Fridge!')).toBe('check fridge');
    const items: TemplateItem[] = [
      {
        id: 'i1',
        section: 'Cold',
        title: 'Check refrigerator temperature',
        requirement: 'Record temp',
        proofType: 'number',
        required: true,
        assignedRole: 'staff',
        approverRolesJson: '[]',
        weight: 1,
        failureCategory: 'Hygiene',
        sortOrder: 0,
      },
    ];
    const matches = findSimilarChecklistItemsAndProposals({
      title: 'Check refrigerator temperature',
      requirement: 'Something else',
      templateItems: items,
      proposals: [],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe('item');
  });

  it('computes approval and publication rates excluding pending', () => {
    const proposals = [
      { status: 'pending_first_approval' },
      { status: 'approved' },
      { status: 'published' },
      { status: 'rejected' },
      { status: 'cancelled' },
    ] as ChecklistItemProposal[];
    const m = computeChecklistItemProposalMetrics(proposals);
    expect(m.total).toBe(5);
    expect(m.fullyApproved).toBe(2);
    expect(m.rejected).toBe(1);
    expect(m.approvalRate).toBeCloseTo(66.7, 0);
    expect(m.publicationRate).toBe(50);
  });
});

describe('approval actor guards', () => {
  const base: ChecklistItemProposal = {
    id: 'p1',
    templateId: 't1',
    templateNameSnapshot: 'Daily',
    templateVersionSnapshot: '',
    sourceStoreId: 'store-1',
    affectedStoreIdsJson: '[]',
    requestedByUserId: 'u-sub',
    requesterNameSnapshot: 'Sub',
    requesterRoleSnapshot: 'subleader',
    requesterStoreId: 'store-1',
    section: 'A',
    title: 'Item',
    requirement: 'Req',
    reason: 'Why',
    proofType: 'tick',
    assignedRole: 'staff',
    failureCategory: 'Hygiene',
    required: true,
    completionTime: '',
    sourceReportId: '',
    supportingEvidenceJson: '',
    proposedItemJson: '',
    status: 'pending_first_approval',
    firstApproverUserIdsJson: '["u-mgr"]',
    firstApproverRole: 'manager',
    firstApproverUserId: '',
    firstApprovedAt: '',
    firstApprovalComment: '',
    finalApproverUserIdsJson: '["u-am"]',
    finalApproverRole: 'areaManager',
    finalApproverUserId: '',
    finalApprovedAt: '',
    finalApprovalComment: '',
    rejectedByUserId: '',
    rejectedAt: '',
    rejectionReason: '',
    publishedAt: '',
    publishedByUserId: '',
    resultingTemplateItemId: '',
    similarityWarningJson: '[]',
    duplicateOverrideReason: '',
    createdAt: '',
    updatedAt: '',
  };

  it('blocks self first approval', () => {
    const actor = profile({ userId: 'u-sub', role: 'manager' });
    expect(canActorFirstApprove(actor, base)).toBe(false);
  });

  it('allows assigned manager first approval', () => {
    const actor = profile({ userId: 'u-mgr', role: 'manager' });
    expect(canActorFirstApprove(actor, base)).toBe(true);
  });

  it('allows owner/admin first approval even when not assigned', () => {
    const owner = profile({ userId: 'u-owner', role: 'owner', stores: [] });
    const admin = profile({ userId: 'u-admin', role: 'admin', stores: [] });
    expect(canActorFirstApprove(owner, base)).toBe(true);
    expect(canActorFirstApprove(admin, base)).toBe(true);
    expect(canActorElevatedFullApprove(owner, base)).toBe(true);
    expect(canActorRequestApprovalCheck(admin, base)).toBe(true);
  });

  it('allows owner/admin final approval even when not assigned', () => {
    const pendingFinal = {
      ...base,
      status: 'pending_final_approval',
      firstApproverUserId: 'u-mgr',
    } as ChecklistItemProposal;
    const owner = profile({ userId: 'u-owner', role: 'owner', stores: [] });
    expect(canActorFinalApprove(owner, pendingFinal)).toBe(true);
    expect(canActorElevatedFullApprove(owner, pendingFinal)).toBe(true);
  });

  it('blocks same person from final after first', () => {
    const actor = profile({ userId: 'u-am', role: 'areaManager' });
    const pendingFinal = {
      ...base,
      status: 'pending_final_approval',
      firstApproverUserId: 'u-am',
    } as ChecklistItemProposal;
    expect(canActorFinalApprove(actor, pendingFinal)).toBe(false);
  });

  it('only allows publish when approved and unpublished', () => {
    const publisher = profile({ userId: 'u-admin', role: 'admin' });
    expect(canActorPublish(publisher, { ...base, status: 'approved' })).toBe(true);
    expect(canActorPublish(publisher, { ...base, status: 'pending_final_approval' })).toBe(false);
    expect(
      canActorPublish(publisher, {
        ...base,
        status: 'approved',
        resultingTemplateItemId: 'item-1',
      }),
    ).toBe(false);
  });
});
