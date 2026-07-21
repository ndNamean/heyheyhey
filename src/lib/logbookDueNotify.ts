/**
 * Opportunistic due-soon / overdue notifications for logbook issues.
 * Call on Logbook / Dashboard open. Dedups via dueSoonNotifiedAt / overdueNotifiedAt.
 */

import { db } from '../db';
import {
  buildLogbookDueSoonNotifications,
  buildLogbookOverdueNotifications,
} from './notifications';
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
      notifTxs.push(...buildLogbookOverdueNotifications(entry, actor, allProfiles, defs));
      txs.push(
        db.tx.logbookEntries[entry.id].update({
          overdueNotifiedAt: nowIso(),
          updatedAt: nowIso(),
        }),
      );
    }
  }

  const all = [...notifTxs, ...txs];
  if (!all.length) return;
  try {
    await db.transact(all);
  } catch {
    // Best-effort; ignore permission / race failures
  }
}
