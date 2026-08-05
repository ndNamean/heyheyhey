/**
 * Opportunistic due-soon / overdue notifications for logbook issues.
 * Call on Logbook / Dashboard open. Dedups via dueSoonNotifiedAt / overdueNotifiedAt.
 */

import { db } from '../db';
import {
  buildLogbookDueSoonNotifications,
} from './notifications';
import { deliverLogbookEvent } from './logbookNotifyClient';
import { isIssueDueSoon, isIssueOverdue, isLogbookIssue, resolveLogbookIssueStatus } from './logbook';
import { nowIso } from './utils';
import type { LogbookEntry, Profile, RoleDefinition } from '../types';

export async function maybeNotifyLogbookDueStates(
  entries: LogbookEntry[],
  actor: Profile,
  allProfiles: Profile[],
  defs: RoleDefinition[],
  now: number = Date.now(),
): Promise<void> {
  const txs: ReturnType<typeof db.tx.logbookEntries[string]['update']>[] = [];
  const notifTxs: ReturnType<typeof db.tx.notifications[string]['update']>[] = [];
  const overdueDeliveries: Array<{ entryId: string; eventVersion: string }> = [];

  for (const entry of entries) {
    if (!isLogbookIssue(entry)) continue;
    if (resolveLogbookIssueStatus(entry) === 'resolved') continue;

    if (isIssueDueSoon(entry, now) && !(entry.dueSoonNotifiedAt ?? '').trim()) {
      notifTxs.push(...buildLogbookDueSoonNotifications(entry, actor, allProfiles, defs));
      txs.push(
        db.tx.logbookEntries[entry.id].update({
          dueSoonNotifiedAt: nowIso(),
          updatedAt: nowIso(),
        }),
      );
    }

    if (isIssueOverdue(entry, now) && !(entry.overdueNotifiedAt ?? '').trim()) {
      const notifiedAt = nowIso();
      txs.push(
        db.tx.logbookEntries[entry.id].update({
          overdueNotifiedAt: notifiedAt,
          updatedAt: notifiedAt,
        }),
      );
      overdueDeliveries.push({ entryId: entry.id, eventVersion: notifiedAt });
    }
  }

  const all = [...notifTxs, ...txs];
  if (!all.length) return;
  try {
    await db.transact(all);
    const { schedulePushDeliveryFromTxs } = await import('./pushDelivery');
    schedulePushDeliveryFromTxs(notifTxs);
    for (const delivery of overdueDeliveries) {
      void deliverLogbookEvent({ ...delivery, eventType: 'overdue' });
    }
  } catch {
    // Best-effort; ignore permission / race failures
  }
}
