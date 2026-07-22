import { useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import TimemarkCamera from '../components/TimemarkCamera';
import ProofPhoto from '../components/ProofPhoto';
import { LogbookTimeline } from '../components/ReportTimeline';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { canReview } from '../lib/roles';
import { nowIso, todayYmd, badgeClass } from '../lib/utils';
import { statusLabel } from '../lib/i18nUtils';
import {
  LOGBOOK_ASSIGNEE_ROLES,
  LOGBOOK_FILTER_KEY,
  LOGBOOK_HIGHLIGHT_KEY,
  canActOnAssignedIssue,
  canAddCreatorUpdate,
  canEditLogbookAssignment,
  canHardDeleteLogbookIssue,
  canOpenLogbook,
  canRecallLogbookIssue,
  canReviewLogbookIssue,
  canSubmitResolutionNow,
  canViewLogbookEntry,
  defaultLogbookFilterTab,
  getIssueConfigurationState,
  isIssueOverdue,
  isLogbookIssue,
  issueCreateFields,
  logSubmitStepFailure,
  noteOrAnnouncementFields,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
  resolveResolutionMedia,
  resolveSourceMedia,
} from '../lib/logbook';
import {
  PROOF_TYPES,
  canSubmitResolutionDraft,
  emptyResolutionDraft,
  hasCorrectionFeedback,
  isSameResolutionAttempt,
  needsMedia,
  needsNote,
  needsNumber,
  needsTick,
  proofTypeLabel,
  resolveLogbookProofType,
  type LogbookResolutionDraft,
} from '../lib/logbookResolution';
import { maybeNotifyLogbookDueStates } from '../lib/logbookDueNotify';
import { postLogbookNotify } from '../lib/logbookNotifyClient';
import {
  buildLogbookCreatorUpdateNotifications,
  buildLogbookIssueAssignedNotifications,
  buildLogbookIssueRecalledNotifications,
  buildLogbookIssueReopenedNotifications,
  buildLogbookResolutionDecisionNotifications,
} from '../lib/notifications';
import {
  buildLogbookAssignmentChangedEvent,
  buildLogbookCreatorUpdateEvent,
  buildLogbookIssueCreatedEvents,
  buildLogbookIssueRecalledEvent,
  buildLogbookIssueReopenedEvent,
  buildLogbookResolutionApprovedEvent,
  buildLogbookResolutionRejectedEvent,
  buildLogbookResolutionSubmittedEvent,
  buildLogbookWorkStartedEvent,
} from '../lib/reviewEvents';
import type {
  IssueConfigurationState,
  LogbookEntry,
  LogbookEntryType,
  Profile,
  ProofType,
  ReviewEvent,
  Store,
  UploadedMedia,
} from '../types';

interface Props {
  profile: Profile;
  initialFilter?: string;
  highlightEntryId?: string | null;
}

type FilterTab =
  | 'all'
  | 'my-assigned'
  | 'open'
  | 'waiting_approval'
  | 'overdue'
  | 'resolved'
  | 'correction';

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearSession(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function openResolutionSessionKey(): string {
  return 'logbookOpenResolutionEntryId';
}

export default function LogbookPage({
  profile,
  initialFilter,
  highlightEntryId: highlightProp,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [storeId, setStoreId] = useState('all');
  const [date, setDate] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>(() => {
    const fromSession = (initialFilter || readSession(LOGBOOK_FILTER_KEY) || '') as FilterTab;
    if (
      fromSession === 'all' ||
      fromSession === 'my-assigned' ||
      fromSession === 'open' ||
      fromSession === 'waiting_approval' ||
      fromSession === 'overdue' ||
      fromSession === 'resolved' ||
      fromSession === 'correction'
    ) {
      return fromSession;
    }
    return defaultLogbookFilterTab(profile, defs);
  });
  const [entryTypeFilter, setEntryTypeFilter] = useState<'all' | LogbookEntryType>('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [requiresAckOnly, setRequiresAckOnly] = useState(false);
  const [waitingMyReview, setWaitingMyReview] = useState(false);
  const [correctionOnly, setCorrectionOnly] = useState(false);
  const [highlightId] = useState<string | null>(
    () => highlightProp || readSession(LOGBOOK_HIGHLIGHT_KEY),
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    entryType: 'note' as LogbookEntryType,
    storeId: '',
    shift: 'AM',
    content: '',
    severity: 'info',
    requiresAck: false,
    assigneeRole: 'staff' as string,
    dueAt: '',
    resolutionProofType: 'photo' as ProofType,
    resolutionRequirement: '',
  });
  const [saving, setSaving] = useState(false);
  const [proofEntryId, setProofEntryId] = useState<string | null>(
    () => readSession(openResolutionSessionKey()),
  );
  const [draft, setDraft] = useState<LogbookResolutionDraft>(() => emptyResolutionDraft());
  const [showCamera, setShowCamera] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [notifySoftFail, setNotifySoftFail] = useState<{
    entryId: string;
    attemptId: string;
  } | null>(null);
  const [creatorUpdateEntryId, setCreatorUpdateEntryId] = useState<string | null>(null);
  const [creatorNote, setCreatorNote] = useState('');
  const [creatorMedia, setCreatorMedia] = useState<UploadedMedia | null>(null);
  const [showCreatorCamera, setShowCreatorCamera] = useState(false);
  const [setupEntryId, setSetupEntryId] = useState<string | null>(null);
  const [setupForm, setSetupForm] = useState({
    assigneeRole: 'staff',
    dueAt: '',
    resolutionProofType: 'photo' as ProofType,
    resolutionRequirement: '',
  });
  const dueNotifyRan = useRef(false);

  const { data } = db.useQuery({
    logbookEntries: {
      store: {},
      photo: {},
      sourceMedia: {},
      resolutionMedia: {},
    },
    stores: {},
    profiles: { stores: {} },
    reviewEvents: {},
  });

  const allEntries: LogbookEntry[] = (data?.logbookEntries ?? []) as LogbookEntry[];
  const stores: Store[] = (data?.stores ?? []) as Store[];
  const allProfiles: Profile[] = (data?.profiles ?? []) as Profile[];
  const allEvents: ReviewEvent[] = (data?.reviewEvents ?? []) as ReviewEvent[];

  const assignedIssueExists = useMemo(
    () =>
      allEntries.some(
        (e) =>
          isLogbookIssue(e) &&
          resolveLogbookIssueStatus(e) !== 'resolved' &&
          resolveLogbookIssueStatus(e) !== 'recalled' &&
          e.assigneeRole === profile.role &&
          (profile.stores ?? []).some((s) => s.id === e.storeId),
      ),
    [allEntries, profile],
  );

  const canCreate = canReview(profile.role, defs);
  const pageOpen = canOpenLogbook(profile, defs, assignedIssueExists);

  /** Active proof panel entry — resolved from all entries, ignoring filters. */
  const activeProofEntry = useMemo(() => {
    if (!proofEntryId) return null;
    return allEntries.find((e) => e.id === proofEntryId) || null;
  }, [allEntries, proofEntryId]);

  const visibleEntries = useMemo(() => {
    const now = Date.now();
    return allEntries
      .filter((e) => canViewLogbookEntry(profile, e, defs))
      .filter((e) => {
        // Hide the duplicate issue card while the resolution form is open
        if (proofEntryId && e.id === proofEntryId) return false;
        if (storeId !== 'all' && e.storeId !== storeId && e.storeId !== '') return false;
        if (date && e.date !== date) return false;
        const type = resolveLogbookEntryType(e);
        if (entryTypeFilter !== 'all' && type !== entryTypeFilter) return false;
        if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
        if (assigneeFilter !== 'all' && (e.assigneeRole || '') !== assigneeFilter) return false;
        if (requiresAckOnly && !e.requiresAck) return false;
        if (overdueOnly && !isIssueOverdue(e, now)) return false;
        if (correctionOnly && !hasCorrectionFeedback(e)) return false;
        if (waitingMyReview) {
          if (
            resolveLogbookIssueStatus(e) !== 'waiting_approval' ||
            !canReviewLogbookIssue(profile, e, defs)
          ) {
            return false;
          }
        }

        const status = resolveLogbookIssueStatus(e);
        switch (filterTab) {
          case 'my-assigned':
            return (
              isLogbookIssue(e) &&
              status !== 'recalled' &&
              e.assigneeRole === profile.role &&
              (profile.stores ?? []).some((s) => s.id === e.storeId)
            );
          case 'open':
            return isLogbookIssue(e) && status === 'open';
          case 'waiting_approval':
            return isLogbookIssue(e) && status === 'waiting_approval';
          case 'overdue':
            return isIssueOverdue(e, now);
          case 'resolved':
            return isLogbookIssue(e) && status === 'resolved';
          case 'correction':
            return hasCorrectionFeedback(e);
          default:
            return true;
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [
    allEntries,
    profile,
    defs,
    storeId,
    date,
    entryTypeFilter,
    severityFilter,
    assigneeFilter,
    requiresAckOnly,
    overdueOnly,
    waitingMyReview,
    correctionOnly,
    filterTab,
    proofEntryId,
  ]);

  useEffect(() => {
    clearSession(LOGBOOK_FILTER_KEY);
    clearSession(LOGBOOK_HIGHLIGHT_KEY);
    clearSession(openResolutionSessionKey());
  }, []);

  useEffect(() => {
    if (dueNotifyRan.current || !pageOpen || !allEntries.length) return;
    dueNotifyRan.current = true;
    const visible = allEntries.filter((e) => canViewLogbookEntry(profile, e, defs));
    void maybeNotifyLogbookDueStates(visible, profile, allProfiles, defs);
  }, [pageOpen, allEntries, allProfiles, profile, defs]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`logbook-entry-${highlightId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const entry = allEntries.find((e) => e.id === highlightId);
    if (
      entry &&
      canActOnAssignedIssue(profile, entry, defs) &&
      (resolveLogbookIssueStatus(entry) === 'in_progress' ||
        resolveLogbookIssueStatus(entry) === 'open') &&
      hasCorrectionFeedback(entry)
    ) {
      openResolutionForm(entry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once on highlight
  }, [highlightId, allEntries.length]);

  function openResolutionForm(entry: LogbookEntry) {
    setProofEntryId(entry.id);
    setDraft(emptyResolutionDraft(entry));
    setShowCamera(false);
    setSubmitError('');
    setSuccessMsg('');
    try {
      sessionStorage.setItem(openResolutionSessionKey(), entry.id);
    } catch {
      /* ignore */
    }
  }

  function closeResolutionForm() {
    setProofEntryId(null);
    setDraft(emptyResolutionDraft());
    setShowCamera(false);
    setSubmitError('');
    clearSession(openResolutionSessionKey());
  }

  if (!pageOpen) {
    return <div className="card">{t.logbook.noPermission}</div>;
  }

  async function addEntry() {
    if (!form.content.trim()) return alert(t.logbook.contentRequired);
    if (form.entryType === 'issue') {
      if (!form.storeId) return alert(t.logbook.issueStoreRequired);
      if (!form.assigneeRole) return alert(t.logbook.assigneeRequired);
      if (!form.dueAt) return alert(t.logbook.dueRequired);
      if (!form.resolutionProofType) return alert(t.logbook.proofTypeRequired);
    }
    if (!canCreate) return alert(t.logbook.noCreatePermission);
    setSaving(true);
    try {
      const entryId = id();
      const storeTarget = form.entryType === 'issue' ? form.storeId : form.storeId || '';
      const typeFields =
        form.entryType === 'issue'
          ? issueCreateFields(
              form.assigneeRole,
              new Date(form.dueAt).toISOString(),
              form.resolutionProofType,
              form.resolutionRequirement,
            )
          : noteOrAnnouncementFields(form.entryType);

      const tx = db.tx.logbookEntries[entryId].update({
        storeId: storeTarget,
        authorUserId: profile.userId,
        date: todayYmd(),
        shift: form.shift,
        content: form.content.trim(),
        severity: form.severity,
        requiresAck: form.requiresAck,
        ackUserIdsJson: '[]',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...typeFields,
      });

      const txs: unknown[] = [tx];
      if (storeTarget) {
        txs.push(db.tx.logbookEntries[entryId].link({ store: storeTarget }));
      }

      if (form.entryType === 'issue') {
        const entryLike = {
          id: entryId,
          storeId: storeTarget,
          content: form.content.trim(),
          assigneeRole: form.assigneeRole,
          dueAt: new Date(form.dueAt).toISOString(),
          severity: form.severity as LogbookEntry['severity'],
          entryType: 'issue' as const,
          isAnnouncement: false,
          status: 'open' as const,
          resolutionProofType: form.resolutionProofType,
          resolutionRequirement: form.resolutionRequirement,
        } as LogbookEntry;
        txs.push(...buildLogbookIssueCreatedEvents(entryLike, profile));
        txs.push(
          ...buildLogbookIssueAssignedNotifications(entryLike, profile, allProfiles, defs),
        );
      }

      await db.transact(txs as Parameters<typeof db.transact>[0]);
      setForm({
        entryType: 'note',
        storeId: '',
        shift: 'AM',
        content: '',
        severity: 'info',
        requiresAck: false,
        assigneeRole: 'staff',
        dueAt: '',
        resolutionProofType: 'photo',
        resolutionRequirement: '',
      });
      setShowForm(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.logbook.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge(entry: LogbookEntry) {
    if (!entry.requiresAck) return;
    const current: string[] = JSON.parse(entry.ackUserIdsJson || '[]');
    if (current.includes(profile.userId)) return;
    const updated = [...current, profile.userId];
    await db.transact(
      db.tx.logbookEntries[entry.id].update({
        ackUserIdsJson: JSON.stringify(updated),
        updatedAt: nowIso(),
      }),
    );
  }

  async function startWork(entry: LogbookEntry) {
    if (!canActOnAssignedIssue(profile, entry, defs)) return;
    if (resolveLogbookIssueStatus(entry) !== 'open') return;
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'in_progress',
        startedAt: nowIso(),
        startedByUserId: profile.userId,
        updatedAt: nowIso(),
      }),
      buildLogbookWorkStartedEvent(entry, profile, 'open'),
    ]);
  }

  async function submitResolution(entry: LogbookEntry) {
    const live = allEntries.find((e) => e.id === entry.id) || entry;
    if (!canSubmitResolutionNow(profile, live, defs)) {
      setSubmitError(t.logbook.staleSubmitBlocked);
      logSubmitStepFailure({
        entryId: live.id,
        actorRole: profile.role,
        attemptedStep: 'gate',
        message: 'Cannot submit — status/assignee gate failed',
      });
      return;
    }
    const proofType = resolveLogbookProofType(live);
    if (!canSubmitResolutionDraft(proofType, draft)) {
      setSubmitError(t.logbook.resolutionIncomplete);
      return;
    }
    if (needsMedia(proofType) && !draft.media) {
      setSubmitError(t.logbook.resolutionIncomplete);
      return;
    }

    const attemptId = id();
    if (isSameResolutionAttempt(live, attemptId)) {
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setNotifySoftFail(null);
    const note = draft.note.trim();
    const prevStatus = resolveLogbookIssueStatus(live) || 'in_progress';
    const priorResolutionId = live.resolutionMedia?.id || live.photo?.id || '';

    try {
      // Stage A — core tx only (no notifications)
      const txs: unknown[] = [];
      if (priorResolutionId && draft.media) {
        if (live.resolutionMedia?.id) {
          txs.push(
            db.tx.logbookEntries[live.id].unlink({ resolutionMedia: priorResolutionId }),
          );
        }
        if (live.photo?.id === priorResolutionId) {
          txs.push(db.tx.logbookEntries[live.id].unlink({ photo: priorResolutionId }));
        }
      }
      txs.push(
        db.tx.logbookEntries[live.id].update({
          status: 'waiting_approval',
          resolutionNote: note,
          resolutionNumber: draft.numberValue.trim(),
          resolutionChecked: draft.checked,
          resolutionSubmittedAt: nowIso(),
          resolutionSubmittedByUserId: profile.userId,
          resolutionAttemptId: attemptId,
          updatedAt: nowIso(),
        }),
      );
      if (draft.media) {
        txs.push(
          db.tx.logbookEntries[live.id].link({ resolutionMedia: draft.media.fileId }),
          // Keep legacy photo in sync during transition
          db.tx.logbookEntries[live.id].link({ photo: draft.media.fileId }),
        );
      }
      txs.push(
        buildLogbookResolutionSubmittedEvent(
          live,
          profile,
          prevStatus,
          note ? `${note}\nattempt:${attemptId}` : `attempt:${attemptId}`,
          priorResolutionId,
        ),
      );
      await db.transact(txs as Parameters<typeof db.transact>[0]);
    } catch (e) {
      const message = e instanceof Error ? e.message : t.logbook.saveFailed;
      logSubmitStepFailure({
        entryId: live.id,
        actorRole: profile.role,
        attemptedStep: 'stage_a',
        message,
      });
      setSubmitError(message);
      setSubmitting(false);
      return;
    }

    // Stage B — soft-fail notifications via Admin SDK
    const notify = await postLogbookNotify({
      entryId: live.id,
      type: 'resolution_submitted',
      attemptId,
    });
    if (!notify.ok) {
      logSubmitStepFailure({
        entryId: live.id,
        actorRole: profile.role,
        attemptedStep: 'stage_b_notify',
        message: notify.message,
      });
      setNotifySoftFail({ entryId: live.id, attemptId });
      setSuccessMsg(t.logbook.submitSuccessNotifyPending);
    } else {
      setSuccessMsg(t.logbook.submitSuccess);
    }

    closeResolutionForm();
    setFilterTab('my-assigned');
    setWaitingMyReview(false);
    setOverdueOnly(false);
    setCorrectionOnly(false);
    setRequiresAckOnly(false);
    setSubmitting(false);
  }

  async function retryNotify() {
    if (!notifySoftFail) return;
    const result = await postLogbookNotify({
      entryId: notifySoftFail.entryId,
      type: 'resolution_submitted',
      attemptId: notifySoftFail.attemptId,
    });
    if (result.ok) {
      setNotifySoftFail(null);
      setSuccessMsg(t.logbook.notifyRetrySuccess);
    } else {
      setSubmitError(result.message);
    }
  }

  async function approveResolution(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs)) return;
    const note = prompt(t.logbook.reviewNotePrompt) ?? '';
    if (!note.trim()) return alert(t.logbook.reviewNoteRequired);
    const now = nowIso();
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'resolved',
        resolvedAt: now,
        resolvedByUserId: entry.resolutionSubmittedByUserId || '',
        reviewedAt: now,
        reviewedByUserId: profile.userId,
        reviewNote: note.trim(),
        updatedAt: now,
      }),
      buildLogbookResolutionApprovedEvent(entry, profile, note.trim()),
      ...buildLogbookResolutionDecisionNotifications(
        { ...entry, reviewNote: note.trim() },
        profile,
        allProfiles,
        'approved',
        defs,
      ),
    ]);
  }

  async function requestCorrection(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs)) return;
    const note = prompt(t.logbook.correctionNotePrompt) ?? '';
    if (!note.trim()) return alert(t.logbook.reviewNoteRequired);
    const now = nowIso();
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'in_progress',
        reviewedAt: now,
        reviewedByUserId: profile.userId,
        reviewNote: note.trim(),
        updatedAt: now,
      }),
      buildLogbookResolutionRejectedEvent(entry, profile, note.trim()),
      ...buildLogbookResolutionDecisionNotifications(
        { ...entry, reviewNote: note.trim() },
        profile,
        allProfiles,
        'rejected',
        defs,
      ),
    ]);
  }

  async function reopenIssue(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs) && !canEditLogbookAssignment(profile, entry, defs)) {
      return;
    }
    const reason = prompt(t.logbook.reopenReasonPrompt) ?? '';
    if (!reason.trim()) return alert(t.logbook.reopenReasonRequired);
    const now = nowIso();
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        status: 'in_progress',
        reopenedAt: now,
        reopenedByUserId: profile.userId,
        reopenReason: reason.trim(),
        updatedAt: now,
      }),
      buildLogbookIssueReopenedEvent(entry, profile, reason.trim()),
      ...buildLogbookIssueReopenedNotifications(
        { ...entry, reopenReason: reason.trim() },
        profile,
        allProfiles,
        defs,
      ),
    ]);
  }

  async function changeAssignment(entry: LogbookEntry) {
    if (!canEditLogbookAssignment(profile, entry, defs)) return;
    const role =
      prompt(t.logbook.changeAssigneePrompt, entry.assigneeRole || 'staff')?.trim() || '';
    if (!role || !LOGBOOK_ASSIGNEE_ROLES.includes(role as (typeof LOGBOOK_ASSIGNEE_ROLES)[number])) {
      return alert(t.logbook.assigneeRequired);
    }
    const dueLocal = prompt(t.logbook.changeDuePrompt, entry.dueAt?.slice(0, 16) || '')?.trim();
    if (!dueLocal) return alert(t.logbook.dueRequired);
    const reason = prompt(t.logbook.changeReasonPrompt) ?? '';
    if (!reason.trim()) return alert(t.logbook.changeReasonRequired);

    const dueAt = new Date(dueLocal).toISOString();
    const prevStatus = resolveLogbookIssueStatus(entry) || 'open';
    let nextStatus = prevStatus;
    if (prevStatus === 'waiting_approval') {
      const ok = confirm(t.logbook.invalidateWaitingConfirm);
      if (!ok) return;
      nextStatus = 'in_progress';
    }
    const note = `Role: ${entry.assigneeRole} → ${role}; due: ${entry.dueAt} → ${dueAt}. ${reason.trim()}`;

    const updated = { ...entry, assigneeRole: role, dueAt, status: nextStatus };
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        assigneeRole: role,
        dueAt,
        status: nextStatus,
        updatedAt: nowIso(),
      }),
      buildLogbookAssignmentChangedEvent(entry, profile, note, nextStatus, prevStatus),
      ...buildLogbookIssueAssignedNotifications(updated as LogbookEntry, profile, allProfiles, defs),
    ]);
  }

  async function recallIssue(entry: LogbookEntry) {
    if (!canRecallLogbookIssue(profile, entry, defs)) return;
    const reason = prompt(t.logbook.recallReasonPrompt) ?? '';
    if (!reason.trim()) return alert(t.logbook.recallReasonRequired);
    const prevStatus = resolveLogbookIssueStatus(entry) || 'open';
    const now = nowIso();
    try {
      await db.transact([
        db.tx.logbookEntries[entry.id].update({
          status: 'recalled',
          recalledAt: now,
          recalledByUserId: profile.userId,
          recallReason: reason.trim(),
          updatedAt: now,
        }),
        buildLogbookIssueRecalledEvent(entry, profile, reason.trim(), prevStatus),
        ...buildLogbookIssueRecalledNotifications(
          { ...entry, recallReason: reason.trim() },
          profile,
          allProfiles,
          reason.trim(),
          defs,
        ),
      ]);
      if (proofEntryId === entry.id) closeResolutionForm();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.logbook.saveFailed);
    }
  }

  async function hardDeleteIssue(entry: LogbookEntry) {
    if (!canHardDeleteLogbookIssue(profile, entry, defs)) {
      return alert(t.logbook.hardDeleteBlocked);
    }
    if (!confirm(t.logbook.hardDeleteConfirm)) return;
    try {
      await db.transact(db.tx.logbookEntries[entry.id].delete());
    } catch (e) {
      alert(e instanceof Error ? e.message : t.logbook.saveFailed);
    }
  }

  function openSetup(entry: LogbookEntry) {
    setSetupEntryId(entry.id);
    setSetupForm({
      assigneeRole: entry.assigneeRole || 'staff',
      dueAt: entry.dueAt ? entry.dueAt.slice(0, 16) : '',
      resolutionProofType: (resolveLogbookProofType(entry) || 'photo') as ProofType,
      resolutionRequirement: entry.resolutionRequirement || '',
    });
  }

  async function saveSetup(entry: LogbookEntry) {
    if (!canEditLogbookAssignment(profile, entry, defs)) return;
    if (!setupForm.assigneeRole) return alert(t.logbook.assigneeRequired);
    if (!setupForm.dueAt) return alert(t.logbook.dueRequired);
    const dueAt = new Date(setupForm.dueAt).toISOString();
    const prevStatus = resolveLogbookIssueStatus(entry) || 'open';
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        assigneeRole: setupForm.assigneeRole,
        dueAt,
        resolutionProofType: setupForm.resolutionProofType || 'photo',
        resolutionRequirement: setupForm.resolutionRequirement.trim(),
        updatedAt: nowIso(),
      }),
      buildLogbookAssignmentChangedEvent(
        entry,
        profile,
        `Complete setup: role=${setupForm.assigneeRole}; due=${dueAt}`,
        prevStatus,
        prevStatus,
      ),
      ...buildLogbookIssueAssignedNotifications(
        {
          ...entry,
          assigneeRole: setupForm.assigneeRole,
          dueAt,
          resolutionProofType: setupForm.resolutionProofType,
          resolutionRequirement: setupForm.resolutionRequirement,
        },
        profile,
        allProfiles,
        defs,
      ),
    ]);
    setSetupEntryId(null);
  }

  async function saveCreatorUpdate(entry: LogbookEntry) {
    if (!canAddCreatorUpdate(profile, entry, defs)) return;
    if (!creatorNote.trim() && !creatorMedia) {
      return alert(t.logbook.creatorUpdateRequired);
    }
    const prevStatus = resolveLogbookIssueStatus(entry) || 'open';
    let nextStatus = prevStatus;
    if (prevStatus === 'waiting_approval') {
      // Creator update of media/note does not auto-invalidate; assignment change does.
      nextStatus = prevStatus;
    }
    const note = creatorNote.trim() || 'Creator media update';
    const txs: unknown[] = [
      buildLogbookCreatorUpdateEvent(entry, profile, note, nextStatus, prevStatus),
    ];
    if (creatorMedia) {
      txs.push(db.tx.logbookEntries[entry.id].link({ sourceMedia: creatorMedia.fileId }));
    }
    txs.push(
      db.tx.logbookEntries[entry.id].update({ updatedAt: nowIso() }),
      ...buildLogbookCreatorUpdateNotifications(
        entry,
        profile,
        allProfiles,
        note,
        defs,
      ),
    );
    try {
      await db.transact(txs as Parameters<typeof db.transact>[0]);
      setCreatorUpdateEntryId(null);
      setCreatorNote('');
      setCreatorMedia(null);
      setShowCreatorCamera(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.logbook.saveFailed);
    }
  }

  function configBannerLabel(state: IssueConfigurationState): string {
    if (state === 'missing_assignment') return t.logbook.configMissingAssignment;
    if (state === 'missing_deadline') return t.logbook.configMissingDeadline;
    if (state === 'missing_resolution_requirement') return t.logbook.configMissingRequirement;
    return '';
  }

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: t.common.all },
    { id: 'my-assigned', label: t.logbook.myAssigned },
    { id: 'open', label: t.logbook.statusOpen },
    { id: 'waiting_approval', label: t.logbook.statusWaiting },
    { id: 'correction', label: t.logbook.correctionRequested },
    { id: 'overdue', label: t.logbook.statusOverdue },
    { id: 'resolved', label: t.logbook.statusResolved },
  ];

  const proofEntry = activeProofEntry;
  const proofStore = proofEntry
    ? stores.find((s) => s.id === proofEntry.storeId) || proofEntry.store
    : null;
  const proofType = proofEntry ? resolveLogbookProofType(proofEntry) : 'photo';
  const canSubmitDraft = proofEntry
    ? canSubmitResolutionDraft(proofType, draft)
    : false;

  return (
    <div>
      {successMsg && (
        <div className="card" style={{ borderColor: 'var(--success-border, #16a34a)' }}>
          <p style={{ margin: 0 }}>{successMsg}</p>
          {notifySoftFail && (
            <button className="secondary" style={{ marginTop: 8 }} type="button" onClick={() => void retryNotify()}>
              {t.logbook.retryNotify}
            </button>
          )}
          <button className="secondary" style={{ marginTop: 8, marginLeft: notifySoftFail ? 8 : 0 }} type="button" onClick={() => setSuccessMsg('')}>
            {t.common.cancel}
          </button>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, flex: 1 }}>{t.logbook.title}</h1>
          {canCreate && (
            <button onClick={() => setShowForm((v) => !v)}>
              {showForm ? t.common.cancel : t.logbook.addEntry}
            </button>
          )}
        </div>
        <div className="tabs" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={filterTab === tab.id ? 'active' : ''}
              onClick={() => setFilterTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="grid two" style={{ marginTop: 12 }}>
          <label>
            {t.common.store}
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="all">{t.common.allStores}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.common.date}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {t.logbook.entryType}
            <select
              value={entryTypeFilter}
              onChange={(e) => setEntryTypeFilter(e.target.value as 'all' | LogbookEntryType)}
            >
              <option value="all">{t.common.all}</option>
              <option value="note">{t.logbook.typeNote}</option>
              <option value="announcement">{t.logbook.typeAnnouncement}</option>
              <option value="issue">{t.logbook.typeIssue}</option>
            </select>
          </label>
          <label>
            {t.common.severity}
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="all">{t.common.all}</option>
              {['info', 'warning', 'critical'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.logbook.assigneeRole}
            <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="all">{t.common.all}</option>
              {LOGBOOK_ASSIGNEE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            {t.logbook.overdueOnly}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={requiresAckOnly}
              onChange={(e) => setRequiresAckOnly(e.target.checked)}
            />
            {t.logbook.requiresAck}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={waitingMyReview}
              onChange={(e) => setWaitingMyReview(e.target.checked)}
            />
            {t.logbook.waitingMyReview}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={correctionOnly}
              onChange={(e) => setCorrectionOnly(e.target.checked)}
            />
            {t.logbook.correctionRequested}
          </label>
        </div>
      </div>

      {showForm && canCreate && (
        <div className="card">
          <h2>{t.logbook.newEntry}</h2>
          <label>
            {t.logbook.entryType}
            <select
              value={form.entryType}
              onChange={(e) =>
                setForm({ ...form, entryType: e.target.value as LogbookEntryType })
              }
            >
              <option value="note">{t.logbook.typeNote}</option>
              <option value="announcement">{t.logbook.typeAnnouncement}</option>
              <option value="issue">{t.logbook.typeIssue}</option>
            </select>
          </label>
          <div className="grid two" style={{ marginTop: 12 }}>
            <label>
              {form.entryType === 'issue' ? t.common.store : t.logbook.storeOptional}
              <select
                value={form.storeId}
                onChange={(e) => setForm({ ...form, storeId: e.target.value })}
              >
                {form.entryType !== 'issue' && (
                  <option value="">{t.common.allStores}</option>
                )}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.common.shift}
              <select
                value={form.shift}
                onChange={(e) => setForm({ ...form, shift: e.target.value })}
              >
                {['AM', 'PM', 'Night', 'All day'].map((s) => (
                  <option key={s} value={s}>
                    {s === 'All day' ? t.logbook.allDay : s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.common.severity}
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                {['info', 'warning', 'critical'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {form.entryType === 'issue' && (
              <>
                <label>
                  {t.logbook.assigneeRole}
                  <select
                    value={form.assigneeRole}
                    onChange={(e) => setForm({ ...form, assigneeRole: e.target.value })}
                  >
                    {LOGBOOK_ASSIGNEE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.logbook.dueAt}
                  <input
                    type="datetime-local"
                    value={form.dueAt}
                    onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                  />
                </label>
                <label>
                  {t.logbook.resolutionProofType}
                  <select
                    value={form.resolutionProofType}
                    onChange={(e) =>
                      setForm({ ...form, resolutionProofType: e.target.value as ProofType })
                    }
                  >
                    {PROOF_TYPES.map((p) => (
                      <option key={p} value={p}>
                        {proofTypeLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
          <label style={{ marginTop: 12, display: 'block' }}>
            {t.common.content}
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder={t.logbook.contentPlaceholder}
              style={{ marginTop: 4 }}
            />
          </label>
          {form.entryType === 'issue' && (
            <label style={{ marginTop: 12, display: 'block' }}>
              {t.logbook.resolutionRequirement}
              <textarea
                value={form.resolutionRequirement}
                onChange={(e) => setForm({ ...form, resolutionRequirement: e.target.value })}
                placeholder={t.logbook.resolutionRequirementPlaceholder}
                style={{ marginTop: 4 }}
              />
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={form.requiresAck}
              onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })}
            />
            {t.logbook.requiresAck}
          </label>
          <button style={{ marginTop: 12 }} onClick={() => void addEntry()} disabled={saving}>
            {saving ? t.common.saving : t.logbook.saveEntry}
          </button>
        </div>
      )}

      {proofEntry && (
        <div className="card" id="logbook-resolution-panel">
          <h2>{t.logbook.submitResolution}</h2>
          <div
            className="small"
            style={{
              marginBottom: 12,
              padding: 10,
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 8,
              background: 'var(--surface-muted, #f8fafc)',
            }}
          >
            <div>
              <strong>{t.logbook.activeIssueSummary}</strong>
            </div>
            <div>{proofEntry.content}</div>
            <div>
              <strong>{t.logbook.resolutionProofType}:</strong> {proofTypeLabel(proofType)}
              {proofEntry.dueAt
                ? ` · ${t.logbook.dueAt}: ${new Date(proofEntry.dueAt).toLocaleString()}`
                : ` · ${t.logbook.noDeadline}`}
              {` · ${t.logbook.assigneeRole}: ${proofEntry.assigneeRole || '—'}`}
            </div>
            {(proofStore || proofEntry.store) && (
              <div>
                <strong>{t.common.store}:</strong>{' '}
                {(proofStore || proofEntry.store)?.code}
              </div>
            )}
          </div>
          {proofEntry.resolutionRequirement?.trim() && (
            <p className="small" style={{ marginBottom: 12 }}>
              <strong>{t.logbook.resolutionRequirement}:</strong>{' '}
              {proofEntry.resolutionRequirement}
            </p>
          )}
          {hasCorrectionFeedback(proofEntry) && (
            <div className="badge warn" style={{ display: 'block', marginBottom: 12, padding: 8 }}>
              <strong>{t.logbook.correctionRequested}</strong>
              <div>{proofEntry.reviewNote}</div>
            </div>
          )}

          {needsTick(proofType) && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={draft.checked}
                onChange={(e) => setDraft({ ...draft, checked: e.target.checked })}
              />
              {t.logbook.resolutionTick}
            </label>
          )}

          {needsNumber(proofType) && (
            <label style={{ display: 'block', marginBottom: 12 }}>
              {t.logbook.resolutionNumber} *
              <input
                type="number"
                value={draft.numberValue}
                onChange={(e) => setDraft({ ...draft, numberValue: e.target.value })}
                style={{ marginTop: 4 }}
              />
            </label>
          )}

          {(needsNote(proofType) || !needsTick(proofType) || needsMedia(proofType)) && (
            <label style={{ display: 'block', marginBottom: 12 }}>
              {needsNote(proofType)
                ? `${t.logbook.resolutionNoteRequired} *`
                : t.logbook.resolutionNoteOptional}
              <textarea
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                style={{ marginTop: 4 }}
              />
            </label>
          )}

          {needsMedia(proofType) && proofStore && (
            <div style={{ marginBottom: 12 }}>
              <div className="small" style={{ marginBottom: 4 }}>
                {t.logbook.resolutionProof} *
              </div>
              {draft.media ? (
                <div>
                  <ProofPhoto
                    media={{
                      id: draft.media.fileId,
                      url: draft.media.url,
                      fileName: draft.media.fileName,
                      mimeType: draft.media.mimeType,
                    }}
                  />
                  <p className="small">
                    {draft.media.capturedAt
                      ? new Date(draft.media.capturedAt).toLocaleString()
                      : ''}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="secondary" onClick={() => setShowCamera(true)}>
                      {t.camera.retake}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setDraft({ ...draft, media: null })}
                    >
                      {t.logbook.removeProof}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowCamera(true)}>
                  {t.camera.openCamera}
                </button>
              )}
              {showCamera && (
                <div style={{ marginTop: 12 }}>
                  <TimemarkCamera
                    store={proofStore}
                    itemTitle={`Logbook Issue · ${proofEntry.content.slice(0, 40)}`}
                    reportDate={proofEntry.date}
                    proofContext={{
                      type: 'logbook',
                      logbookEntryId: proofEntry.id,
                      storeId: proofEntry.storeId,
                      content: proofEntry.content,
                      mediaPurpose: 'resolution_proof',
                    }}
                    profile={profile}
                    proofType={proofType}
                    existingMedia={[]}
                    onCapture={(media: UploadedMedia) => {
                      setDraft((d) => ({ ...d, media }));
                      setShowCamera(false);
                    }}
                  />
                  <button
                    className="secondary"
                    style={{ marginTop: 8 }}
                    type="button"
                    onClick={() => setShowCamera(false)}
                  >
                    {t.common.cancel}
                  </button>
                </div>
              )}
            </div>
          )}

          {submitError && <p className="small" style={{ color: 'var(--danger, #f87171)' }}>{submitError}</p>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              disabled={submitting || !canSubmitDraft}
              onClick={() => void submitResolution(proofEntry)}
            >
              {submitting ? t.common.saving : t.logbook.submitForApproval}
            </button>
            <button type="button" className="secondary" onClick={closeResolutionForm} disabled={submitting}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      {visibleEntries.map((entry) => {
        const ackIds: string[] = JSON.parse(entry.ackUserIdsJson || '[]');
        const meAcked = ackIds.includes(profile.userId);
        const entryStore = entry.store || stores.find((s) => s.id === entry.storeId);
        const type = resolveLogbookEntryType(entry);
        const status = resolveLogbookIssueStatus(entry);
        const overdue = isIssueOverdue(entry);
        const highlighted = highlightId === entry.id;
        const entryEvents = allEvents.filter((ev) => ev.logbookEntryId === entry.id);
        const entryProofType = resolveLogbookProofType(entry);
        const correction = hasCorrectionFeedback(entry);
        const configState = getIssueConfigurationState(entry);
        const sourceMedia = resolveSourceMedia(entry);
        const resolutionMedia = resolveResolutionMedia(entry);
        const showSetup = type === 'issue' && configState !== 'ready' && canEditLogbookAssignment(profile, entry, defs);

        return (
          <div
            className="card"
            key={entry.id}
            id={`logbook-entry-${entry.id}`}
            style={highlighted ? { outline: '2px solid var(--accent, #2563eb)' } : undefined}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge">
                {type === 'issue'
                  ? t.logbook.typeIssue
                  : type === 'announcement'
                    ? t.logbook.typeAnnouncement
                    : t.logbook.typeNote}
              </span>
              {type === 'issue' && status && (
                <span className={badgeClass(status)}>{statusLabel(t, status)}</span>
              )}
              {overdue && <span className="badge bad">{t.logbook.statusOverdue}</span>}
              {correction && <span className="badge warn">{t.logbook.correctionRequested}</span>}
              <span
                className={`badge ${
                  entry.severity === 'critical'
                    ? 'severity-critical'
                    : entry.severity === 'warning'
                      ? 'severity-warning'
                      : 'severity-info'
                }`}
              >
                {entry.severity}
              </span>
              <span className="badge">{entry.shift}</span>
              {entryStore && <span className="small">{entryStore.code}</span>}
              {type === 'issue' && entry.assigneeRole && (
                <span className="small">
                  {t.logbook.assigneeRole}: {entry.assigneeRole}
                </span>
              )}
              {type === 'issue' && (
                <span className="small">
                  {t.logbook.resolutionProofType}: {proofTypeLabel(entryProofType)}
                </span>
              )}
            </div>

            {type === 'issue' && configState !== 'ready' && (
              <div className="badge warn" style={{ display: 'block', marginTop: 8, padding: 8 }}>
                {configBannerLabel(configState)}
                {showSetup && (
                  <div style={{ marginTop: 6 }}>
                    <button type="button" className="secondary" onClick={() => openSetup(entry)}>
                      {t.logbook.completeIssueSetup}
                    </button>
                  </div>
                )}
              </div>
            )}

            {setupEntryId === entry.id && (
              <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border, #e5e7eb)' }}>
                <div className="grid two">
                  <label>
                    {t.logbook.assigneeRole}
                    <select
                      value={setupForm.assigneeRole}
                      onChange={(e) => setSetupForm({ ...setupForm, assigneeRole: e.target.value })}
                    >
                      {LOGBOOK_ASSIGNEE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.logbook.dueAt}
                    <input
                      type="datetime-local"
                      value={setupForm.dueAt}
                      onChange={(e) => setSetupForm({ ...setupForm, dueAt: e.target.value })}
                    />
                  </label>
                  <label>
                    {t.logbook.resolutionProofType}
                    <select
                      value={setupForm.resolutionProofType}
                      onChange={(e) =>
                        setSetupForm({
                          ...setupForm,
                          resolutionProofType: e.target.value as ProofType,
                        })
                      }
                    >
                      {PROOF_TYPES.map((p) => (
                        <option key={p} value={p}>
                          {proofTypeLabel(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label style={{ display: 'block', marginTop: 8 }}>
                  {t.logbook.resolutionRequirement}
                  <textarea
                    value={setupForm.resolutionRequirement}
                    onChange={(e) =>
                      setSetupForm({ ...setupForm, resolutionRequirement: e.target.value })
                    }
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => void saveSetup(entry)}>
                    {t.logbook.saveSetup}
                  </button>
                  <button type="button" className="secondary" onClick={() => setSetupEntryId(null)}>
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            )}

            <p style={{ margin: '8px 0 0' }}>{entry.content}</p>
            {entry.resolutionRequirement?.trim() && type === 'issue' && (
              <p className="small" style={{ margin: '4px 0 0' }}>
                <strong>{t.logbook.resolutionRequirement}:</strong> {entry.resolutionRequirement}
              </p>
            )}
            <p className="small" style={{ margin: '4px 0 0' }}>
              {entry.date} · {entry.createdAt?.slice(11, 16)}
              {entry.dueAt
                ? ` · ${t.logbook.dueAt}: ${new Date(entry.dueAt).toLocaleString()}`
                : type === 'issue'
                  ? ` · ${t.logbook.noDeadline}`
                  : ''}
            </p>

            {correction && (
              <div className="badge warn" style={{ display: 'block', marginTop: 8, padding: 8 }}>
                <strong>{t.logbook.correctionRequested}</strong>
                <div>{entry.reviewNote}</div>
              </div>
            )}

            {sourceMedia.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="small">{t.logbook.sourceMedia}</div>
                {sourceMedia.map((m) => (
                  <ProofPhoto key={m.id} media={{ id: m.id, url: m.url }} />
                ))}
              </div>
            )}
            {resolutionMedia?.url && (
              <div style={{ marginTop: 8 }}>
                <div className="small">{t.logbook.resolutionProof}</div>
                <ProofPhoto media={{ id: resolutionMedia.id, url: resolutionMedia.url }} />
              </div>
            )}
            {type === 'issue' && (entry.resolutionNote || entry.resolutionNumber || entry.resolutionChecked) && (
              <div className="small" style={{ marginTop: 8 }}>
                {entry.resolutionChecked && <div>{t.logbook.resolutionTick}: ✓</div>}
                {entry.resolutionNumber && (
                  <div>
                    {t.logbook.resolutionNumber}: {entry.resolutionNumber}
                  </div>
                )}
                {entry.resolutionNote && (
                  <div>
                    {t.logbook.resolutionNoteOptional}: {entry.resolutionNote}
                  </div>
                )}
              </div>
            )}

            {creatorUpdateEntryId === entry.id && entryStore && (
              <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border, #e5e7eb)' }}>
                <label style={{ display: 'block' }}>
                  {t.logbook.creatorUpdateNote}
                  <textarea
                    value={creatorNote}
                    onChange={(e) => setCreatorNote(e.target.value)}
                    style={{ marginTop: 4 }}
                  />
                </label>
                {creatorMedia ? (
                  <div style={{ marginTop: 8 }}>
                    <ProofPhoto
                      media={{
                        id: creatorMedia.fileId,
                        url: creatorMedia.url,
                        fileName: creatorMedia.fileName,
                        mimeType: creatorMedia.mimeType,
                      }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      style={{ marginTop: 6 }}
                      onClick={() => setCreatorMedia(null)}
                    >
                      {t.logbook.removeProof}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginTop: 8 }}
                    onClick={() => setShowCreatorCamera(true)}
                  >
                    {t.logbook.addSourceMedia}
                  </button>
                )}
                {showCreatorCamera && (
                  <div style={{ marginTop: 8 }}>
                    <TimemarkCamera
                      store={entryStore}
                      itemTitle={`Logbook update · ${entry.content.slice(0, 40)}`}
                      reportDate={entry.date}
                      proofContext={{
                        type: 'logbook',
                        logbookEntryId: entry.id,
                        storeId: entry.storeId,
                        content: entry.content,
                        mediaPurpose: 'source_context',
                      }}
                      profile={profile}
                      proofType="photo"
                      existingMedia={[]}
                      onCapture={(media: UploadedMedia) => {
                        setCreatorMedia(media);
                        setShowCreatorCamera(false);
                      }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      style={{ marginTop: 8 }}
                      onClick={() => setShowCreatorCamera(false)}
                    >
                      {t.common.cancel}
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" onClick={() => void saveCreatorUpdate(entry)}>
                    {t.logbook.saveCreatorUpdate}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setCreatorUpdateEntryId(null);
                      setCreatorNote('');
                      setCreatorMedia(null);
                      setShowCreatorCamera(false);
                    }}
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            )}

            {type === 'issue' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {canActOnAssignedIssue(profile, entry, defs) && status === 'open' && (
                  <button type="button" onClick={() => void startWork(entry)}>
                    {t.logbook.startWork}
                  </button>
                )}
                {canActOnAssignedIssue(profile, entry, defs) &&
                  (status === 'in_progress' || status === 'open') && (
                    <button type="button" onClick={() => openResolutionForm(entry)}>
                      {correction ? t.logbook.resubmitResolution : t.logbook.submitResolution}
                    </button>
                  )}
                {canReviewLogbookIssue(profile, entry, defs) && status === 'waiting_approval' && (
                  <>
                    <button type="button" onClick={() => void approveResolution(entry)}>
                      {t.logbook.approveResolution}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void requestCorrection(entry)}
                    >
                      {t.logbook.requestCorrection}
                    </button>
                  </>
                )}
                {status === 'resolved' &&
                  (canReviewLogbookIssue(profile, entry, defs) ||
                    canEditLogbookAssignment(profile, entry, defs)) && (
                    <button type="button" className="secondary" onClick={() => void reopenIssue(entry)}>
                      {t.logbook.reopen}
                    </button>
                  )}
                {canEditLogbookAssignment(profile, entry, defs) && status !== 'resolved' && status !== 'recalled' && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void changeAssignment(entry)}
                  >
                    {t.logbook.changeAssignment}
                  </button>
                )}
                {canAddCreatorUpdate(profile, entry, defs) && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setCreatorUpdateEntryId(entry.id);
                      setCreatorNote('');
                      setCreatorMedia(null);
                    }}
                  >
                    {t.logbook.addUpdate}
                  </button>
                )}
                {canRecallLogbookIssue(profile, entry, defs) && (
                  <button type="button" className="secondary" onClick={() => void recallIssue(entry)}>
                    {t.logbook.recall}
                  </button>
                )}
                {canHardDeleteLogbookIssue(profile, entry, defs) && (
                  <button type="button" className="secondary" onClick={() => void hardDeleteIssue(entry)}>
                    {t.logbook.hardDelete}
                  </button>
                )}
              </div>
            )}

            {entry.requiresAck && (
              <div style={{ marginTop: 8 }}>
                {meAcked ? (
                  <span className="badge good">{t.common.acknowledged}</span>
                ) : (
                  <button
                    className="secondary"
                    style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                    onClick={() => void acknowledge(entry)}
                  >
                    {t.common.acknowledge}
                  </button>
                )}
                <span className="small" style={{ marginLeft: 8 }}>
                  {ackIds.length} {ackIds.length !== 1 ? t.logbook.acks : t.logbook.ack}
                </span>
              </div>
            )}

            {type === 'issue' && entryEvents.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <LogbookTimeline entry={entry} events={entryEvents} />
              </div>
            )}
          </div>
        );
      })}

      {!activeProofEntry && !visibleEntries.length && (
        <div className="card">
          <p>{t.logbook.noEntries}</p>
        </div>
      )}
    </div>
  );
}
