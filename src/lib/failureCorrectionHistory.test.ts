import { describe, expect, it } from 'vitest';
import {
  aggregateFailureCorrectionHistory,
  buildIssueInstances,
  computeFailedItemsMetric,
} from './failureCorrectionHistory';
import type { Profile, Report, ReportResponse, ReviewEvent } from '../types';

const profiles: Profile[] = [
  {
    id: 'p1',
    userId: 'u1',
    email: 'staff@test.com',
    displayName: 'Staff User',
    role: 'staff',
    approvalStatus: 'approved',
    approvedAt: '',
    approvedByEmail: '',
    accessReviewStoreIdsJson: '[]',
    accessReviewNote: '',
    preApprovedByUserId: '',
    preApprovedByEmail: '',
    preApprovedAt: '',
    accessReviewRequestedByEmail: '',
    accessReviewRequestedAt: '',
    createdAt: '',
    updatedAt: '',
    cameraOptionsJson: '',
  },
  {
    id: 'p2',
    userId: 'u2',
    email: 'mgr@test.com',
    displayName: 'Manager',
    role: 'manager',
    approvalStatus: 'approved',
    approvedAt: '',
    approvedByEmail: '',
    accessReviewStoreIdsJson: '[]',
    accessReviewNote: '',
    preApprovedByUserId: '',
    preApprovedByEmail: '',
    preApprovedAt: '',
    accessReviewRequestedByEmail: '',
    accessReviewRequestedAt: '',
    createdAt: '',
    updatedAt: '',
    cameraOptionsJson: '',
  },
];

function makeReport(
  id: string,
  responses: Partial<ReportResponse>[],
  status = 'waiting_approval',
): Report {
  return {
    id,
    storeId: 's1',
    storeCode: 'ST01',
    storeName: 'Store 1',
    templateId: 't1',
    templateName: 'Daily',
    reportType: 'daily',
    reportDate: '2026-07-01',
    submittedByUserId: 'u1',
    submittedByRole: 'staff',
    submittedAt: '2026-07-01T08:00:00.000Z',
    status,
    completionPercent: 100,
    compliancePercent: 0,
    archived: false,
    archiveMonth: '',
    createdAt: '',
    updatedAt: '',
    responses: responses.map((r, i) => ({
      id: r.id ?? `resp-${i}`,
      reportId: id,
      templateItemId: r.templateItemId ?? `ti-${i}`,
      section: r.section ?? 'Kitchen',
      title: r.title ?? `Item ${i}`,
      proofType: 'tick',
      required: true,
      assignedRole: 'staff',
      approverRolesJson: '["manager"]',
      weight: 1,
      failureCategory: r.failureCategory ?? 'Hygiene',
      ticked: true,
      numberValue: '',
      note: '',
      status: r.status ?? 'waiting_approval',
      rejectionReason: r.rejectionReason ?? '',
      feedbackCode: r.feedbackCode ?? '',
      feedbackNote: r.feedbackNote ?? '',
      submittedByUserId: 'u1',
      submittedByRole: 'staff',
      submittedAt: '2026-07-01T08:00:00.000Z',
      approvedByUserId: r.approvedByUserId ?? '',
      approvedAt: r.approvedAt ?? '',
      updatedAt: '',
    })) as ReportResponse[],
  };
}

function ev(
  partial: Partial<ReviewEvent> & Pick<ReviewEvent, 'eventType' | 'createdAt'>,
): ReviewEvent {
  return {
    id: partial.id ?? `ev-${Math.random()}`,
    reportId: partial.reportId ?? 'r1',
    reportResponseId: partial.reportResponseId ?? '',
    storeId: partial.storeId ?? 's1',
    itemTitle: partial.itemTitle ?? 'Item 0',
    templateItemId: partial.templateItemId ?? 'ti-0',
    sectionSnapshot: partial.sectionSnapshot ?? 'Kitchen',
    categorySnapshot: partial.categorySnapshot ?? 'Hygiene',
    statusAfter: partial.statusAfter ?? 'waiting_approval',
    previousStatus: partial.previousStatus ?? '',
    actorUserId: partial.actorUserId ?? 'u1',
    actorRole: partial.actorRole ?? 'staff',
    actorDisplayNameSnapshot: partial.actorDisplayNameSnapshot ?? '',
    note: partial.note ?? '',
    feedbackCode: partial.feedbackCode ?? '',
    feedbackNote: partial.feedbackNote ?? '',
    ...partial,
  };
}

const filters = { from: '2026-07-01', to: '2026-07-31', storeIds: null as string[] | null };

describe('failureCorrectionHistory', () => {
  it('1. approved on first review — no issue instances', () => {
    const events = [
      ev({ id: 'e1', eventType: 'submitted', createdAt: '2026-07-01T08:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e2', eventType: 'item_approved', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', actorUserId: 'u2', actorRole: 'manager' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'approved' }], 'approved');
    const result = aggregateFailureCorrectionHistory(events, [report], profiles, filters);
    expect(result.issueInstances).toHaveLength(0);
    expect(result.kpis.issueRate.percent).toBe(0);
  });

  it('2. rejected once, resubmitted, approved', () => {
    const events = [
      ev({ id: 'e1', eventType: 'submitted', createdAt: '2026-07-01T08:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e2', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', actorUserId: 'u2', actorRole: 'manager', statusAfter: 'rejected' }),
      ev({ id: 'e3', eventType: 'resubmitted', createdAt: '2026-07-01T10:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e4', eventType: 'item_approved', createdAt: '2026-07-01T11:00:00Z', reportResponseId: 'resp-0', actorUserId: 'u2', statusAfter: 'approved' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'approved' }], 'approved');
    const result = aggregateFailureCorrectionHistory(events, [report], profiles, filters);
    expect(result.issueInstances).toHaveLength(1);
    expect(result.kpis.correctionRecoveryRate.numerator).toBe(1);
    expect(result.kpis.approvalRecoveryRate.numerator).toBe(1);
    expect(result.issueInstances[0]!.correctionDurationMs).toBe(3600000);
  });

  it('3. need correction once, resubmitted, approved', () => {
    const events = [
      ev({ id: 'e1', eventType: 'submitted', createdAt: '2026-07-01T08:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e2', eventType: 'item_correction', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', actorUserId: 'u2', statusAfter: 'need_correction' }),
      ev({ id: 'e3', eventType: 'resubmitted', createdAt: '2026-07-01T10:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e4', eventType: 'item_approved', createdAt: '2026-07-01T11:00:00Z', reportResponseId: 'resp-0', statusAfter: 'approved' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'approved' }]);
    const result = aggregateFailureCorrectionHistory(events, [report], profiles, filters);
    expect(result.issueInstances[0]!.issueType).toBe('need_correction');
    expect(result.kpis.correctionRequestRate.numerator).toBe(1);
    expect(result.kpis.strictRejectionRate.numerator).toBe(0);
  });

  it('4. rejected twice before approval', () => {
    const events = [
      ev({ id: 'e1', eventType: 'submitted', createdAt: '2026-07-01T08:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e2', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', statusAfter: 'rejected' }),
      ev({ id: 'e3', eventType: 'resubmitted', createdAt: '2026-07-01T10:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e4', eventType: 'item_rejected', createdAt: '2026-07-01T11:00:00Z', reportResponseId: 'resp-0', statusAfter: 'rejected' }),
      ev({ id: 'e5', eventType: 'resubmitted', createdAt: '2026-07-01T12:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e6', eventType: 'item_approved', createdAt: '2026-07-01T13:00:00Z', reportResponseId: 'resp-0', statusAfter: 'approved' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'approved' }]);
    const result = aggregateFailureCorrectionHistory(events, [report], profiles, filters);
    expect(result.issueInstances).toHaveLength(2);
    expect(result.kpis.repeatFailureRate.numerator).toBe(1);
  });

  it('5. resubmitted but still waiting approval', () => {
    const events = [
      ev({ id: 'e2', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', statusAfter: 'rejected' }),
      ev({ id: 'e3', eventType: 'resubmitted', createdAt: '2026-07-01T10:00:00Z', reportResponseId: 'resp-0' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'waiting_approval' }]);
    const result = aggregateFailureCorrectionHistory(events, [report], profiles, filters);
    expect(result.kpis.correctionRecoveryRate.numerator).toBe(1);
    expect(result.kpis.approvalRecoveryRate.numerator).toBe(0);
  });

  it('6. rejected and never resubmitted', () => {
    const events = [
      ev({ id: 'e2', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', statusAfter: 'rejected' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'rejected' }]);
    const result = aggregateFailureCorrectionHistory(events, [report], profiles, filters);
    expect(result.kpis.openCorrections).toBe(1);
    expect(result.kpis.avgCorrectionTimeMs).toBeNull();
  });

  it('8. approved by different reviewer uses event actor', () => {
    const events = [
      ev({ id: 'e2', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', actorUserId: 'u2', actorDisplayNameSnapshot: 'Manager' }),
      ev({ id: 'e3', eventType: 'resubmitted', createdAt: '2026-07-01T10:00:00Z', reportResponseId: 'resp-0' }),
      ev({ id: 'e4', eventType: 'item_approved', createdAt: '2026-07-01T11:00:00Z', reportResponseId: 'resp-0', actorUserId: 'u3', actorRole: 'areaManager', actorDisplayNameSnapshot: 'Area Mgr' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'approved' }]);
    const instances = buildIssueInstances(events, [report], profiles);
    expect(instances[0]!.issueByName).toBe('Manager');
    expect(instances[0]!.finalApprovedByName).toBe('Area Mgr');
  });

  it('10. deleted user shows fallback', () => {
    const events = [
      ev({ id: 'e2', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', actorUserId: 'gone-user-12345' }),
    ];
    const report = makeReport('r1', [{ id: 'resp-0', status: 'rejected' }]);
    const instances = buildIssueInstances(events, [report], profiles);
    expect(instances[0]!.issueByName).toContain('Former user');
  });

  it('15. same title different templateItemId not merged in breakdown', () => {
    const events = [
      ev({ id: 'e1', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-0', templateItemId: 'ti-a', itemTitle: 'Clean floor' }),
      ev({ id: 'e2', eventType: 'item_rejected', createdAt: '2026-07-01T09:00:00Z', reportResponseId: 'resp-1', templateItemId: 'ti-b', itemTitle: 'Clean floor' }),
    ];
    const report = makeReport('r1', [
      { id: 'resp-0', templateItemId: 'ti-a', title: 'Clean floor' },
      { id: 'resp-1', templateItemId: 'ti-b', title: 'Clean floor' },
    ]);
    const result = aggregateFailureCorrectionHistory(events, [report], profiles, filters);
    expect(result.breakdownRows).toHaveLength(2);
  });

  it('17. existing Failed items metric unchanged', () => {
    const reports = [
      makeReport('r1', [
        { id: 'resp-0', title: 'A', status: 'rejected' },
        { id: 'resp-1', title: 'A', status: 'rejected' },
        { id: 'resp-2', title: 'B', status: 'need_correction' },
        { id: 'resp-3', title: 'C', status: 'waiting_approval' },
      ]),
    ];
    const failed = computeFailedItemsMetric(reports);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.title).toBe('A');
    expect(failed[0]!.count).toBe(2);
  });
});
