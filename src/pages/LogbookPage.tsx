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
  canEditLogbookAssignment,
  canOpenLogbook,
  canReviewLogbookIssue,
  canViewLogbookEntry,
  defaultLogbookFilterTab,
  isIssueOverdue,
  isLogbookIssue,
  issueCreateFields,
  noteOrAnnouncementFields,
  resolveLogbookEntryType,
  resolveLogbookIssueStatus,
} from '../lib/logbook';
import { maybeNotifyLogbookDueStates } from '../lib/logbookDueNotify';
import {
  buildLogbookIssueAssignedNotifications,
  buildLogbookIssueReopenedNotifications,
  buildLogbookResolutionDecisionNotifications,
  buildLogbookResolutionSubmittedNotifications,
} from '../lib/notifications';
import {
  buildLogbookAssignmentChangedEvent,
  buildLogbookIssueCreatedEvents,
  buildLogbookIssueReopenedEvent,
  buildLogbookResolutionApprovedEvent,
  buildLogbookResolutionRejectedEvent,
  buildLogbookResolutionSubmittedEvent,
  buildLogbookWorkStartedEvent,
} from '../lib/reviewEvents';
import type {
  LogbookEntry,
  LogbookEntryType,
  Profile,
  ReviewEvent,
  Store,
  UploadedMedia,
} from '../types';

interface Props {
  profile: Profile;
  initialFilter?: string;
  highlightEntryId?: string | null;
}

type FilterTab = 'all' | 'my-assigned' | 'open' | 'waiting_approval' | 'overdue' | 'resolved';

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
      fromSession === 'resolved'
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
  });
  const [saving, setSaving] = useState(false);
  const [proofEntryId, setProofEntryId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const dueNotifyRan = useRef(false);

  const { data } = db.useQuery({
    logbookEntries: {
      store: {},
      photo: {},
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
          e.assigneeRole === profile.role &&
          (profile.stores ?? []).some((s) => s.id === e.storeId),
      ),
    [allEntries, profile],
  );

  const canCreate = canReview(profile.role, defs);
  const pageOpen = canOpenLogbook(profile, defs, assignedIssueExists);

  const visibleEntries = useMemo(() => {
    const now = Date.now();
    return allEntries
      .filter((e) => canViewLogbookEntry(profile, e, defs))
      .filter((e) => {
        if (storeId !== 'all' && e.storeId !== storeId && e.storeId !== '') return false;
        if (date && e.date !== date) return false;
        const type = resolveLogbookEntryType(e);
        if (entryTypeFilter !== 'all' && type !== entryTypeFilter) return false;
        if (severityFilter !== 'all' && e.severity !== severityFilter) return false;
        if (assigneeFilter !== 'all' && (e.assigneeRole || '') !== assigneeFilter) return false;
        if (requiresAckOnly && !e.requiresAck) return false;
        if (overdueOnly && !isIssueOverdue(e, now)) return false;
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
    filterTab,
  ]);

  useEffect(() => {
    clearSession(LOGBOOK_FILTER_KEY);
    clearSession(LOGBOOK_HIGHLIGHT_KEY);
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
  }, [highlightId, visibleEntries]);

  if (!pageOpen) {
    return <div className="card">{t.logbook.noPermission}</div>;
  }

  async function addEntry() {
    if (!form.content.trim()) return alert(t.logbook.contentRequired);
    if (form.entryType === 'issue') {
      if (!form.storeId) return alert(t.logbook.issueStoreRequired);
      if (!form.assigneeRole) return alert(t.logbook.assigneeRequired);
      if (!form.dueAt) return alert(t.logbook.dueRequired);
    }
    if (!canCreate) return alert(t.logbook.noCreatePermission);
    setSaving(true);
    try {
      const entryId = id();
      const storeTarget = form.entryType === 'issue' ? form.storeId : form.storeId || '';
      const typeFields =
        form.entryType === 'issue'
          ? issueCreateFields(form.assigneeRole, new Date(form.dueAt).toISOString())
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

  async function onProofCaptured(entry: LogbookEntry, media: UploadedMedia) {
    const priorFileId = entry.photo?.id ?? '';
    const note = resolutionNote.trim();
    const prevStatus = resolveLogbookIssueStatus(entry) || 'in_progress';
    const txs: unknown[] = [];
    if (priorFileId) {
      txs.push(db.tx.logbookEntries[entry.id].unlink({ photo: priorFileId }));
    }
    txs.push(
      db.tx.logbookEntries[entry.id].update({
        status: 'waiting_approval',
        resolutionNote: note,
        resolutionSubmittedAt: nowIso(),
        resolutionSubmittedByUserId: profile.userId,
        updatedAt: nowIso(),
      }),
      db.tx.logbookEntries[entry.id].link({ photo: media.fileId }),
      buildLogbookResolutionSubmittedEvent(entry, profile, prevStatus, note, priorFileId),
      ...buildLogbookResolutionSubmittedNotifications(
        {
          ...entry,
          resolutionNote: note,
          resolutionSubmittedByUserId: profile.userId,
        },
        profile,
        allProfiles,
        defs,
      ),
    );
    await db.transact(txs as Parameters<typeof db.transact>[0]);
    setProofEntryId(null);
    setResolutionNote('');
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

  async function rejectResolution(entry: LogbookEntry) {
    if (!canReviewLogbookIssue(profile, entry, defs)) return;
    const note = prompt(t.logbook.reviewNotePrompt) ?? '';
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
    const nextStatus = prevStatus === 'waiting_approval' ? 'in_progress' : prevStatus;
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

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: t.common.all },
    { id: 'my-assigned', label: t.logbook.myAssigned },
    { id: 'open', label: t.logbook.statusOpen },
    { id: 'waiting_approval', label: t.logbook.statusWaiting },
    { id: 'overdue', label: t.logbook.statusOverdue },
    { id: 'resolved', label: t.logbook.statusResolved },
  ];

  const proofEntry = proofEntryId
    ? visibleEntries.find((e) => e.id === proofEntryId) ||
      allEntries.find((e) => e.id === proofEntryId)
    : null;
  const proofStore = proofEntry
    ? stores.find((s) => s.id === proofEntry.storeId) || proofEntry.store
    : null;

  return (
    <div>
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={form.requiresAck}
              onChange={(e) => setForm({ ...form, requiresAck: e.target.checked })}
            />
            {t.logbook.requiresAck}
          </label>
          <button style={{ marginTop: 12 }} onClick={addEntry} disabled={saving}>
            {saving ? t.common.saving : t.logbook.saveEntry}
          </button>
        </div>
      )}

      {proofEntry && proofStore && (
        <div className="card">
          <h2>{t.logbook.submitResolution}</h2>
          <label style={{ display: 'block', marginBottom: 8 }}>
            {t.logbook.resolutionNote}
            <textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </label>
          <p className="small">{t.logbook.resolutionProofHint}</p>
          <TimemarkCamera
            store={proofStore}
            itemTitle={`Logbook Issue · ${proofEntry.content.slice(0, 40)}`}
            reportDate={proofEntry.date}
            proofContext={{
              type: 'logbook',
              logbookEntryId: proofEntry.id,
              storeId: proofEntry.storeId,
              content: proofEntry.content,
            }}
            profile={profile}
            proofType="photo"
            existingMedia={[]}
            onCapture={(media) => void onProofCaptured(proofEntry, media)}
          />
          <button className="secondary" style={{ marginTop: 8 }} onClick={() => setProofEntryId(null)}>
            {t.common.cancel}
          </button>
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
            </div>
            <p style={{ margin: '8px 0 0' }}>{entry.content}</p>
            <p className="small" style={{ margin: '4px 0 0' }}>
              {entry.date} · {entry.createdAt?.slice(11, 16)}
              {entry.dueAt ? ` · ${t.logbook.dueAt}: ${new Date(entry.dueAt).toLocaleString()}` : ''}
            </p>

            {entry.photo?.url && (
              <div style={{ marginTop: 8 }}>
                <div className="small">{t.logbook.resolutionProof}</div>
                <ProofPhoto media={{ id: entry.photo.id, url: entry.photo.url }} />
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
                    <button type="button" onClick={() => setProofEntryId(entry.id)}>
                      {t.logbook.submitResolution}
                    </button>
                  )}
                {canReviewLogbookIssue(profile, entry, defs) && status === 'waiting_approval' && (
                  <>
                    <button type="button" onClick={() => void approveResolution(entry)}>
                      {t.common.approve}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void rejectResolution(entry)}
                    >
                      {t.common.reject}
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
                {canEditLogbookAssignment(profile, entry, defs) && status !== 'resolved' && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void changeAssignment(entry)}
                  >
                    {t.logbook.changeAssignment}
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

      {!visibleEntries.length && (
        <div className="card">
          <p>{t.logbook.noEntries}</p>
        </div>
      )}
    </div>
  );
}
