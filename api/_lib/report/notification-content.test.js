import { describe, expect, it } from 'vitest';
import {
  REPORT_CHAT_MENTION_CAP,
  buildNormalizedReportNotification,
  isReportChatNotifyEnabled,
  reportChatDeliveryKey,
  shouldEmitReportFinalizedChat,
} from '../report/notification-content.js';
import {
  selectReportSubmittedRecipients,
} from '../report/recipients.js';

describe('api/_lib/report/notification-content', () => {
  it('keeps mention cap aligned with logbook', () => {
    expect(REPORT_CHAT_MENTION_CAP).toBe(15);
  });

  it('default flag is off', () => {
    expect(isReportChatNotifyEnabled(undefined)).toBe(false);
    expect(isReportChatNotifyEnabled('1')).toBe(true);
  });

  it('builds chat delivery key', () => {
    expect(reportChatDeliveryKey('r1', 'report_submitted', 'v1', 's1')).toBe(
      'report-chat:r1:report_submitted:v1:s1',
    );
  });

  it('builds named-mention chat body', () => {
    const n = buildNormalizedReportNotification({
      report: {
        id: 'rep123',
        storeId: 's1',
        storeCode: 'S1',
        templateName: 'Daily',
        reportDate: '2026-08-10',
        status: 'waiting_approval',
      },
      eventType: 'report_submitted',
      eventVersion: 'v1',
      recipients: ['u1'],
      profiles: [{ userId: 'u1', displayName: 'Ada' }],
      actor: { userId: 'staff', displayName: 'Staff' },
    });
    expect(n.copy.chatBody).toContain('@Ada');
    expect(n.copy.chatBody).not.toContain('@all');
    expect(n.deepLink.page).toBe('review');
  });

  it('skips finalize chat when action_required already delivered', () => {
    expect(
      shouldEmitReportFinalizedChat({
        reportStatus: 'rejected',
        actionRequiredAlreadyDelivered: true,
      }),
    ).toBe(false);
  });
});

describe('api/_lib/report/recipients', () => {
  it('excludes actor from submitted recipients', () => {
    const defs = [
      { key: 'manager', rank: 3, canReview: true, active: true },
      { key: 'staff', rank: 7, canReview: false, active: true },
    ];
    const report = { storeId: 's1', submittedByUserId: 'staff1' };
    const responses = [
      {
        status: 'waiting_approval',
        submittedByRole: 'staff',
        approverRolesJson: '[]',
      },
    ];
    const profiles = [
      {
        userId: 'staff1',
        role: 'staff',
        approvalStatus: 'approved',
        stores: [{ id: 's1' }],
      },
      {
        userId: 'mgr1',
        role: 'manager',
        approvalStatus: 'approved',
        stores: [{ id: 's1' }],
      },
    ];
    const ids = selectReportSubmittedRecipients(
      report,
      responses,
      profiles,
      'staff1',
      defs,
    );
    expect(ids).toContain('mgr1');
    expect(ids).not.toContain('staff1');
  });
});
