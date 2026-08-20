/**
 * Opportunistic due-soon / overdue notifications for logbook issues.
 * Call on Logbook / Dashboard open. Dedups via dueSoonNotifiedAt / overdueNotifiedAt.
 * Overdue inbox is Admin SDK (client cannot create logbook_* except due_soon).
 * Overdue Store Chat stays explicit via remind_overdue_chat.
 */

import { db } from '../db';
import { buildLogbookDueSoonNotifications } from './notifications';
import { deliverLogbookEvent } from './logbookNotifyClient';
import { isIssueDueSoon, isIssueOverdue, isLogbookIssue, resolveLogbookIssueStatus } from './logbook';
import { nowIso } from './utils';
import type { LogbookEntry, Profile, RoleDefinition } from '../types';

const CLIENT_TX_BATCH_SIZE = 8;

let dueNotifyChain: Promise<unknown> = Promise.resolve();
const reservedEntryIds = new Set<string>();

export async function maybeNotifyLogbookDueStates(
  entries: LogbookEntry[],
  actor: Profile,
  allProfiles: Profile[],
  defs: RoleDefinition[],
  now: number = Date.now(),
): Promise<boolean> {
  const overdueIds = entries
    .filter(
      (entry) =>
        isLogbookIssue(entry) &&
        resolveLogbookIssueStatus(entry) !== 'resolved' &&
        isIssueOverdue(entry, now) &&
        !(entry.overdueNotifiedAt ?? '').trim() &&
        !reservedEntryIds.has(entry.id),
    )
    .map((entry) => entry.id);
  for (const id of overdueIds) reservedEntryIds.add(id);

  const run = dueNotifyChain.then(() =>
    runLogbookDueStateNotify(entries, actor, allProfiles, defs, now, overdueIds),
  );
  dueNotifyChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runLogbookDueStateNotify(
  entries: LogbookEntry[],
  actor: Profile,
  allProfiles: Profile[],
  defs: RoleDefinition[],
  now: number,
  overdueIds: string[],
): Promise<boolean> {
  const stampTxs: ReturnType<typeof db.tx.logbookEntries[string]['update']>[] = [];
  const dueSoonNotifTxs: ReturnType<typeof db.tx.notifications[string]['update']>[] = [];
  const overdueToDeliver = overdueIds.map((entryId) => ({
    entryId,
    eventVersion: nowIso(),
  }));
  const reservedIds: string[] = [...overdueIds];

  for (const entry of entries) {
    if (!isLogbookIssue(entry)) continue;
    if (resolveLogbookIssueStatus(entry) === 'resolved') continue;
    if (reservedEntryIds.has(entry.id)) continue;

    if (isIssueDueSoon(entry, now) && !(entry.dueSoonNotifiedAt ?? '').trim()) {
      dueSoonNotifTxs.push(...buildLogbookDueSoonNotifications(entry, actor, allProfiles, defs));
      stampTxs.push(
        db.tx.logbookEntries[entry.id].update({
          dueSoonNotifiedAt: nowIso(),
          updatedAt: nowIso(),
        }),
      );
      reservedEntryIds.add(entry.id);
      reservedIds.push(entry.id);
    }
  }

  const clientTxs = [...dueSoonNotifTxs, ...stampTxs];
  if (clientTxs.length) {
    try {
      for (let i = 0; i < clientTxs.length; i += CLIENT_TX_BATCH_SIZE) {
        await db.transact(clientTxs.slice(i, i + CLIENT_TX_BATCH_SIZE));
      }
      if (dueSoonNotifTxs.length) {
        const { schedulePushDeliveryFromTxs } = await import('./pushDelivery');
        schedulePushDeliveryFromTxs(dueSoonNotifTxs);
      }
    } catch {
      for (const id of reservedIds) reservedEntryIds.delete(id);
      return false;
    }
  }

  for (const row of overdueToDeliver) {
    void deliverLogbookEvent({
      entryId: row.entryId,
      eventType: 'overdue',
      eventVersion: row.eventVersion,
      inboxOnly: true,
    });
  }
  return true;
}
