import { describe, expect, it } from 'vitest';
import {
  buildReviewReportsWhere,
  canFinaliseReportResponses,
  canRemindReportInStoreChat,
  canReviewReport,
  canReviewReportItem,
  filterReportsAwaitingReview,
  firstActionableReportResponse,
  resolveFinaliseReportStatus,
} from './reportReview';
import {
  getReviewNotificationRecipients,
  reportFinalizedNotificationTitle,
} from './notifications';
import { buildReportReviewStatusRows } from './reportReviewStatus';
import { defaultDefinitionsAsEntities } from './roleResolver';
import type { Profile, Report, ReportResponse, RoleDefinition, Store } from '../types';

const defs = defaultDefinitionsAsEntities();

const storeA: Store = {
  id: 'store-a',
  code: 'TKA',
  name: 'Store A',
  address: '',
  area: '',
  lat: 0,
  lng: 0,
  geofenceRadiusM: 100,
  active: true,
  createdAt: '',
  updatedAt: '',
};

const storeB: Store = {
  ...storeA,
  id: 'store-b',
  code: 'TKB',
  name: 'Store B',
};

function profile(partial: Partial<Profile> & Pick<Profile, 'role' | 'userId'>): Profile {
  return {
    id: partial.id ?? `p-${partial.userId}`,
    userId: partial.userId,
    email: partial.email ?? `${partial.userId}@test.com`,
    displayName: partial.displayName ?? partial.userId,
    role: partial.role,
    approvalStatus: partial.approvalStatus ?? 'approved',
    approvedAt: '',
    approvedByEmail: '',
    createdAt: '',
    updatedAt: '',
    stores: partial.stores ?? [storeA],
  };
}

function report(partial: Partial<Report> & Pick<Report, 'storeId'>): Report {
  return {
    id: partial.id ?? 'r1',
    storeId: partial.storeId,
    storeCode: partial.storeCode ?? 'TKA',
    storeName: partial.storeName ?? 'Store A',
    templateId: partial.templateId ?? 't1',
    templateName: partial.templateName ?? 'Checklist',
    reportType: partial.reportType ?? 'daily',
    reportDate: partial.reportDate ?? new Date().toISOString().slice(0, 10),
    submittedByUserId: partial.submittedByUserId ?? 'staff1',
    submittedByRole: partial.submittedByRole ?? 'staff',
    submittedAt: partial.submittedAt ?? new Date().toISOString(),
    status: partial.status ?? 'waiting_approval',
    completionPercent: partial.completionPercent ?? 100,
    compliancePercent: partial.compliancePercent ?? 0,
    archived: partial.archived ?? false,
    archiveMonth: partial.archiveMonth ?? '',
    createdAt: partial.createdAt ?? '',
    updatedAt: partial.updatedAt ?? '',
    responses: partial.responses,
  };
}

function response(
  partial: Partial<ReportResponse> & Pick<ReportResponse, 'submittedByRole'> = {
    submittedByRole: 'staff',
  },
): ReportResponse {
  return {
    id: partial.id ?? 'resp1',
    reportId: partial.reportId ?? 'r1',
    templateItemId: partial.templateItemId ?? 'item1',
    section: partial.section ?? 'Ops',
    title: partial.title ?? 'Clean floor',
    proofType: partial.proofType ?? 'tick',
    required: partial.required ?? true,
    assignedRole: partial.assignedRole ?? 'staff',
    approverRolesJson: partial.approverRolesJson ?? '[]',
    weight: partial.weight ?? 1,
    failureCategory: partial.failureCategory ?? 'Operations',
    ticked: partial.ticked ?? true,
    numberValue: partial.numberValue ?? '',
    note: partial.note ?? '',
    status: partial.status ?? 'waiting_approval',
    rejectionReason: partial.rejectionReason ?? '',
    feedbackCode: partial.feedbackCode ?? '',
    feedbackNote: partial.feedbackNote ?? '',
    submittedByUserId: partial.submittedByUserId ?? 'staff1',
    submittedByRole: partial.submittedByRole,
    submittedAt: partial.submittedAt ?? '',
    approvedByUserId: partial.approvedByUserId ?? '',
    approvedAt: partial.approvedAt ?? '',
    updatedAt: partial.updatedAt ?? '',
    storeId: partial.storeId,
  };
}

describe('canReviewReport', () => {
  it('manager Store A can review Store A; cannot review Store B', () => {
    const manager = profile({ userId: 'm1', role: 'manager', stores: [storeA] });
    expect(canReviewReport(manager, report({ storeId: 'store-a' }), defs)).toBe(true);
    expect(canReviewReport(manager, report({ storeId: 'store-b' }), defs)).toBe(false);
  });

  it('owner and areaManager can review any store', () => {
    const owner = profile({ userId: 'o1', role: 'owner', stores: [] });
    const areaManager = profile({ userId: 'am1', role: 'areaManager', stores: [] });
    expect(canReviewReport(owner, report({ storeId: 'store-b' }), defs)).toBe(true);
    expect(canReviewReport(areaManager, report({ storeId: 'store-b' }), defs)).toBe(true);
  });

  it('staff cannot review', () => {
    const staff = profile({ userId: 's1', role: 'staff', stores: [storeA] });
    expect(canReviewReport(staff, report({ storeId: 'store-a' }), defs)).toBe(false);
  });

  it('hybrid only when store overlaps', () => {
    const hybrid = profile({ userId: 'h1', role: 'hybrid', stores: [storeA] });
    expect(canReviewReport(hybrid, report({ storeId: 'store-a' }), defs)).toBe(true);
    expect(canReviewReport(hybrid, report({ storeId: 'store-b' }), defs)).toBe(false);
  });

  it('rejects unapproved profiles and missing storeId', () => {
    const manager = profile({
      userId: 'm1',
      role: 'manager',
      stores: [storeA],
      approvalStatus: 'pending',
    });
    expect(canReviewReport(manager, report({ storeId: 'store-a' }), defs)).toBe(false);
    expect(
      canReviewReport(
        profile({ userId: 'm2', role: 'manager', stores: [storeA] }),
        report({ storeId: '' }),
        defs,
      ),
    ).toBe(false);
  });
});

describe('buildReviewReportsWhere', () => {
  it('filters all-store roles to indexed waiting_approval', () => {
    expect(
      buildReviewReportsWhere({
        canAccessAllStores: true,
        storeIds: ['store-a'],
        highlightReportId: 'r1',
      }),
    ).toEqual({ status: 'waiting_approval' });
  });

  it('scopes managers to waiting_approval on assigned stores', () => {
    expect(
      buildReviewReportsWhere({
        canAccessAllStores: false,
        storeIds: ['store-a', 'store-a', ''],
      }),
    ).toEqual({
      and: [{ status: 'waiting_approval' }, { storeId: { $in: ['store-a'] } }],
    });
  });

  it('includes deep-link report id so Open Review still loads that card', () => {
    expect(
      buildReviewReportsWhere({
        canAccessAllStores: false,
        storeIds: ['store-a'],
        highlightReportId: '2ac1be-full',
      }),
    ).toEqual({
      or: [
        { and: [{ status: 'waiting_approval' }, { storeId: { $in: ['store-a'] } }] },
        { id: '2ac1be-full' },
      ],
    });
  });

  it('uses highlight id only when store-scoped reviewer has no stores', () => {
    expect(
      buildReviewReportsWhere({
        canAccessAllStores: false,
        storeIds: [],
        highlightReportId: 'r-deep',
      }),
    ).toEqual({ id: 'r-deep' });
  });

  it('skips the reports query when a store-scoped reviewer has no stores', () => {
    expect(
      buildReviewReportsWhere({
        canAccessAllStores: false,
        storeIds: [],
      }),
    ).toBeNull();
  });
});

describe('filterReportsAwaitingReview', () => {
  it('keeps waiting_approval on assigned stores and drops approved or other stores', () => {
    const manager = profile({ userId: 'm1', role: 'manager', stores: [storeA] });
    const kept = filterReportsAwaitingReview(
      [
        report({ id: 'wait-a', storeId: 'store-a', status: 'waiting_approval' }),
        report({ id: 'done-a', storeId: 'store-a', status: 'approved' }),
        report({ id: 'wait-b', storeId: 'store-b', status: 'waiting_approval' }),
      ],
      manager,
      defs,
    );
    expect(kept.map((r) => r.id)).toEqual(['wait-a']);
  });

  it('sorts by submittedAt newest first so item approve cannot jump the list', () => {
    const manager = profile({ userId: 'm1', role: 'manager', stores: [storeA] });
    const kept = filterReportsAwaitingReview(
      [
        report({
          id: 'older',
          storeId: 'store-a',
          status: 'waiting_approval',
          submittedAt: '2026-08-10T08:00:00.000Z',
        }),
        report({
          id: 'newer',
          storeId: 'store-a',
          status: 'waiting_approval',
          submittedAt: '2026-08-12T23:10:00.000Z',
        }),
      ],
      manager,
      defs,
    );
    expect(kept.map((r) => r.id)).toEqual(['newer', 'older']);
  });
});

describe('canReviewReportItem', () => {
  it('manager can approve staff item on assigned store', () => {
    const manager = profile({ userId: 'm1', role: 'manager', stores: [storeA] });
    const r = report({ storeId: 'store-a' });
    expect(canReviewReportItem(manager, r, response({ submittedByRole: 'staff' }), defs)).toBe(
      true,
    );
  });

  it('blocks peer manager even on assigned store', () => {
    const manager = profile({ userId: 'm1', role: 'manager', stores: [storeA] });
    const r = report({ storeId: 'store-a' });
    expect(canReviewReportItem(manager, r, response({ submittedByRole: 'manager' }), defs)).toBe(
      false,
    );
  });

  it('blocks item approve when store does not match even if rank allows', () => {
    const manager = profile({ userId: 'm1', role: 'manager', stores: [storeA] });
    const r = report({ storeId: 'store-b' });
    expect(canReviewReportItem(manager, r, response({ submittedByRole: 'staff' }), defs)).toBe(
      false,
    );
  });
});

describe('canFinaliseReportResponses + resolveFinaliseReportStatus', () => {
  it('hides Finalise while any item is still waiting_approval', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({ id: 'b', status: 'waiting_approval' }),
    ];
    expect(canFinaliseReportResponses(responses)).toBe(false);
    expect(resolveFinaliseReportStatus(responses)).toBe('waiting_approval');
  });

  it('hides Finalise for mixed approved + need_correction', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({ id: 'b', status: 'need_correction' }),
    ];
    expect(canFinaliseReportResponses(responses)).toBe(false);
    expect(resolveFinaliseReportStatus(responses)).toBe('waiting_approval');
  });

  it('hides Finalise for mixed approved + rejected', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({ id: 'b', status: 'rejected' }),
    ];
    expect(canFinaliseReportResponses(responses)).toBe(false);
    expect(resolveFinaliseReportStatus(responses)).toBe('waiting_approval');
  });

  it('sets approved when every item is approved', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({ id: 'b', status: 'approved' }),
    ];
    expect(canFinaliseReportResponses(responses)).toBe(true);
    expect(resolveFinaliseReportStatus(responses)).toBe('approved');
  });
});

describe('canRemindReportInStoreChat + firstActionableReportResponse', () => {
  it('hides Remind while any item is still waiting_approval', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({ id: 'b', status: 'waiting_approval' }),
    ];
    expect(canRemindReportInStoreChat(responses)).toBe(false);
  });

  it('shows Remind for approved + need_correction', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({
        id: 'b',
        status: 'need_correction',
        title: 'Fix fridge',
        rejectionReason: 'Dirty',
      }),
    ];
    expect(canRemindReportInStoreChat(responses)).toBe(true);
    expect(firstActionableReportResponse(responses)?.id).toBe('b');
  });

  it('shows Remind for approved + rejected', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({ id: 'b', status: 'rejected', title: 'Bad photo' }),
    ];
    expect(canRemindReportInStoreChat(responses)).toBe(true);
    expect(firstActionableReportResponse(responses)?.id).toBe('b');
  });

  it('prefers need_correction over rejected for actionable item', () => {
    const responses = [
      response({ id: 'a', status: 'rejected', title: 'Rejected first' }),
      response({ id: 'b', status: 'need_correction', title: 'Needs fix' }),
    ];
    expect(firstActionableReportResponse(responses)?.id).toBe('b');
  });

  it('hides Remind when every item is approved', () => {
    const responses = [
      response({ id: 'a', status: 'approved' }),
      response({ id: 'b', status: 'approved' }),
    ];
    expect(canRemindReportInStoreChat(responses)).toBe(false);
    expect(firstActionableReportResponse(responses)).toBeNull();
  });
});

describe('reportFinalizedNotificationTitle', () => {
  it('uses N-item Needs correction wording when N >= 1', () => {
    expect(
      reportFinalizedNotificationTitle({
        storeCode: 'TKA',
        reportStatus: 'need_correction',
        needCorrectionCount: 1,
      }),
    ).toBe('Report finalised — 1 item needs correction');
    expect(
      reportFinalizedNotificationTitle({
        storeCode: 'TKA',
        reportStatus: 'need_correction',
        needCorrectionCount: 3,
      }),
    ).toBe('Report finalised — 3 items need correction');
  });

  it('keeps store + status title when no Needs correction items', () => {
    expect(
      reportFinalizedNotificationTitle({
        storeCode: 'TKA',
        reportStatus: 'approved',
        needCorrectionCount: 0,
      }),
    ).toBe('TKA — Report Approved');
  });
});

describe('parity: notifications + review status defs', () => {
  it('getReviewNotificationRecipients respects custom canAccessAllStores via defs', () => {
    const customDefs: RoleDefinition[] = defs.map((d) =>
      d.key === 'manager' ? { ...d, canAccessAllStores: true } : d,
    );
    const approver = profile({ userId: 'am1', role: 'areaManager', stores: [] });
    const supervisorOnOtherStore = profile({
      userId: 'm-other',
      role: 'manager',
      stores: [storeB],
    });
    const r = report({ storeId: 'store-a', submittedByRole: 'staff' });
    const resp = response({ submittedByRole: 'staff', submittedByUserId: 'staff1' });

    // Default defs: manager without store A is excluded
    const withoutCustom = getReviewNotificationRecipients(
      r,
      resp,
      approver,
      [supervisorOnOtherStore, profile({ userId: 'staff1', role: 'staff' })],
      defs,
    );
    expect(withoutCustom).not.toContain('m-other');

    // Custom defs: manager with canAccessAllStores is included
    const withCustom = getReviewNotificationRecipients(
      r,
      resp,
      approver,
      [supervisorOnOtherStore, profile({ userId: 'staff1', role: 'staff' })],
      customDefs,
    );
    expect(withCustom).toContain('m-other');
  });

  it('buildReportReviewStatusRows passes defs into store access', () => {
    const customDefs: RoleDefinition[] = defs.map((d) =>
      d.key === 'manager' ? { ...d, canAccessAllStores: true } : d,
    );
    const manager = profile({ userId: 'm1', role: 'manager', stores: [storeA] });
    const otherStoreReport = report({
      id: 'r-b',
      storeId: 'store-b',
      storeCode: 'TKB',
      status: 'waiting_approval',
    });

    const withoutCustom = buildReportReviewStatusRows([otherStoreReport], [], [], {
      profile: manager,
      defs,
    });
    expect(withoutCustom).toHaveLength(0);

    const withCustom = buildReportReviewStatusRows([otherStoreReport], [], [], {
      profile: manager,
      defs: customDefs,
    });
    expect(withCustom).toHaveLength(1);
    expect(withCustom[0]!.report.id).toBe('r-b');
  });
});
