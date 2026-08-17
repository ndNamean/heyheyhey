/**
 * Dashboard / StaffHome preview when a non-assignee opens a Logbook notification.
 * Assignees continue to navigate into Logbook (see decideLogbookNotificationClick).
 */

import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { BACK_PRIORITY, useNativeBack } from '../lib/nativeBack';
import {
  entryDisplayId,
  profileMentionLabel,
  shouldAutoOpenLogbookResolutionForViewer,
} from '../lib/logbookNotificationContent';
import {
  canRemindOverdueToStoreChat,
  listLogbookAssigneeMentionLabels,
  listLogbookAssigneeRecipientUserIds,
  overdueChatRemindState,
} from '../lib/logbookOverdueRemind';
import { remindOverdueToStoreChat } from '../lib/logbookNotifyClient';
import {
  canActOnAssignedIssue,
  isIssueOverdue,
  isLogbookIssue,
  resolveLogbookIssueStatus,
} from '../lib/logbook';
import { badgeClass } from '../lib/utils';
import type { LogbookEntry, Profile, RoleDefinition } from '../types';
import LogbookAssigneeRoster from './LogbookAssigneeRoster';
import OverdueRemindPanel from './OverdueRemindPanel';
import IdentityWithAvatar from './profileAvatar/IdentityWithAvatar';
import { LinkifiedText } from './LinkifiedText';

export type LogbookNotificationClickDecision = 'navigate' | 'preview';

/** Assignees navigate to Logbook; everyone else stays and previews. */
export function decideLogbookNotificationClick(
  type: string,
  profile: Profile,
  entry: LogbookEntry | null | undefined,
  defs: RoleDefinition[],
): LogbookNotificationClickDecision {
  if (!entry) return 'navigate';
  if (shouldAutoOpenLogbookResolutionForViewer(type, profile, entry, defs)) {
    return 'navigate';
  }
  if (canActOnAssignedIssue(profile, entry, defs)) return 'navigate';
  return 'preview';
}

function formatWhen(iso: string | undefined | null): string {
  const raw = (iso ?? '').trim();
  if (!raw) return '—';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString();
  } catch {
    return raw;
  }
}

function actorDisplayName(
  userId: string | undefined | null,
  profiles: Profile[],
  fallback: string,
): string {
  const id = (userId ?? '').trim();
  if (!id) return fallback;
  const p = profiles.find((x) => x.userId === id);
  return profileMentionLabel(p || { userId: id });
}

function profileForUserId(userId: string | undefined | null, profiles: Profile[]): Profile | undefined {
  const id = (userId ?? '').trim();
  if (!id) return undefined;
  return profiles.find((x) => x.userId === id);
}

function IdentityChip({
  profile,
  label,
  testId,
}: {
  profile: Profile | undefined;
  label: string;
  testId?: string;
}) {
  return (
    <IdentityWithAvatar profile={profile}>
      <span data-testid={testId}>{label}</span>
    </IdentityWithAvatar>
  );
}

type Props = {
  open: boolean;
  entry: LogbookEntry | null;
  profile: Profile;
  profiles: Profile[];
  defs: RoleDefinition[];
  onClose: () => void;
  onOpenFullEntry: (entry: LogbookEntry) => void;
};

export default function LogbookNotificationPreviewModal({
  open,
  entry,
  profile,
  profiles,
  defs,
  onClose,
  onOpenFullEntry,
}: Props) {
  const { t } = useLang();
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindDismissed, setRemindDismissed] = useState(false);
  const [remindMsg, setRemindMsg] = useState('');
  const [localRemindedAt, setLocalRemindedAt] = useState('');

  useEffect(() => {
    if (!open) return;
    setRemindBusy(false);
    setRemindDismissed(false);
    setRemindMsg('');
    setLocalRemindedAt((entry?.overdueChatRemindedAt ?? '').trim());
  }, [open, entry?.id, entry?.overdueChatRemindedAt]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useNativeBack(
    () => {
      onClose();
      return true;
    },
    open,
    BACK_PRIORITY.MODAL,
  );

  const entryForRemind = useMemo(() => {
    if (!entry) return null;
    if (!localRemindedAt || localRemindedAt === (entry.overdueChatRemindedAt ?? '').trim()) {
      return entry;
    }
    return { ...entry, overdueChatRemindedAt: localRemindedAt };
  }, [entry, localRemindedAt]);

  const mentionLabels = useMemo(() => {
    if (!entryForRemind) return [];
    return listLogbookAssigneeMentionLabels(entryForRemind, profiles, defs);
  }, [entryForRemind, profiles, defs]);

  const assigneeCount = useMemo(() => {
    if (!entryForRemind) return 0;
    return listLogbookAssigneeRecipientUserIds(entryForRemind, profiles, defs).length;
  }, [entryForRemind, profiles, defs]);

  if (!open) return null;

  const status = entry && isLogbookIssue(entry) ? resolveLogbookIssueStatus(entry) : '';
  const overdue = entry ? isIssueOverdue(entry) : false;
  const storeLabel = entry
    ? [entry.store?.code, entry.store?.name].filter(Boolean).join(' — ') ||
      entry.storeId ||
      t.common.allStores
    : '';

  const resolvedActor = entry
    ? actorDisplayName(
        entry.reviewedByUserId || entry.resolvedByUserId,
        profiles,
        t.logbook.previewUnknownActor,
      )
    : '';
  const recalledActor = entry
    ? actorDisplayName(entry.recalledByUserId, profiles, t.logbook.previewUnknownActor)
    : '';

  const canRemind =
    !!entryForRemind && canRemindOverdueToStoreChat(profile, entryForRemind, defs);
  const remindState = entryForRemind
    ? overdueChatRemindState(entryForRemind, assigneeCount)
    : 'not_eligible_status';
  const showRemind =
    canRemind && !remindDismissed && remindState !== 'not_eligible_status';

  async function confirmRemind() {
    if (!entryForRemind) return;
    setRemindBusy(true);
    setRemindMsg('');
    try {
      const result = await remindOverdueToStoreChat({ entryId: entryForRemind.id });
      if (result.ok) {
        setLocalRemindedAt(new Date().toISOString());
        setRemindMsg(t.logbook.overdueRemindSuccess);
        return;
      }
      if (result.skipped) {
        if (result.reason === 'no_longer_overdue') {
          setRemindMsg(t.logbook.overdueRemindSkipNoLonger);
        } else if (result.reason === 'already_reminded') {
          setLocalRemindedAt(localRemindedAt || new Date().toISOString());
          setRemindMsg(t.logbook.overdueRemindSkipAlready);
        } else if (result.reason === 'missing_assignment') {
          setRemindMsg(t.logbook.overdueRemindSkipUnassigned);
        } else {
          setRemindMsg(result.message || t.logbook.overdueRemindFailed);
        }
        return;
      }
      setRemindMsg(result.message || t.logbook.overdueRemindFailed);
    } finally {
      setRemindBusy(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logbook-notif-preview-title"
      data-testid="logbook-notif-preview-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card" style={{ maxWidth: 480, width: '100%', margin: '40px auto' }}>
        <h2 id="logbook-notif-preview-title" style={{ marginTop: 0 }}>
          {t.logbook.previewTitle}
        </h2>

        {!entry ? (
          <p className="small" data-testid="logbook-notif-preview-missing">
            {t.logbook.previewMissingEntry}
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }} data-testid="logbook-notif-preview-content">
              {entry.content ? (
                <LinkifiedText text={entry.content} standalone="never" />
              ) : (
                '—'
              )}
            </p>

            <dl className="small" style={{ margin: 0, display: 'grid', gap: 6 }}>
              <div>
                <dt style={{ display: 'inline', fontWeight: 600 }}>{t.logbook.previewEntryId}: </dt>
                <dd style={{ display: 'inline', margin: 0 }} data-testid="logbook-notif-preview-id">
                  {entryDisplayId(entry.id)}
                </dd>
                <span style={{ margin: '0 6px' }}>·</span>
                <dt style={{ display: 'inline', fontWeight: 600 }}>{t.logbook.previewCreatedBy}: </dt>
                <dd
                  style={{ display: 'inline', margin: 0 }}
                  data-testid="logbook-notif-preview-created-by"
                >
                  <IdentityChip
                    profile={profileForUserId(entry.authorUserId, profiles)}
                    label={actorDisplayName(
                      entry.authorUserId,
                      profiles,
                      t.logbook.previewUnknownActor,
                    )}
                  />
                </dd>
              </div>
              <div>
                <dt style={{ display: 'inline', fontWeight: 600 }}>{t.common.store}: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>{storeLabel}</dd>
              </div>
              <div>
                <dt style={{ display: 'inline', fontWeight: 600 }}>{t.logbook.previewCreated}: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>{formatWhen(entry.createdAt)}</dd>
              </div>
              {isLogbookIssue(entry) && (
                <>
                  <div>
                    <dt style={{ display: 'inline', fontWeight: 600 }}>{t.logbook.previewDue}: </dt>
                    <dd style={{ display: 'inline', margin: 0 }}>{formatWhen(entry.dueAt)}</dd>
                  </div>
                  <div>
                    <dt style={{ display: 'inline', fontWeight: 600 }}>{t.logbook.previewStatus}: </dt>
                    <dd style={{ display: 'inline', margin: 0 }}>
                      {status ? (
                        <span className={badgeClass(status)}>{statusLabel(t, status)}</span>
                      ) : (
                        '—'
                      )}
                      {overdue ? (
                        <span className="badge bad" style={{ marginLeft: 6 }}>
                          {t.logbook.statusOverdue}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ display: 'inline', fontWeight: 600 }}>{t.logbook.previewAssignee}: </dt>
                    <dd style={{ display: 'inline', margin: 0 }} data-testid="logbook-notif-preview-assignee">
                      {(entry.assigneeRole || '').trim() || '—'}
                      <LogbookAssigneeRoster
                        entry={entry}
                        profiles={profiles}
                        defs={defs}
                        copy={{
                          assigneeNotSubmitted: t.logbook.assigneeNotSubmitted,
                          assigneeSubmitted: t.logbook.assigneeSubmitted,
                          assigneeWaitingApproval: t.logbook.assigneeWaitingApproval,
                          assigneeCorrection: t.logbook.assigneeCorrection,
                          assigneeApproved: t.logbook.assigneeApproved,
                          assigneeRosterSummary: t.logbook.assigneeRosterSummary,
                        }}
                      />
                    </dd>
                  </div>
                </>
              )}
            </dl>

            {status === 'resolved' && (
              <div className="small" style={{ margin: '12px 0 0' }} data-testid="logbook-notif-preview-resolved">
                {t.logbook.previewAlreadyResolved.replace('{name}', '').trim()}{' '}
                <IdentityChip
                  profile={profileForUserId(
                    entry.reviewedByUserId || entry.resolvedByUserId,
                    profiles,
                  )}
                  label={resolvedActor}
                />
              </div>
            )}
            {status === 'recalled' && (
              <div className="small" style={{ margin: '12px 0 0' }} data-testid="logbook-notif-preview-recalled">
                {t.logbook.previewAlreadyRecalled.replace('{name}', '').trim()}{' '}
                <IdentityChip
                  profile={profileForUserId(entry.recalledByUserId, profiles)}
                  label={recalledActor}
                />
              </div>
            )}

            {showRemind && entryForRemind && (
              <OverdueRemindPanel
                state={remindState}
                mentionLabels={mentionLabels}
                remindedAt={entryForRemind.overdueChatRemindedAt}
                storeId={entryForRemind.storeId}
                entryId={entryForRemind.id}
                remindMessageId={entryForRemind.overdueChatRemindMessageId}
                busy={remindBusy}
                copy={{
                  assignedTo: t.logbook.overdueRemindAssignedTo,
                  unassignedBlock: t.logbook.overdueRemindUnassigned,
                  askRemind: t.logbook.overdueRemindAsk,
                  confirmRemind: t.logbook.overdueRemindConfirm,
                  notNow: t.logbook.overdueRemindNotNow,
                  alreadyReminded: t.logbook.overdueRemindAlready,
                  openStoreChat: t.logbook.overdueRemindOpenChat,
                  reminding: t.logbook.overdueRemindBusy,
                }}
                onConfirm={() => void confirmRemind()}
                onDismiss={() => setRemindDismissed(true)}
              />
            )}

            {remindMsg ? (
              <p className="small" style={{ margin: '8px 0 0' }} data-testid="logbook-notif-preview-remind-msg">
                {remindMsg}
              </p>
            ) : null}
          </>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {entry ? (
            <button
              type="button"
              className="secondary"
              data-testid="logbook-notif-preview-open-full"
              onClick={() => onOpenFullEntry(entry)}
            >
              {t.logbook.previewOpenFull}
            </button>
          ) : null}
          <button type="button" onClick={onClose} data-testid="logbook-notif-preview-close">
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}
