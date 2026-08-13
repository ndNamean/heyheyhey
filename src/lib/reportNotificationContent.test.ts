import { describe, expect, it } from 'vitest';
import {
  REPORT_CHAT_MENTION_CAP,
  buildNormalizedReportNotification,
  isReportChatNotifyEnabled,
  reportActionRequiredChatKey,
  reportChatDeliveryKey,
  reportDeliveryKeyForRecipient,
  reportDeliveryKeyPrefix,
  reportDisplayId,
  selectReportMentionUserIds,
  selectReportSubmittedRecipients,
  shouldEmitReportChatOnItemApprove,
  shouldEmitReportFinalizedChat,
} from './reportNotificationContent';
import { defaultDefinitionsAsEntities } from './roleResolver';
import type { Profile, Report, ReportResponse, Store } from '../types';

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

function report(partial: Partial<Report> = {}): Report {
  return {
    id: partial.id ?? 'abcdef123456',
    storeId: partial.storeId ?? 'store-a',
    storeCode: partial.storeCode ?? 'TKA',
    storeName: partial.storeName ?? 'Store A',
    templateId: partial.templateId ?? 't1',
    templateName: partial.templateName ?? 'Opening Checklist',
    reportType: partial.reportType ?? 'daily',
    reportDate: partial.reportDate ?? '2026-08-10',
    submittedByUserId: partial.submittedByUserId ?? 'staff1',
    submittedByRole: partial.submittedByRole ?? 'staff',
    submittedAt: partial.submittedAt ?? '2026-08-10T08:00:00.000Z',
    status: partial.status ?? 'waiting_approval',
    completionPercent: partial.completionPercent ?? 100,
    compliancePercent: partial.compliancePercent ?? 0,
    archived: false,
    archiveMonth: '',
    createdAt: '',
    updatedAt: partial.updatedAt ?? '2026-08-10T08:00:00.000Z',
    responses: partial.responses,
  };
}

function response(partial: Partial<ReportResponse> = {}): ReportResponse {
  return {
    id: partial.id ?? 'resp1',
    reportId: partial.reportId ?? 'abcdef123456',
    templateItemId: partial.templateItemId ?? 'item1',
    section: partial.section ?? 'Ops',
    title: partial.title ?? 'Fridge temp',
    proofType: partial.proofType ?? 'tick',
    required: true,
    assignedRole: '',
    assignedRolesJson: '[]',
    approverRolesJson: partial.approverRolesJson ?? '[]',
    weight: 1,
    failureCategory: '',
    ticked: true,
    numberValue: '',
    note: '',
    status: partial.status ?? 'waiting_approval',
    rejectionReason: '',
    feedbackCode: '',
    feedbackNote: '',
    submittedByUserId: partial.submittedByUserId ?? 'staff1',
    submittedByRole: partial.submittedByRole ?? 'staff',
    submittedAt: '',
    approvedByUserId: '',
    approvedAt: '',
    updatedAt: '',
  };
}

describe('reportNotificationContent', () => {
  it('builds report display id from first 6 chars', () => {
    expect(reportDisplayId('abcdef123456')).toBe('#abcdef');
    expect(reportDisplayId('')).toBe('#------');
  });

  it('builds stable delivery and chat keys', () => {
    expect(reportDeliveryKeyPrefix('r1', 'report_submitted', 'v1')).toBe(
      'report:r1:report_submitted:v1',
    );
    expect(reportDeliveryKeyForRecipient('r1', 'report_submitted', 'v1', 'u1')).toBe(
      'report:r1:report_submitted:v1:u1',
    );
    expect(reportChatDeliveryKey('r1', 'report_submitted', 'v1', 's1')).toBe(
      'report-chat:r1:report_submitted:v1:s1',
    );
    expect(reportActionRequiredChatKey('r1', 'v1', 's1')).toBe(
      'report-chat:r1:report_action_required:v1:s1',
    );
  });

  it('disables chat notify by default (opt-in)', () => {
    expect(isReportChatNotifyEnabled(undefined)).toBe(false);
    expect(isReportChatNotifyEnabled('')).toBe(false);
    expect(isReportChatNotifyEnabled('0')).toBe(false);
    expect(isReportChatNotifyEnabled('false')).toBe(false);
    expect(isReportChatNotifyEnabled('1')).toBe(true);
    expect(isReportChatNotifyEnabled('true')).toBe(true);
    expect(isReportChatNotifyEnabled('on')).toBe(true);
  });

  it('caps mentions and drops all when over cap', () => {
    expect(selectReportMentionUserIds(['a', 'b'])).toEqual(['a', 'b']);
    const many = Array.from({ length: REPORT_CHAT_MENTION_CAP + 1 }, (_, i) => `u${i}`);
    expect(selectReportMentionUserIds(many)).toEqual([]);
  });

  it('never emits chat on item approve', () => {
    expect(shouldEmitReportChatOnItemApprove()).toBe(false);
  });

  it('volume: finalize chat for approved; issues only without prior action_required', () => {
    expect(
      shouldEmitReportFinalizedChat({
        reportStatus: 'approved',
        actionRequiredAlreadyDelivered: false,
      }),
    ).toBe(true);
    expect(
      shouldEmitReportFinalizedChat({
        reportStatus: 'waiting_approval',
        actionRequiredAlreadyDelivered: false,
      }),
    ).toBe(false);
    expect(
      shouldEmitReportFinalizedChat({
        reportStatus: 'rejected',
        actionRequiredAlreadyDelivered: true,
      }),
    ).toBe(false);
    expect(
      shouldEmitReportFinalizedChat({
        reportStatus: 'rejected',
        actionRequiredAlreadyDelivered: false,
      }),
    ).toBe(true);
  });

  it('approved finalize copy uses Report approved + View', () => {
    const n = buildNormalizedReportNotification({
      report: report({ status: 'approved' }),
      eventType: 'report_finalized',
      eventVersion: '2026-08-10T09:00:00.000Z',
      recipients: ['staff1'],
      actor: { userId: 'mgr1', displayName: 'Manager' },
      storeLabel: 'TKA — Store A',
    });
    expect(n.copy.eventLabel).toBe('Report approved');
    expect(n.actionType).toBe('view');
    expect(n.requiredAction).toBe('View');
    expect(n.statusSnapshot).toBe('approved');
    expect(n.copy.chatBody).toContain('Report approved');
  });

  it('issues finalize copy keeps View / fix', () => {
    const n = buildNormalizedReportNotification({
      report: report({ status: 'rejected' }),
      eventType: 'report_finalized',
      eventVersion: '2026-08-10T09:00:00.000Z',
      recipients: ['staff1'],
      actor: { userId: 'mgr1', displayName: 'Manager' },
    });
    expect(n.copy.eventLabel).toBe('Report finalized with issues');
    expect(n.requiredAction).toBe('View / fix');
    expect(n.actionType).toBe('view');
  });

  it('selects reviewers for submitted event and excludes actor', () => {
    const r = report();
    const responses = [response()];
    const profiles = [
      profile({ userId: 'staff1', role: 'staff' }),
      profile({ userId: 'mgr1', role: 'manager', displayName: 'Manager One' }),
      profile({ userId: 'ldr1', role: 'leader' }),
    ];
    const ids = selectReportSubmittedRecipients(r, responses, profiles, 'staff1', defs);
    expect(ids).toContain('mgr1');
    expect(ids).not.toContain('staff1');
  });

  it('builds report_submitted normalized payload with named mentions only', () => {
    const n = buildNormalizedReportNotification({
      report: report(),
      eventType: 'report_submitted',
      eventVersion: '2026-08-10T08:00:00.000Z',
      recipients: ['mgr1', 'ldr1'],
      actor: { userId: 'staff1', displayName: 'Staff' },
      storeLabel: 'TKA — Store A',
      profiles: [
        { userId: 'mgr1', displayName: 'Manager One' },
        { userId: 'ldr1', displayName: 'Leader' },
      ],
    });

    expect(n.type).toBe('report_submitted_chat');
    expect(n.reportDisplayId).toBe('#abcdef');
    expect(n.copy.chatBody).toContain('@Manager One');
    expect(n.copy.chatBody).toContain('@Leader');
    expect(n.copy.chatBody).not.toContain('@all');
    expect(n.copy.scannableLine).toContain('Open Review');
    expect(JSON.parse(n.deepLinkJson)).toEqual({
      page: 'review',
      surface: 'reports',
      reportId: 'abcdef123456',
      storeId: 'store-a',
    });
    expect(n.chatDeliveryKey).toBe(
      'report-chat:abcdef123456:report_submitted:2026-08-10T08:00:00.000Z:store-a',
    );
  });
});

describe('report chat volume guarantees', () => {
  it('10 item approves → 0 chat; first correction → 1; resubmit → new submitted; finalize after action_required → 0; approved finalize → emit', () => {
    const chatEvents: string[] = [];
    // 10 approves — never chat
    for (let i = 0; i < 10; i++) {
      if (shouldEmitReportChatOnItemApprove()) chatEvents.push('approve');
    }
    expect(chatEvents).toEqual([]);

    // first correction
    chatEvents.push('report_action_required');
    expect(chatEvents).toHaveLength(1);

    // second correction same cycle — client still calls; server dedupes by key
    const sameCycleKey = reportActionRequiredChatKey('r1', 'cycle-1', 's1');
    const again = reportActionRequiredChatKey('r1', 'cycle-1', 's1');
    expect(again).toBe(sameCycleKey);

    // resubmit → new submitted key
    const submitted = reportChatDeliveryKey('r1', 'report_submitted', 'cycle-2', 's1');
    expect(submitted).not.toBe(sameCycleKey);
    chatEvents.push('report_submitted');

    // finalize with issues after action_required → skip
    expect(
      shouldEmitReportFinalizedChat({
        reportStatus: 'rejected',
        actionRequiredAlreadyDelivered: true,
      }),
    ).toBe(false);

    // all-approved finalize → emit
    expect(
      shouldEmitReportFinalizedChat({
        reportStatus: 'approved',
        actionRequiredAlreadyDelivered: false,
      }),
    ).toBe(true);
    chatEvents.push('report_finalized');

    expect(chatEvents).toEqual([
      'report_action_required',
      'report_submitted',
      'report_finalized',
    ]);
  });
});
