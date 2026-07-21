import { describe, expect, it } from 'vitest';
import { getRoleLinkStatus } from './roleLinkStatus';
import type { RoleDefinition } from '../types';

const defs: RoleDefinition[] = [
  {
    id: 'def-staff',
    key: 'staff',
    label: 'Staff',
    rank: 5,
    isSystem: true,
    active: true,
    canEditMaster: false,
    canManageUsers: false,
    canReview: false,
    canPreApproveAccess: false,
    canAccessAllStores: false,
    seesAllTemplateItems: false,
    canExportDashboard: false,
    canExportReviewStatus: false,
    canScheduleShifts: false,
    canDeleteShifts: false,
    canUseOpsTools: false,
    canClockIn: true,
    canProposeTemplateItem: false,
    canFirstApproveTemplateItemProposal: false,
    canFinalApproveTemplateItemProposal: false,
    canPublishTemplateItemProposal: false,
    approvesSubmitterRolesJson: '[]',
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'def-supervisor',
    key: 'supervisor',
    label: 'Supervisor',
    rank: 4,
    isSystem: false,
    active: true,
    canEditMaster: false,
    canManageUsers: false,
    canReview: true,
    canPreApproveAccess: false,
    canAccessAllStores: false,
    seesAllTemplateItems: false,
    canExportDashboard: false,
    canExportReviewStatus: false,
    canScheduleShifts: false,
    canDeleteShifts: false,
    canUseOpsTools: true,
    canClockIn: true,
    canProposeTemplateItem: false,
    canFirstApproveTemplateItemProposal: false,
    canFinalApproveTemplateItemProposal: false,
    canPublishTemplateItemProposal: false,
    approvesSubmitterRolesJson: '[]',
    createdAt: '',
    updatedAt: '',
  },
];

describe('getRoleLinkStatus', () => {
  it('returns ok when profile role matches linked definition', () => {
    expect(
      getRoleLinkStatus(
        { role: 'staff', roleDefinition: { id: 'def-staff', key: 'staff' } },
        defs,
      ),
    ).toBe('ok');
  });

  it('returns missing_link when no roleDefinition is linked', () => {
    expect(getRoleLinkStatus({ role: 'staff' }, defs)).toBe('missing_link');
  });

  it('returns wrong_key when linked definition key differs from profile role', () => {
    expect(
      getRoleLinkStatus(
        { role: 'staff', roleDefinition: { id: 'def-supervisor', key: 'supervisor' } },
        defs,
      ),
    ).toBe('wrong_key');
  });

  it('returns unknown_role when role key is not in definitions', () => {
    expect(
      getRoleLinkStatus(
        { role: 'ghost', roleDefinition: { id: 'def-staff', key: 'staff' } },
        defs,
      ),
    ).toBe('unknown_role');
  });
});
