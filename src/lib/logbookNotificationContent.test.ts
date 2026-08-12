import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_DEFINITIONS } from './defaultRoleDefinitions';
import {
  LOGBOOK_CHAT_MENTION_MODE,
  LOGBOOK_MENTION_CAP,
  buildNormalizedLogbookNotification,
  chatDeliveryKey,
  deliveryKeyForRecipient,
  deliveryKeyPrefix,
  entryDisplayId,
  filterForLogbookNotificationOpen,
  filterForLogbookNotificationType,
  isLogbookChatNotifyEnabled,
  resolveChatMentionMode,
  selectMentionUserIds,
  shouldAutoOpenLogbookResolutionForViewer,
  shouldOpenLogbookResolutionFromNotification,
} from './logbookNotificationContent';
import type { LogbookEntry, Profile } from '../types';

describe('logbookNotificationContent', () => {
  const baseEntry = {
    id: 'abcdef123456',
    content: 'Fridge warmer than 5C',
    storeId: 'store-1',
    status: 'open',
    dueAt: '2099-01-01T12:00:00.000Z',
    severity: 'high',
    entryType: 'issue',
  };

  it('builds entry display id from first 6 chars', () => {
    expect(entryDisplayId('abcdef123456')).toBe('#abcdef');
    expect(entryDisplayId('')).toBe('#------');
  });

  it('builds stable delivery and chat keys', () => {
    expect(deliveryKeyPrefix('e1', 'issue_assigned', 'v1')).toBe(
      'logbook:e1:issue_assigned:v1',
    );
    expect(deliveryKeyForRecipient('e1', 'issue_assigned', 'v1', 'u1')).toBe(
      'logbook:e1:issue_assigned:v1:u1',
    );
    expect(chatDeliveryKey('e1', 'issue_assigned', 'v1', 's1')).toBe(
      'logbook-chat:e1:issue_assigned:v1:s1',
    );
  });

  it('enables chat notify by default (missing = ON)', () => {
    expect(isLogbookChatNotifyEnabled(undefined)).toBe(true);
    expect(isLogbookChatNotifyEnabled('')).toBe(true);
    expect(isLogbookChatNotifyEnabled('0')).toBe(false);
    expect(isLogbookChatNotifyEnabled('false')).toBe(false);
    expect(isLogbookChatNotifyEnabled('off')).toBe(false);
  });

  it('maps notification types to filters', () => {
    expect(filterForLogbookNotificationType('logbook_issue_assigned')).toBe(
      'my-assigned',
    );
    expect(filterForLogbookNotificationType('logbook_resolution_submitted')).toBe(
      'waiting_approval',
    );
    expect(filterForLogbookNotificationType('logbook_ack_required')).toBe(
      'requires_ack',
    );
    expect(filterForLogbookNotificationType('logbook_note_created')).toBe(
      'requires_ack',
    );
  });

  it('filterForLogbookNotificationOpen keeps assignee filters and widens for viewers', () => {
    const defs = DEFAULT_ROLE_DEFINITIONS;
    const issue = {
      ...baseEntry,
      assigneeRole: 'staff',
      assigneeUserIdsJson: '["staff-1"]',
      authorUserId: 'owner-1',
      date: '2026-08-10',
      shift: 'AM',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      requiresAck: false,
      isAnnouncement: false,
    } as LogbookEntry;

    const overdueIssue = {
      ...issue,
      dueAt: '2000-01-01T00:00:00.000Z',
    } as LogbookEntry;

    const staff: Profile = {
      id: 'p-staff',
      userId: 'staff-1',
      email: 'staff@example.com',
      displayName: 'Staff',
      role: 'staff',
      approvalStatus: 'approved',
      stores: [{ id: 'store-1', code: 'S1', name: 'Store 1' } as never],
    } as Profile;

    const owner: Profile = {
      id: 'p-owner',
      userId: 'owner-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
      approvalStatus: 'approved',
      stores: [{ id: 'store-1', code: 'S1', name: 'Store 1' } as never],
    } as Profile;

    expect(
      filterForLogbookNotificationOpen(
        'logbook_issue_overdue',
        staff,
        overdueIssue,
        defs,
      ),
    ).toBe('my-assigned');
    expect(
      filterForLogbookNotificationOpen(
        'logbook_issue_overdue',
        owner,
        overdueIssue,
        defs,
        'my-assigned',
      ),
    ).toBe('overdue');
    expect(
      filterForLogbookNotificationOpen(
        'logbook_issue_assigned',
        owner,
        issue,
        defs,
      ),
    ).toBe('all');
    expect(
      filterForLogbookNotificationOpen(
        'logbook_resolution_submitted',
        owner,
        { ...issue, status: 'waiting_approval' } as LogbookEntry,
        defs,
      ),
    ).toBe('waiting_approval');
    expect(
      filterForLogbookNotificationOpen(
        'logbook_issue_assigned',
        owner,
        null,
        defs,
        'my-assigned',
      ),
    ).toBe('all');
  });

  it('opens resolution only for issue-resolve notification types', () => {
    expect(shouldOpenLogbookResolutionFromNotification('logbook_issue_assigned')).toBe(
      true,
    );
    expect(
      shouldOpenLogbookResolutionFromNotification(
        'logbook_resolution_correction_requested',
      ),
    ).toBe(true);
    expect(shouldOpenLogbookResolutionFromNotification('logbook_issue_overdue')).toBe(
      true,
    );
    expect(shouldOpenLogbookResolutionFromNotification('logbook_issue_reopened')).toBe(
      true,
    );
    expect(shouldOpenLogbookResolutionFromNotification('logbook_note_created')).toBe(
      false,
    );
    expect(
      shouldOpenLogbookResolutionFromNotification('logbook_announcement_created'),
    ).toBe(false);
    expect(shouldOpenLogbookResolutionFromNotification('logbook_ack_required')).toBe(
      false,
    );
    expect(
      shouldOpenLogbookResolutionFromNotification('logbook_resolution_submitted'),
    ).toBe(false);
    expect(
      shouldOpenLogbookResolutionFromNotification('logbook_resolution_approved'),
    ).toBe(false);
    expect(shouldOpenLogbookResolutionFromNotification('logbook_issue_recalled')).toBe(
      false,
    );
  });

  it('auto-opens resolution only for assignees, not owner/reviewer-only viewers', () => {
    const defs = DEFAULT_ROLE_DEFINITIONS;
    const issue = {
      ...baseEntry,
      assigneeRole: 'staff',
      assigneeUserIdsJson: '["staff-1"]',
      authorUserId: 'owner-1',
      date: '2026-08-10',
      shift: 'AM',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      requiresAck: false,
      isAnnouncement: false,
    } as LogbookEntry;

    const staff: Profile = {
      id: 'p-staff',
      userId: 'staff-1',
      email: 'staff@example.com',
      displayName: 'Staff',
      role: 'staff',
      approvalStatus: 'approved',
      stores: [{ id: 'store-1', code: 'S1', name: 'Store 1' } as never],
    } as Profile;

    const owner: Profile = {
      id: 'p-owner',
      userId: 'owner-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
      approvalStatus: 'approved',
      stores: [{ id: 'store-1', code: 'S1', name: 'Store 1' } as never],
    } as Profile;

    expect(
      shouldAutoOpenLogbookResolutionForViewer(
        'logbook_issue_overdue',
        staff,
        issue,
        defs,
      ),
    ).toBe(true);
    expect(
      shouldAutoOpenLogbookResolutionForViewer(
        'logbook_issue_overdue',
        owner,
        issue,
        defs,
      ),
    ).toBe(false);
    expect(
      shouldAutoOpenLogbookResolutionForViewer(
        'logbook_issue_overdue',
        owner,
        null,
        defs,
      ),
    ).toBe(false);
    expect(
      shouldAutoOpenLogbookResolutionForViewer(
        'logbook_resolution_submitted',
        staff,
        issue,
        defs,
      ),
    ).toBe(false);
  });

  it('caps mentions and drops all when over cap', () => {
    expect(selectMentionUserIds(['a', 'b'])).toEqual(['a', 'b']);
    const many = Array.from({ length: LOGBOOK_MENTION_CAP + 1 }, (_, i) => `u${i}`);
    expect(selectMentionUserIds(many)).toEqual([]);
  });

  it('resolves chat mention mode by event', () => {
    expect(resolveChatMentionMode('issue_assigned')).toBe(
      LOGBOOK_CHAT_MENTION_MODE.NAMED,
    );
    expect(resolveChatMentionMode('resolution_submitted')).toBe(
      LOGBOOK_CHAT_MENTION_MODE.NAMED,
    );
    expect(resolveChatMentionMode('ack_required')).toBe(
      LOGBOOK_CHAT_MENTION_MODE.ALL,
    );
  });

  it('builds issue_assigned normalized payload with all channels', () => {
    const n = buildNormalizedLogbookNotification({
      entry: baseEntry,
      eventType: 'issue_assigned',
      eventVersion: '2026-01-01T00:00:00.000Z',
      recipients: ['u1', 'u2'],
      actor: { userId: 'actor', displayName: 'Ada' },
      storeLabel: 'S1 — Main',
      profiles: [
        { userId: 'u1', displayName: 'Bob' },
        { userId: 'u2', displayName: 'Cara' },
      ],
    });

    expect(n.type).toBe('logbook_issue_assigned');
    expect(n.filter).toBe('my-assigned');
    expect(n.entryDisplayId).toBe('#abcdef');
    expect(n.storeLabel).toBe('S1 — Main');
    expect(n.copy.eventLabel).toBe('New issue assigned');
    expect(n.copy.inboxTitle).toBe('New issue assigned');
    expect(n.copy.pushTitle).toBe('New issue assigned');
    expect(n.copy.chatBody).toContain('@Bob');
    expect(n.copy.chatBody).toContain('@Cara');
    expect(n.copy.scannableLine).toContain('Open and resolve');
    expect(n.deepLink.filter).toBe('my-assigned');
    expect(JSON.parse(n.deepLinkJson)).toEqual({
      entryId: 'abcdef123456',
      filter: 'my-assigned',
      storeId: 'store-1',
    });
    expect(n.chatDeliveryKey).toBe(
      'logbook-chat:abcdef123456:issue_assigned:2026-01-01T00:00:00.000Z:store-1',
    );
  });

  it('uses All stores fallback and skips mentions over cap', () => {
    const recipients = Array.from({ length: 16 }, (_, i) => `u${i}`);
    const n = buildNormalizedLogbookNotification({
      entry: { ...baseEntry, storeId: '', entryType: 'note', requiresAck: true },
      eventType: 'ack_required',
      eventVersion: 'v1',
      recipients,
      profiles: recipients.map((userId) => ({ userId, displayName: userId })),
    });
    expect(n.storeLabel).toBe('All stores');
    expect(n.type).toBe('logbook_note_created');
    expect(n.filter).toBe('requires_ack');
    expect(n.copy.chatBody).toContain('@all');
    expect(n.copy.chatBody).not.toContain('@u0');
    expect(selectMentionUserIds(recipients)).toEqual([]);
  });

  it('marks overdue and uses resolution note detail', () => {
    const n = buildNormalizedLogbookNotification({
      entry: {
        ...baseEntry,
        dueAt: '2000-01-01T00:00:00.000Z',
        status: 'waiting_approval',
        resolutionNote: 'Fixed compressor',
      },
      eventType: 'resolution_submitted',
      eventVersion: 'attempt-1',
      recipients: ['rev1'],
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
      profiles: [{ userId: 'rev1', displayName: 'Riv' }],
    });
    expect(n.isOverdue).toBe(true);
    expect(n.filter).toBe('waiting_approval');
    expect(n.copy.inboxBody).toContain('Fixed compressor');
    expect(n.copy.chatBody).toContain('@Riv');
  });

  it('appends assignee roster line for multi-assignee resolution_submitted', () => {
    const n = buildNormalizedLogbookNotification({
      entry: {
        ...baseEntry,
        status: 'waiting_approval',
        assigneeRole: 'staff',
        assigneeUserIdsJson: '["u1","u2","u3"]',
        resolutionSubmittedByUserId: 'u1',
        resolutionNote: 'Fixed compressor',
      },
      eventType: 'resolution_submitted',
      eventVersion: 'attempt-1',
      recipients: ['rev1'],
      profiles: [
        { userId: 'u1', displayName: 'Lê' },
        { userId: 'u2', displayName: 'Phụng' },
        { userId: 'u3', displayName: 'Linh' },
        { userId: 'rev1', displayName: 'Riv' },
      ],
    });
    expect(n.body).toContain('Submitted: Lê · Not submitted: Linh, Phụng');
    expect(n.copy.inboxBody).toContain('Submitted: Lê · Not submitted: Linh, Phụng');
    expect(n.copy.pushBody).toContain('Submitted: Lê · Not submitted: Linh, Phụng');
    expect(n.copy.chatBody).toContain('Submitted: Lê · Not submitted: Linh, Phụng');
  });

  it('skips roster line for single-assignee noise and non-roster events', () => {
    const overdueSingle = buildNormalizedLogbookNotification({
      entry: {
        ...baseEntry,
        assigneeRole: 'staff',
        assigneeUserIdsJson: '["u1"]',
      },
      eventType: 'overdue',
      eventVersion: 'v1',
      recipients: ['u1'],
      profiles: [{ userId: 'u1', displayName: 'Lê' }],
    });
    expect(overdueSingle.body).not.toContain('Not submitted:');
    expect(overdueSingle.body).not.toContain('Submitted:');

    const assignedMulti = buildNormalizedLogbookNotification({
      entry: {
        ...baseEntry,
        assigneeRole: 'staff',
        assigneeUserIdsJson: '["u1","u2"]',
      },
      eventType: 'issue_assigned',
      eventVersion: 'v1',
      recipients: ['u1', 'u2'],
      profiles: [
        { userId: 'u1', displayName: 'Lê' },
        { userId: 'u2', displayName: 'Phụng' },
      ],
    });
    expect(assignedMulti.body).not.toContain('Not submitted:');
    expect(assignedMulti.copy.chatBody).not.toContain('Not submitted:');
  });
});
