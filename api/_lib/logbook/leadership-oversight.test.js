import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  additionalLeadershipOversightRecipients,
  buildLeadershipOversightNotification,
  leadershipOversightDeliveryKey,
  shouldDeliverLeadershipOversight,
} from './leadership-oversight.js';

const defs = [
  { key: 'owner', rank: 0, canAccessAllStores: true, active: true },
  { key: 'admin', rank: 1, canAccessAllStores: true, active: true },
  { key: 'areaManager', rank: 2, canAccessAllStores: true, active: true },
  { key: 'manager', rank: 3, canAccessAllStores: false, active: true },
  { key: 'leader', rank: 4, canAccessAllStores: false, active: true },
  { key: 'subleader', rank: 5, canAccessAllStores: false, active: true },
  { key: 'staff', rank: 7, canAccessAllStores: false, active: true },
];

describe('leadership oversight', () => {
  it('only runs for overdue/reopened/recalled when flag is on and storeId is set', () => {
    expect(shouldDeliverLeadershipOversight('overdue', 's1', true)).toBe(true);
    expect(shouldDeliverLeadershipOversight('reopened', 's1', true)).toBe(true);
    expect(shouldDeliverLeadershipOversight('recalled', 's1', true)).toBe(true);
    expect(shouldDeliverLeadershipOversight('approved', 's1', true)).toBe(false);
    expect(shouldDeliverLeadershipOversight('issue_assigned', 's1', true)).toBe(false);
    expect(shouldDeliverLeadershipOversight('overdue', 's1', false)).toBe(false);
    expect(shouldDeliverLeadershipOversight('overdue', '', true)).toBe(false);
  });

  it('skips already-recipients, uses nearest bucket, and is stable on retry', () => {
    const profiles = [
      { userId: 'sub', role: 'subleader', approvalStatus: 'approved', stores: [{ id: 's1' }] },
      { userId: 'mgr', role: 'manager', approvalStatus: 'approved', stores: [{ id: 's1' }] },
      { userId: 'am', role: 'areaManager', approvalStatus: 'approved', stores: [] },
    ];
    const first = additionalLeadershipOversightRecipients({
      storeId: 's1',
      profiles,
      defs,
      existingRecipients: ['assignee'],
    });
    expect(first).toEqual(['sub']);
    const retry = additionalLeadershipOversightRecipients({
      storeId: 's1',
      profiles,
      defs,
      existingRecipients: ['assignee', 'sub'],
    });
    expect(retry).toEqual(['am']);
    expect(leadershipOversightDeliveryKey('e1', 'overdue', 'v1', 'sub')).toBe(
      'leadership:logbook:e1:overdue:v1:sub',
    );
    expect(leadershipOversightDeliveryKey('e1', 'overdue', 'v1', 'sub')).toBe(
      leadershipOversightDeliveryKey('e1', 'overdue', 'v1', 'sub'),
    );
  });

  it('one inbox payload per recipient for a single-store event', () => {
    const notif = buildLeadershipOversightNotification({
      recipientUserId: 'am',
      entry: { id: 'e1', storeId: 's1' },
      eventType: 'overdue',
      eventVersion: 'v1',
      actor: { userId: 'u1', role: 'staff' },
      title: 'Leadership oversight · Overdue',
      body: 'Open Logbook',
      deepLinkJson: JSON.stringify({ entryId: 'e1', filter: 'my-assigned', storeId: 's1' }),
      actionStatus: 'overdue',
      now: '2026-08-19T00:00:00.000Z',
    });
    expect(notif.type).toBe('leadership_escalation');
    expect(notif.storeId).toBe('s1');
    expect(JSON.parse(notif.deepLinkJson).entryId).toBe('e1');
    expect(notif.deliveryKey).toBe('leadership:logbook:e1:overdue:v1:am');
  });
});

describe('logbook-notify / perms source contracts', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

  it('does not write groupChatMessages from logbook-notify', () => {
    const src = readFileSync(join(root, 'api/logbook-notify.js'), 'utf8');
    expect(src).not.toMatch(/groupChatMessages/);
    expect(src).toMatch(/storeChatMessages/);
    expect(src).toMatch(/messageType: 'report_system'/);
  });

  it('does not add hasAllStoreChatAccess to group chat perms', () => {
    const src = readFileSync(join(root, 'instant.perms.ts'), 'utf8');
    const groupStart = src.indexOf('groupChatRooms:');
    const groupChatSection = src.slice(groupStart);
    expect(groupChatSection).not.toMatch(/hasAllStoreChatAccess:/);
    expect(groupChatSection).toMatch(/Explicit: no hasAllStoreChatAccess/);
  });
});
