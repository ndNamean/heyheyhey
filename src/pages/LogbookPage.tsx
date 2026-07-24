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
import {
  formatLogbookEntryStamp,
  resolveCaptureTimezone,
  ymdInTimeZone,
} from '../lib/proofTime';
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
  eligibleAssigneeUsers,
  eligibleLogbookAssigneeRoles,
  getIssueConfigurationState,
  isAssignedUnresolvedIssue,
  isIssueOverdue,
  isLogbookIssue,
  issueCreateFields,
  logSubmitStepFailure,
  noteOrAnnouncementFields,
  parseAssigneeUserIds,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
  resolveResolutionProofs,
  resolveSourceMedia,
  serializeAssigneeUserIds,
} from '../lib/logbook';
import {
  LOGBOOK_ACK_OPTIONS,
  LOGBOOK_LIFECYCLE_OPTIONS,
  canSeeMyTeamQuickView,
  clearIncompatibleFiltersOnEntryTypeChange,
  countActiveDetailedFilters,
  defaultLogbookQuickView,
  emptyLogbookFilterState,
  entryMatchesLogbookFilters,
  listActiveDetailedFilterChips,
  parseLogbookInitialFilter,
  removeDetailedFilterChip,
  toggleMultiValue,
  type LogbookAckFilter,
  type LogbookDateBasedOn,
  type LogbookFilterChip,
  type LogbookFilterState,
  type LogbookLifecycleFilter,
  type LogbookQuickView,
} from '../lib/logbookFilters';
import { profileVisibilityStoreIds, storesSelectableBy } from '../lib/inviteScope';
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
import {
  postLogbookNotify,
  postLogbookSubmitResolution,
} from '../lib/logbookNotifyClient';
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

/** One-shot device GPS for logbook create timezone; null on deny/timeout/unavailable. */
function getDeviceGpsOnce(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );
  });
}

function openResolutionSessionKey(): string {
  return 'logbookOpenResolutionEntryId';
}

function initLogbookFilters(
  profile: Profile,
  defs: Parameters<typeof defaultLogbookQuickView>[1],
  initialFilter?: string,
): LogbookFilterState {
  const base = emptyLogbookFilterState(defaultLogbookQuickView(profile, defs));
  const raw = initialFilter || readSession(LOGBOOK_FILTER_KEY) || '';
  const parsed = parseLogbookInitialFilter(raw);
  if (!parsed) return base;
  return { ...base, ...parsed };
}

export default function LogbookPage({
  profile,
  initialFilter,
  highlightEntryId: highlightProp,
}: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [filters, setFilters] = useState<LogbookFilterState>(() =>
    initLogbookFilters(profile, defs, initialFilter),
  );
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [isMobileFilters, setIsMobileFilters] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)').matches : false,
  );
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
    requiresAck: true,
    assigneeRole: 'staff' as string,
    assigneeUserIds: [] as string[],
    dueAt: '',
    resolutionProofType: 'photo' as ProofType,
    resolutionRequirement: '',
  });
  const [createSourceMedia, setCreateSourceMedia] = useState<UploadedMedia[]>([]);
  const [showCreateCamera, setShowCreateCamera] = useState(false);
  const [draftCreateEntryId, setDraftCreateEntryId] = useState(() => id());
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
    assigneeUserIds: [] as string[],
    dueAt: '',
    resolutionProofType: 'photo' as ProofType,
    resolutionRequirement: '',
  });
  const [changeAssignEntryId, setChangeAssignEntryId] = useState<string | null>(null);
  const [changeAssignForm, setChangeAssignForm] = useState({
    assigneeRole: 'staff',
    assigneeUserIds: [] as string[],
    dueAt: '',
    reason: '',
  });
  const [changeAssignSaving, setChangeAssignSaving] = useState(false);
  const [resolvedDetailOpenIds, setResolvedDetailOpenIds] = useState<Record<string, boolean>>({});
  const dueNotifyRan = useRef(false);

  const { data } = db.useQuery({
    logbookEntries: {
      store: {},
      photo: {},
      sourceMedia: {},
      resolutionMedia: {},
      resolutionProofHistory: {},
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
    () => allEntries.some((e) => isAssignedUnresolvedIssue(profile, e, defs)),
    [allEntries, profile, defs],
  );

  const createEligibleUsers = useMemo(
    () =>
      form.entryType === 'issue'
        ? eligibleAssigneeUsers(form.storeId, form.assigneeRole, allProfiles, defs)
        : [],
    [form.entryType, form.storeId, form.assigneeRole, allProfiles, defs],
  );

  const profileNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of allProfiles) {
      map.set(p.userId, p.displayName || p.email || p.userId);
    }
    return map;
  }, [allProfiles]);

  function assigneeSummaryLabel(entry: LogbookEntry): string {
    const role = entry.assigneeRole || '—';
    const ids = parseAssigneeUserIds(entry.assigneeUserIdsJson);
    if (ids.length === 0) return role;
    const names = ids.map((uid) => profileNameById.get(uid) || uid);
    return `${names.join(', ')} (${role})`;
  }

  function toggleAssigneeUserId(selected: string[], userId: string): string[] {
    return selected.includes(userId)
      ? selected.filter((id) => id !== userId)
      : [...selected, userId];
  }

  function pruneAssigneeUserIds(
    selected: string[],
    storeId: string,
    assigneeRole: string,
  ): string[] {
    if (!storeId || !assigneeRole || selected.length === 0) return [];
    const eligible = new Set(
      eligibleAssigneeUsers(storeId, assigneeRole, allProfiles, defs).map((p) => p.userId),
    );
    return selected.filter((id) => eligible.has(id));
  }

  const canCreate = canReview(profile.role, defs);
  const pageOpen = canOpenLogbook(profile, defs, assignedIssueExists);
  const eligibleAssigneeRoles = useMemo(
    () => eligibleLogbookAssigneeRoles(profile.role, defs),
    [profile.role, defs],
  );
  const selectableStores = useMemo(
    () =>
      storesSelectableBy(
        profile.role,
        profileVisibilityStoreIds(profile),
        stores,
        defs,
      ),
    [profile, stores, defs],
  );

  useEffect(() => {
    if (form.entryType !== 'issue') return;
    if (eligibleAssigneeRoles.length === 0) return;
    if (!eligibleAssigneeRoles.includes(form.assigneeRole as (typeof eligibleAssigneeRoles)[number])) {
      setForm((prev) => ({
        ...prev,
        assigneeRole: eligibleAssigneeRoles[0]!,
        assigneeUserIds: [],
      }));
    }
  }, [form.entryType, form.assigneeRole, eligibleAssigneeRoles]);

  useEffect(() => {
    if (form.entryType !== 'issue') return;
    setForm((prev) => {
      const nextIds = pruneAssigneeUserIds(prev.assigneeUserIds, prev.storeId, prev.assigneeRole);
      if (
        nextIds.length === prev.assigneeUserIds.length &&
        nextIds.every((id, i) => id === prev.assigneeUserIds[i])
      ) {
        return prev;
      }
      return { ...prev, assigneeUserIds: nextIds };
    });
  }, [form.entryType, form.storeId, form.assigneeRole, allProfiles, defs]);

  useEffect(() => {
    if (!form.storeId) return;
    if (selectableStores.some((s) => s.id === form.storeId)) return;
    setForm((prev) => ({
      ...prev,
      storeId: selectableStores[0]?.id || '',
      assigneeUserIds: pruneAssigneeUserIds(
        prev.assigneeUserIds,
        selectableStores[0]?.id || '',
        prev.assigneeRole,
      ),
    }));
    setShowCreateCamera(false);
  }, [form.storeId, selectableStores]);

  // Clear list filter store if it is outside actor scope (keep "all")
  useEffect(() => {
    if (filters.storeId === 'all') return;
    if (selectableStores.some((s) => s.id === filters.storeId)) return;
    setFilters((prev) => ({ ...prev, storeId: 'all' }));
  }, [filters.storeId, selectableStores]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const onChange = () => setIsMobileFilters(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** Active proof panel entry — resolved from all entries, ignoring filters. */
  const activeProofEntry = useMemo(() => {
    if (!proofEntryId) return null;
    return allEntries.find((e) => e.id === proofEntryId) || null;
  }, [allEntries, proofEntryId]);

  const storeById = useMemo(() => {
    const map = new Map<string, Pick<Store, 'code' | 'name'>>();
    for (const s of stores) map.set(s.id, s);
    return map;
  }, [stores]);

  const visibleEntries = useMemo(() => {
    const now = Date.now();
    return allEntries
      .filter((e) => canViewLogbookEntry(profile, e, defs))
      .filter((e) => {
        if (proofEntryId && e.id === proofEntryId) return false;
        return entryMatchesLogbookFilters(e, profile, defs, filters, { now, storeById });
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [allEntries, profile, defs, filters, proofEntryId, storeById]);

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
      if (!selectableStores.some((s) => s.id === form.storeId)) {
        return alert(t.logbook.storeNotAllowed);
      }
      if (eligibleAssigneeRoles.length === 0) return alert(t.logbook.noEligibleAssignees);
      if (!form.assigneeRole || !eligibleAssigneeRoles.includes(form.assigneeRole as (typeof eligibleAssigneeRoles)[number])) {
        return alert(t.logbook.assigneeRequired);
      }
      if (!form.dueAt) return alert(t.logbook.dueRequired);
      if (!form.resolutionProofType) return alert(t.logbook.proofTypeRequired);
    } else if (form.storeId && !selectableStores.some((s) => s.id === form.storeId)) {
      return alert(t.logbook.storeNotAllowed);
    }
    if (!canCreate) return alert(t.logbook.noCreatePermission);
    setSaving(true);
    try {
      const entryId = form.entryType === 'issue' ? draftCreateEntryId : id();
      const storeTarget = form.entryType === 'issue' ? form.storeId : form.storeId || '';
      const typeFields =
        form.entryType === 'issue'
          ? issueCreateFields(
              form.assigneeRole,
              new Date(form.dueAt).toISOString(),
              form.resolutionProofType,
              form.resolutionRequirement,
              form.assigneeUserIds,
            )
          : noteOrAnnouncementFields(form.entryType);

      const gps = await getDeviceGpsOnce();
      const selectedStore =
        storeTarget
          ? stores.find((s) => s.id === storeTarget) ||
            selectableStores.find((s) => s.id === storeTarget)
          : undefined;
      const storeCoords =
        selectedStore &&
        Number.isFinite(selectedStore.lat) &&
        Number.isFinite(selectedStore.lng)
          ? { lat: selectedStore.lat, lng: selectedStore.lng }
          : null;
      const createdTimezone = resolveCaptureTimezone(gps ?? storeCoords);
      const now = new Date();
      const createdAt = now.toISOString();

      const tx = db.tx.logbookEntries[entryId].update({
        storeId: storeTarget,
        authorUserId: profile.userId,
        date: ymdInTimeZone(now, createdTimezone),
        shift: form.shift,
        content: form.content.trim(),
        severity: form.severity,
        requiresAck: form.requiresAck,
        ackUserIdsJson: '[]',
        createdAt,
        updatedAt: createdAt,
        createdTimezone,
        ...typeFields,
      });

      const txs: unknown[] = [tx];
      if (storeTarget) {
        txs.push(db.tx.logbookEntries[entryId].link({ store: storeTarget }));
      }

      if (form.entryType === 'issue') {
        for (const media of createSourceMedia) {
          txs.push(db.tx.logbookEntries[entryId].link({ sourceMedia: media.fileId }));
        }
        const entryLike = {
          id: entryId,
          storeId: storeTarget,
          content: form.content.trim(),
          assigneeRole: form.assigneeRole,
          assigneeUserIdsJson: serializeAssigneeUserIds(form.assigneeUserIds),
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
        requiresAck: true,
        assigneeRole: eligibleAssigneeRoles[0] || 'staff',
        assigneeUserIds: [],
        dueAt: '',
        resolutionProofType: 'photo',
        resolutionRequirement: '',
      });
      setCreateSourceMedia([]);
      setShowCreateCamera(false);
      setDraftCreateEntryId(id());
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

    // Stage A — Admin SDK (client Instant link of resolutionMedia still denies for Staff)
    const stageA = await postLogbookSubmitResolution({
      entryId: live.id,
      attemptId,
      note,
      resolutionNumber: draft.numberValue.trim(),
      resolutionChecked: draft.checked,
      fileId: draft.media?.fileId,
    });
    if (!stageA.ok) {
      const raw = stageA.message;
      const friendly =
        /perms-pass|Permission denied/i.test(raw)
          ? t.logbook.submitPermissionDenied
          : raw || t.logbook.saveFailed;
      logSubmitStepFailure({
        entryId: live.id,
        actorRole: profile.role,
        attemptedStep: 'stage_a',
        message: raw,
      });
      setSubmitError(friendly);
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
    setFilters((prev) => ({ ...prev, quickView: 'assigned_to_my_role' }));
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

  function openChangeAssignment(entry: LogbookEntry) {
    if (!canEditLogbookAssignment(profile, entry, defs)) return;
    const current = (entry.assigneeRole || '').trim();
    const defaultRole = eligibleAssigneeRoles.includes(current as (typeof eligibleAssigneeRoles)[number])
      ? current
      : eligibleAssigneeRoles[0] || '';
    const selectedIds = pruneAssigneeUserIds(
      parseAssigneeUserIds(entry.assigneeUserIdsJson),
      entry.storeId,
      defaultRole,
    );
    setChangeAssignEntryId(entry.id);
    setChangeAssignForm({
      assigneeRole: defaultRole,
      assigneeUserIds: selectedIds,
      dueAt: entry.dueAt ? entry.dueAt.slice(0, 16) : '',
      reason: '',
    });
  }

  async function submitChangeAssignment(entry: LogbookEntry) {
    if (!canEditLogbookAssignment(profile, entry, defs)) return;
    const role = changeAssignForm.assigneeRole.trim();
    if (!role || !eligibleAssigneeRoles.includes(role as (typeof eligibleAssigneeRoles)[number])) {
      return alert(t.logbook.assigneeRequired);
    }
    if (!changeAssignForm.dueAt.trim()) return alert(t.logbook.dueRequired);
    if (!changeAssignForm.reason.trim()) return alert(t.logbook.changeReasonRequired);

    const dueAt = new Date(changeAssignForm.dueAt).toISOString();
    const assigneeUserIds = pruneAssigneeUserIds(
      changeAssignForm.assigneeUserIds,
      entry.storeId,
      role,
    );
    const assigneeUserIdsJson = serializeAssigneeUserIds(assigneeUserIds);
    const prevStatus = resolveLogbookIssueStatus(entry) || 'open';
    let nextStatus = prevStatus;
    if (prevStatus === 'waiting_approval') {
      const ok = confirm(t.logbook.invalidateWaitingConfirm);
      if (!ok) return;
      nextStatus = 'in_progress';
    }
    const peopleNote =
      assigneeUserIds.length === 0
        ? 'anyone with role'
        : assigneeUserIds.map((uid) => profileNameById.get(uid) || uid).join(', ');
    const note = `Role: ${entry.assigneeRole} → ${role}; people: ${peopleNote}; due: ${entry.dueAt} → ${dueAt}. ${changeAssignForm.reason.trim()}`;
    const updated = {
      ...entry,
      assigneeRole: role,
      assigneeUserIdsJson,
      dueAt,
      status: nextStatus,
    };

    setChangeAssignSaving(true);
    try {
      await db.transact([
        db.tx.logbookEntries[entry.id].update({
          assigneeRole: role,
          assigneeUserIdsJson,
          dueAt,
          status: nextStatus,
          updatedAt: nowIso(),
        }),
        buildLogbookAssignmentChangedEvent(entry, profile, note, nextStatus, prevStatus),
        ...buildLogbookIssueAssignedNotifications(updated as LogbookEntry, profile, allProfiles, defs),
      ]);
      setChangeAssignEntryId(null);
      setChangeAssignForm({
        assigneeRole: eligibleAssigneeRoles[0] || '',
        assigneeUserIds: [],
        dueAt: '',
        reason: '',
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : t.logbook.saveFailed);
    } finally {
      setChangeAssignSaving(false);
    }
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
    const current = (entry.assigneeRole || '').trim();
    const defaultRole = eligibleAssigneeRoles.includes(current as (typeof eligibleAssigneeRoles)[number])
      ? current
      : eligibleAssigneeRoles[0] || '';
    const selectedIds = pruneAssigneeUserIds(
      parseAssigneeUserIds(entry.assigneeUserIdsJson),
      entry.storeId,
      defaultRole,
    );
    setSetupEntryId(entry.id);
    setSetupForm({
      assigneeRole: defaultRole,
      assigneeUserIds: selectedIds,
      dueAt: entry.dueAt ? entry.dueAt.slice(0, 16) : '',
      resolutionProofType: (resolveLogbookProofType(entry) || 'photo') as ProofType,
      resolutionRequirement: entry.resolutionRequirement || '',
    });
  }

  async function saveSetup(entry: LogbookEntry) {
    if (!canEditLogbookAssignment(profile, entry, defs)) return;
    if (
      !setupForm.assigneeRole ||
      !eligibleAssigneeRoles.includes(setupForm.assigneeRole as (typeof eligibleAssigneeRoles)[number])
    ) {
      return alert(t.logbook.assigneeRequired);
    }
    if (!setupForm.dueAt) return alert(t.logbook.dueRequired);
    const dueAt = new Date(setupForm.dueAt).toISOString();
    const assigneeUserIds = pruneAssigneeUserIds(
      setupForm.assigneeUserIds,
      entry.storeId,
      setupForm.assigneeRole,
    );
    const assigneeUserIdsJson = serializeAssigneeUserIds(assigneeUserIds);
    const peopleNote =
      assigneeUserIds.length === 0
        ? 'anyone with role'
        : assigneeUserIds.map((uid) => profileNameById.get(uid) || uid).join(', ');
    const prevStatus = resolveLogbookIssueStatus(entry) || 'open';
    await db.transact([
      db.tx.logbookEntries[entry.id].update({
        assigneeRole: setupForm.assigneeRole,
        assigneeUserIdsJson,
        dueAt,
        resolutionProofType: setupForm.resolutionProofType || 'photo',
        resolutionRequirement: setupForm.resolutionRequirement.trim(),
        updatedAt: nowIso(),
      }),
      buildLogbookAssignmentChangedEvent(
        entry,
        profile,
        `Complete setup: role=${setupForm.assigneeRole}; people=${peopleNote}; due=${dueAt}`,
        prevStatus,
        prevStatus,
      ),
      ...buildLogbookIssueAssignedNotifications(
        {
          ...entry,
          assigneeRole: setupForm.assigneeRole,
          assigneeUserIdsJson,
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

  const detailedCount = countActiveDetailedFilters(filters);
  const detailedChips = listActiveDetailedFilterChips(filters);
  const showIssueMore =
    filters.entryType === 'all' || filters.entryType === 'issue';
  const showNoteMore =
    filters.entryType === 'all' ||
    filters.entryType === 'note' ||
    filters.entryType === 'announcement';
  const showTeamQuickView = canSeeMyTeamQuickView(profile, defs);

  const quickViews: { id: LogbookQuickView; label: string }[] = [
    { id: 'all_visible', label: t.logbook.quickAllVisible },
    { id: 'needs_my_action', label: t.logbook.quickNeedsMyAction },
    { id: 'assigned_to_my_role', label: t.logbook.quickAssignedToMyRole },
    { id: 'created_by_me', label: t.logbook.quickCreatedByMe },
    ...(showTeamQuickView
      ? [{ id: 'my_teams_issues' as const, label: t.logbook.quickMyTeamsIssues }]
      : []),
  ];

  function lifecycleLabel(value: LogbookLifecycleFilter): string {
    switch (value) {
      case 'active':
        return t.logbook.statusActive;
      case 'open':
        return t.logbook.statusOpen;
      case 'in_progress':
        return t.logbook.statusInProgress;
      case 'waiting_approval':
        return t.logbook.statusWaiting;
      case 'correction_requested':
        return t.logbook.correctionRequested;
      case 'resolved':
        return t.logbook.statusResolved;
      case 'recalled':
        return t.logbook.statusRecalled;
      case 'overdue':
        return t.logbook.statusOverdue;
      default:
        return value;
    }
  }

  function ackLabel(value: LogbookAckFilter): string {
    if (value === 'requires_ack') return t.logbook.ackRequires;
    if (value === 'missing_my_ack') return t.logbook.ackMissingMine;
    return t.logbook.ackByMe;
  }

  function chipLabel(chip: LogbookFilterChip): string {
    switch (chip.kind) {
      case 'store': {
        if (chip.value === 'all') return t.common.allStores;
        const store = selectableStores.find((s) => s.id === chip.value);
        return store ? `${store.code} — ${store.name}` : chip.value;
      }
      case 'entryType':
        if (chip.value === 'note') return t.logbook.typeNote;
        if (chip.value === 'announcement') return t.logbook.typeAnnouncement;
        if (chip.value === 'issue') return t.logbook.typeIssue;
        return t.common.all;
      case 'dateFrom':
        return `${t.logbook.dateFrom}: ${chip.value}`;
      case 'dateTo':
        return `${t.logbook.dateTo}: ${chip.value}`;
      case 'lifecycle':
        return lifecycleLabel(chip.value as LogbookLifecycleFilter);
      case 'severity':
        return chip.value;
      case 'assignee':
        return chip.value;
      case 'proof':
        return proofTypeLabel(chip.value);
      case 'ack':
        return ackLabel(chip.value as LogbookAckFilter);
      case 'dateBasedOn':
        if (chip.value === 'due') return t.logbook.dateBasedDue;
        if (chip.value === 'resolved') return t.logbook.dateBasedResolved;
        return t.logbook.dateBasedCreated;
      default:
        return chip.value;
    }
  }

  function clearAllFilters() {
    setFilters(emptyLogbookFilterState('all_visible'));
  }

  function toggleMoreFilters() {
    setMoreFiltersOpen((v) => !v);
  }

  function renderMoreFiltersBody() {
    return (
      <>
        <div className="grid two" style={{ marginBottom: 12 }}>
          <label>
            {t.common.store}
            <select
              value={filters.storeId}
              onChange={(e) => setFilters((prev) => ({ ...prev, storeId: e.target.value }))}
            >
              <option value="all">{t.common.allStores}</option>
              {selectableStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.logbook.entryType}
            <select
              value={filters.entryType}
              onChange={(e) => {
                const next = e.target.value as 'all' | LogbookEntryType;
                setFilters((prev) => clearIncompatibleFiltersOnEntryTypeChange(prev, next));
              }}
            >
              <option value="all">{t.common.all}</option>
              <option value="note">{t.logbook.typeNote}</option>
              <option value="announcement">{t.logbook.typeAnnouncement}</option>
              <option value="issue">{t.logbook.typeIssue}</option>
            </select>
          </label>
          <label>
            {t.logbook.dateFrom}
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
            />
          </label>
          <label>
            {t.logbook.dateTo}
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
            />
          </label>
        </div>

        {showIssueMore && (
          <>
            {filters.entryType === 'all' && <h3>{t.logbook.issuesHeading}</h3>}
            <div className="logbook-filter-check-grid" role="group" aria-label={t.logbook.lifecycle}>
              {LOGBOOK_LIFECYCLE_OPTIONS.map((lc) => (
                <label key={lc}>
                  <input
                    type="checkbox"
                    checked={filters.issueLifecycles.includes(lc)}
                    onChange={() =>
                      setFilters((prev) => ({
                        ...prev,
                        issueLifecycles: toggleMultiValue(prev.issueLifecycles, lc),
                      }))
                    }
                  />
                  {lifecycleLabel(lc)}
                </label>
              ))}
            </div>
            <label>
              {t.logbook.assigneeRole}
              <div className="logbook-filter-check-grid">
                {LOGBOOK_ASSIGNEE_ROLES.map((r) => (
                  <label key={r}>
                    <input
                      type="checkbox"
                      checked={filters.assigneeRoles.includes(r)}
                      onChange={() =>
                        setFilters((prev) => ({
                          ...prev,
                          assigneeRoles: toggleMultiValue(prev.assigneeRoles, r),
                        }))
                      }
                    />
                    {r}
                  </label>
                ))}
              </div>
            </label>
            <label>
              {t.logbook.proofTypeFilter}
              <div className="logbook-filter-check-grid">
                {PROOF_TYPES.map((p) => (
                  <label key={p}>
                    <input
                      type="checkbox"
                      checked={filters.proofTypes.includes(p)}
                      onChange={() =>
                        setFilters((prev) => ({
                          ...prev,
                          proofTypes: toggleMultiValue(prev.proofTypes, p),
                        }))
                      }
                    />
                    {proofTypeLabel(p)}
                  </label>
                ))}
              </div>
            </label>
            <label>
              {t.logbook.dateBasedOn}
              <select
                value={filters.dateBasedOn}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    dateBasedOn: e.target.value as LogbookDateBasedOn,
                  }))
                }
              >
                <option value="created">{t.logbook.dateBasedCreated}</option>
                <option value="due">{t.logbook.dateBasedDue}</option>
                <option value="resolved">{t.logbook.dateBasedResolved}</option>
              </select>
            </label>
          </>
        )}

        {(showIssueMore || showNoteMore) && (
          <label>
            {t.common.severity}
            <div className="logbook-filter-check-grid">
              {['info', 'warning', 'critical'].map((s) => (
                <label key={s}>
                  <input
                    type="checkbox"
                    checked={filters.severities.includes(s)}
                    onChange={() =>
                      setFilters((prev) => ({
                        ...prev,
                        severities: toggleMultiValue(prev.severities, s),
                      }))
                    }
                  />
                  {s}
                </label>
              ))}
            </div>
          </label>
        )}

        {showNoteMore && (
          <>
            {filters.entryType === 'all' && <h3>{t.logbook.notesHeading}</h3>}
            <div className="logbook-filter-check-grid" role="group" aria-label={t.logbook.ackStatus}>
              {LOGBOOK_ACK_OPTIONS.map((a) => (
                <label key={a}>
                  <input
                    type="checkbox"
                    checked={filters.ackStatuses.includes(a)}
                    onChange={() =>
                      setFilters((prev) => ({
                        ...prev,
                        ackStatuses: toggleMultiValue(prev.ackStatuses, a),
                      }))
                    }
                  />
                  {ackLabel(a)}
                </label>
              ))}
            </div>
          </>
        )}
      </>
    );
  }

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

        <label style={{ display: 'block', marginTop: 12 }}>
          {t.common.search}
          <input
            type="search"
            value={filters.search}
            placeholder={t.logbook.searchPlaceholder}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
        </label>

        <div className="logbook-quick-views" role="tablist" aria-label={t.logbook.quickViews}>
          {quickViews.map((qv) => (
            <button
              key={qv.id}
              type="button"
              role="tab"
              aria-selected={filters.quickView === qv.id}
              className={filters.quickView === qv.id ? 'active' : ''}
              onClick={() => setFilters((prev) => ({ ...prev, quickView: qv.id }))}
            >
              {qv.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button type="button" className="secondary" onClick={toggleMoreFilters}>
            {detailedCount > 0
              ? t.logbook.moreFiltersCount.replace('{n}', String(detailedCount))
              : t.logbook.moreFilters}
          </button>
          <button type="button" className="secondary" onClick={clearAllFilters}>
            {t.logbook.clearAllFilters}
          </button>
        </div>

        {detailedChips.length > 0 && !moreFiltersOpen && (
          <div className="logbook-filter-chips">
            {detailedChips.map((chip) => (
              <span key={chip.id} className="logbook-filter-chip">
                {chipLabel(chip)}
                <button
                  type="button"
                  aria-label={t.logbook.removeFilter}
                  onClick={() => setFilters((prev) => removeDetailedFilterChip(prev, chip))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {moreFiltersOpen && !isMobileFilters && (
          <div className="logbook-more-filters-panel">{renderMoreFiltersBody()}</div>
        )}
      </div>

      {moreFiltersOpen && isMobileFilters && (
        <div
          className="logbook-more-filters-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t.logbook.moreFilters}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreFiltersOpen(false);
          }}
        >
          <div className="logbook-more-filters-sheet">
            <div className="logbook-more-filters-sheet-header">
              <strong>
                {detailedCount > 0
                  ? t.logbook.moreFiltersCount.replace('{n}', String(detailedCount))
                  : t.logbook.moreFilters}
              </strong>
              <button type="button" className="secondary" onClick={clearAllFilters}>
                {t.logbook.clearAllFilters}
              </button>
            </div>
            {detailedChips.length > 0 && (
              <div className="logbook-filter-chips" style={{ padding: '8px 16px 0' }}>
                {detailedChips.map((chip) => (
                  <span key={chip.id} className="logbook-filter-chip">
                    {chipLabel(chip)}
                    <button
                      type="button"
                      aria-label={t.logbook.removeFilter}
                      onClick={() => setFilters((prev) => removeDetailedFilterChip(prev, chip))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="logbook-more-filters-sheet-body">{renderMoreFiltersBody()}</div>
            <div className="logbook-more-filters-sheet-footer">
              <button type="button" onClick={() => setMoreFiltersOpen(false)}>
                {t.logbook.showEntries.replace('{n}', String(visibleEntries.length))}
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && canCreate && (
        <div className="card">
          <h2>{t.logbook.newEntry}</h2>
          <label>
            {t.logbook.entryType}
            <select
              value={form.entryType}
              onChange={(e) => {
                const next = e.target.value as LogbookEntryType;
                if (next === 'issue' && eligibleAssigneeRoles.length === 0) {
                  alert(t.logbook.noEligibleAssignees);
                  return;
                }
                setForm({
                  ...form,
                  entryType: next,
                  assigneeRole:
                    next === 'issue'
                      ? eligibleAssigneeRoles[0] || form.assigneeRole
                      : form.assigneeRole,
                  assigneeUserIds: next === 'issue' ? [] : form.assigneeUserIds,
                });
                if (next !== 'issue') {
                  setCreateSourceMedia([]);
                  setShowCreateCamera(false);
                }
              }}
            >
              <option value="note">{t.logbook.typeNote}</option>
              <option value="announcement">{t.logbook.typeAnnouncement}</option>
              <option value="issue" disabled={eligibleAssigneeRoles.length === 0}>
                {t.logbook.typeIssue}
              </option>
            </select>
          </label>
          <div className="grid two" style={{ marginTop: 12 }}>
            <label>
              {form.entryType === 'issue' ? t.common.store : t.logbook.storeOptional}
              <select
                value={form.storeId}
                onChange={(e) => {
                  const storeId = e.target.value;
                  setForm({
                    ...form,
                    storeId,
                    assigneeUserIds: pruneAssigneeUserIds(
                      form.assigneeUserIds,
                      storeId,
                      form.assigneeRole,
                    ),
                  });
                  setShowCreateCamera(false);
                }}
              >
                {form.entryType !== 'issue' && (
                  <option value="">{t.common.allStores}</option>
                )}
                {form.entryType === 'issue' && selectableStores.length === 0 && (
                  <option value="">{t.logbook.noAssignableStores}</option>
                )}
                {selectableStores.map((s) => (
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
                    onChange={(e) =>
                      setForm({
                        ...form,
                        assigneeRole: e.target.value,
                        assigneeUserIds: [],
                      })
                    }
                  >
                    {eligibleAssigneeRoles.map((r) => (
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
          {form.entryType === 'issue' && (
            <div style={{ marginTop: 12 }}>
              <div className="small" style={{ marginBottom: 6 }}>
                {t.logbook.specificPeopleOptional}
              </div>
              <div
                className={`small logbook-assignee-anyone${form.assigneeUserIds.length === 0 ? ' is-active' : ''}`}
                style={{ marginBottom: 8, opacity: 0.85 }}
              >
                {form.assigneeUserIds.length === 0
                  ? t.logbook.anyoneWithRoleAtStore
                  : t.logbook.peopleSelected.replace(
                      '{n}',
                      String(form.assigneeUserIds.length),
                    )}
              </div>
              {!form.storeId ? (
                <div className="small">{t.logbook.issueStoreRequired}</div>
              ) : createEligibleUsers.length === 0 ? (
                <div className="small">{t.logbook.noEligiblePeople}</div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    maxHeight: 180,
                    overflowY: 'auto',
                    padding: '8px 10px',
                    border: '1px solid var(--border, #e5e7eb)',
                  }}
                >
                  {createEligibleUsers.map((p) => (
                    <label
                      key={p.userId}
                      className={`logbook-assignee-person${form.assigneeUserIds.includes(p.userId) ? ' is-selected' : ''}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        margin: 0,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={form.assigneeUserIds.includes(p.userId)}
                        onChange={() =>
                          setForm({
                            ...form,
                            assigneeUserIds: toggleAssigneeUserId(
                              form.assigneeUserIds,
                              p.userId,
                            ),
                          })
                        }
                      />
                      <span>
                        {p.displayName || p.email || p.userId}
                        {p.email && p.displayName ? (
                          <span className="small" style={{ marginLeft: 6, opacity: 0.7 }}>
                            {p.email}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
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
            <>
              <label style={{ marginTop: 12, display: 'block' }}>
                {t.logbook.resolutionRequirement}
                <textarea
                  value={form.resolutionRequirement}
                  onChange={(e) => setForm({ ...form, resolutionRequirement: e.target.value })}
                  placeholder={t.logbook.resolutionRequirementPlaceholder}
                  style={{ marginTop: 4 }}
                />
              </label>
              <div style={{ marginTop: 12 }}>
                <div className="small">{t.logbook.sourceMedia}</div>
                {createSourceMedia.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {createSourceMedia.map((media) => (
                      <div key={media.fileId} style={{ minWidth: 120 }}>
                        <ProofPhoto
                          media={{
                            id: media.fileId,
                            url: media.url,
                            fileName: media.fileName,
                            mimeType: media.mimeType,
                          }}
                        />
                        <button
                          type="button"
                          className="secondary"
                          style={{ marginTop: 6 }}
                          onClick={() =>
                            setCreateSourceMedia((prev) =>
                              prev.filter((m) => m.fileId !== media.fileId),
                            )
                          }
                        >
                          {t.logbook.removeProof}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!showCreateCamera ? (
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      if (!form.storeId) {
                        alert(t.logbook.selectStoreForMedia);
                        return;
                      }
                      if (!selectableStores.some((s) => s.id === form.storeId)) {
                        alert(t.logbook.storeNotAllowed);
                        return;
                      }
                      setShowCreateCamera(true);
                    }}
                  >
                    {t.logbook.addSourceMedia}
                  </button>
                ) : (
                  (() => {
                    const createStore = selectableStores.find((s) => s.id === form.storeId);
                    if (!createStore) {
                      return (
                        <p className="small" style={{ color: 'var(--danger, #f87171)', marginTop: 8 }}>
                          {t.logbook.selectStoreForMedia}
                        </p>
                      );
                    }
                    return (
                      <div style={{ marginTop: 8 }}>
                        <TimemarkCamera
                          store={createStore}
                          itemTitle={`Logbook Issue · ${(form.content || 'new').slice(0, 40)}`}
                          reportDate={todayYmd()}
                          proofContext={{
                            type: 'logbook',
                            logbookEntryId: draftCreateEntryId,
                            storeId: form.storeId,
                            content: form.content || 'New issue',
                            mediaPurpose: 'source_context',
                          }}
                          profile={profile}
                          proofType={form.resolutionProofType || 'photo'}
                          existingMedia={[]}
                          onCapture={(media: UploadedMedia) => {
                            setCreateSourceMedia((prev) => [...prev, media]);
                            setShowCreateCamera(false);
                          }}
                        />
                        <button
                          type="button"
                          className="secondary"
                          style={{ marginTop: 8 }}
                          onClick={() => setShowCreateCamera(false)}
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    );
                  })()
                )}
              </div>
            </>
          )}
          <label className="ui-checkbox-label" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              className="ui-checkbox"
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
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setDraft({ ...draft, media: null })}
                    >
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
        const resolutionProofs = resolveResolutionProofs(entry);
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
                  {t.logbook.assignedLabel}: {assigneeSummaryLabel(entry)}
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
                      onChange={(e) =>
                        setSetupForm({
                          ...setupForm,
                          assigneeRole: e.target.value,
                          assigneeUserIds: [],
                        })
                      }
                    >
                      {eligibleAssigneeRoles.map((r) => (
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
                {(() => {
                  const setupUsers = eligibleAssigneeUsers(
                    entry.storeId,
                    setupForm.assigneeRole,
                    allProfiles,
                    defs,
                  );
                  return (
                    <div style={{ marginTop: 10 }}>
                      <div className="small" style={{ marginBottom: 6 }}>
                        {t.logbook.specificPeopleOptional}
                      </div>
                      <div
                        className={`small logbook-assignee-anyone${setupForm.assigneeUserIds.length === 0 ? ' is-active' : ''}`}
                        style={{ marginBottom: 8, opacity: 0.85 }}
                      >
                        {setupForm.assigneeUserIds.length === 0
                          ? t.logbook.anyoneWithRoleAtStore
                          : t.logbook.peopleSelected.replace(
                              '{n}',
                              String(setupForm.assigneeUserIds.length),
                            )}
                      </div>
                      {setupUsers.length === 0 ? (
                        <div className="small">{t.logbook.noEligiblePeople}</div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            maxHeight: 180,
                            overflowY: 'auto',
                            padding: '8px 10px',
                            border: '1px solid var(--border, #e5e7eb)',
                          }}
                        >
                          {setupUsers.map((p) => (
                            <label
                              key={p.userId}
                              className={`logbook-assignee-person${setupForm.assigneeUserIds.includes(p.userId) ? ' is-selected' : ''}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                margin: 0,
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={setupForm.assigneeUserIds.includes(p.userId)}
                                onChange={() =>
                                  setSetupForm({
                                    ...setupForm,
                                    assigneeUserIds: toggleAssigneeUserId(
                                      setupForm.assigneeUserIds,
                                      p.userId,
                                    ),
                                  })
                                }
                              />
                              <span>{p.displayName || p.email || p.userId}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
              {formatLogbookEntryStamp(
                entry.createdAt,
                entry.createdTimezone?.trim() ||
                  resolveCaptureTimezone(
                    entryStore &&
                      Number.isFinite(entryStore.lat) &&
                      Number.isFinite(entryStore.lng)
                      ? { lat: entryStore.lat, lng: entryStore.lng }
                      : null,
                  ),
              )}
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

            {status === 'resolved' && (
              <div style={{ marginTop: 8 }}>
                {entry.resolvedAt && (
                  <p className="small" style={{ margin: '0 0 4px' }}>
                    {new Date(entry.resolvedAt).toLocaleString()}
                  </p>
                )}
                {(() => {
                  const approvedEv = [...entryEvents]
                    .reverse()
                    .find((ev) => ev.eventType === 'resolution_approved');
                  const reviewer =
                    allProfiles.find((p) => p.userId === entry.reviewedByUserId) || null;
                  const name =
                    (approvedEv?.actorDisplayNameSnapshot || '').trim() ||
                    reviewer?.displayName?.trim() ||
                    reviewer?.email?.split('@')[0] ||
                    '';
                  const role =
                    (approvedEv?.actorRole || '').trim() || reviewer?.role || '';
                  const byLine = [name, role ? `(${role})` : ''].filter(Boolean).join(' ');
                  return (
                    <p className="small" style={{ margin: 0 }}>
                      <strong>{t.timeline.resolutionApproved}</strong>
                      {byLine ? (
                        <>
                          {' '}
                          {t.timeline.by} {byLine}
                        </>
                      ) : null}
                    </p>
                  );
                })()}
                {entry.reviewNote?.trim() && (
                  <p className="small" style={{ margin: '4px 0 0' }}>
                    {entry.reviewNote.trim()}
                  </p>
                )}
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: 8, fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                  onClick={() =>
                    setResolvedDetailOpenIds((prev) => ({
                      ...prev,
                      [entry.id]: !prev[entry.id],
                    }))
                  }
                >
                  {resolvedDetailOpenIds[entry.id]
                    ? t.dashboard.hideDetails
                    : t.dashboard.showDetails}
                </button>
              </div>
            )}

            {(status !== 'resolved' || resolvedDetailOpenIds[entry.id]) && (
              <>
            {sourceMedia.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="small">{t.logbook.sourceMedia}</div>
                {sourceMedia.map((m) => (
                  <ProofPhoto key={m.id} media={{ id: m.id, url: m.url }} />
                ))}
              </div>
            )}
            {resolutionProofs.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="small">{t.logbook.resolutionProof}</div>
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    overflowX: 'auto',
                    paddingBottom: 4,
                    alignItems: 'flex-start',
                  }}
                >
                  {resolutionProofs.map((m, idx) => {
                    const isLatest = idx === resolutionProofs.length - 1;
                    const label =
                      resolutionProofs.length === 1
                        ? t.logbook.proofLatest
                        : isLatest
                          ? t.logbook.proofLatest
                          : t.logbook.proofAttempt.replace('{n}', String(idx + 1));
                    return (
                      <div key={m.id} style={{ flex: '0 0 auto', minWidth: 120 }}>
                        <div className="small" style={{ marginBottom: 4 }}>
                          {label}
                        </div>
                        <ProofPhoto media={{ id: m.id, url: m.url }} />
                      </div>
                    );
                  })}
                </div>
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

            {changeAssignEntryId === entry.id && (
              <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border, #e5e7eb)' }}>
                <div className="grid two">
                  <label>
                    {t.logbook.assigneeRole}
                    <select
                      value={changeAssignForm.assigneeRole}
                      onChange={(e) =>
                        setChangeAssignForm({
                          ...changeAssignForm,
                          assigneeRole: e.target.value,
                          assigneeUserIds: [],
                        })
                      }
                    >
                      {eligibleAssigneeRoles.map((r) => (
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
                      value={changeAssignForm.dueAt}
                      onChange={(e) =>
                        setChangeAssignForm({ ...changeAssignForm, dueAt: e.target.value })
                      }
                    />
                  </label>
                </div>
                {(() => {
                  const changeUsers = eligibleAssigneeUsers(
                    entry.storeId,
                    changeAssignForm.assigneeRole,
                    allProfiles,
                    defs,
                  );
                  return (
                    <div style={{ marginTop: 10 }}>
                      <div className="small" style={{ marginBottom: 6 }}>
                        {t.logbook.specificPeopleOptional}
                      </div>
                      <div
                        className={`small logbook-assignee-anyone${changeAssignForm.assigneeUserIds.length === 0 ? ' is-active' : ''}`}
                        style={{ marginBottom: 8, opacity: 0.85 }}
                      >
                        {changeAssignForm.assigneeUserIds.length === 0
                          ? t.logbook.anyoneWithRoleAtStore
                          : t.logbook.peopleSelected.replace(
                              '{n}',
                              String(changeAssignForm.assigneeUserIds.length),
                            )}
                      </div>
                      {changeUsers.length === 0 ? (
                        <div className="small">{t.logbook.noEligiblePeople}</div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            maxHeight: 180,
                            overflowY: 'auto',
                            padding: '8px 10px',
                            border: '1px solid var(--border, #e5e7eb)',
                          }}
                        >
                          {changeUsers.map((p) => (
                            <label
                              key={p.userId}
                              className={`logbook-assignee-person${changeAssignForm.assigneeUserIds.includes(p.userId) ? ' is-selected' : ''}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                margin: 0,
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={changeAssignForm.assigneeUserIds.includes(p.userId)}
                                onChange={() =>
                                  setChangeAssignForm({
                                    ...changeAssignForm,
                                    assigneeUserIds: toggleAssigneeUserId(
                                      changeAssignForm.assigneeUserIds,
                                      p.userId,
                                    ),
                                  })
                                }
                              />
                              <span>{p.displayName || p.email || p.userId}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <label style={{ display: 'block', marginTop: 8 }}>
                  {t.logbook.changeReasonLabel}
                  <textarea
                    value={changeAssignForm.reason}
                    onChange={(e) =>
                      setChangeAssignForm({ ...changeAssignForm, reason: e.target.value })
                    }
                    style={{ marginTop: 4 }}
                    required
                  />
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    disabled={changeAssignSaving}
                    onClick={() => void submitChangeAssignment(entry)}
                  >
                    {changeAssignSaving ? t.common.saving : t.logbook.saveAssignmentChange}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={changeAssignSaving}
                    onClick={() => {
                      setChangeAssignEntryId(null);
                      setChangeAssignForm({
                        assigneeRole: eligibleAssigneeRoles[0] || '',
                        assigneeUserIds: [],
                        dueAt: '',
                        reason: '',
                      });
                    }}
                  >
                    {t.common.cancel}
                  </button>
                </div>
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
                    onClick={() => openChangeAssignment(entry)}
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
              </>
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
