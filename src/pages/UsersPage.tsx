import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import RolesPermissionsPanel from '../components/RolesPermissionsPanel';
import StorePicker from '../components/StorePicker';
import ProfileAvatar from '../components/profileAvatar/ProfileAvatar';
import { statusLabel } from '../lib/i18nUtils';
import {
  accessStatusBadgeClass,
  isAccessPending,
  managerCanReviewAccess,
  parseAccessReviewStoreIds,
} from '../lib/accessReview';
import { getRoleLinkStatus, profileRoleAssignTx } from '../lib/roleResolver';
import { getRoleDef } from '../lib/roles';
import {
  buildAccessAdminNotifications,
  buildAccessFinalizedNotification,
  buildAccessManagerRequestedNotifications,
  buildAccessRecheckNotifications,
} from '../lib/notifications';
import {
  canAccessUsersPage,
  canFinalApproveAccess,
  canManageUsers,
  canPreApproveAccess,
  canViewRolesPermissions,
} from '../lib/roles';
import { rolesAssignableBy, storesSelectableBy, canAssignRole, filterManagedProfiles } from '../lib/inviteScope';
import { OWNER_ROLE_KEY } from '../types';
import { badgeClass, nowIso } from '../lib/utils';
import type { InvitationAdminRow, Profile, Role, Store } from '../types';
import {
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from '../lib/inviteClient';

interface Props {
  currentProfile: Profile;
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="modal-overlay"
      style={{ alignItems: 'center', zIndex: 300 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 480,
          margin: 0,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function InviteUserForm({
  assignableRoles,
  stores,
  onCreated,
}: {
  currentProfile: Profile;
  assignableRoles: Role[];
  stores: Store[];
  onCreated?: () => void;
}) {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const defaultRole = assignableRoles.includes('staff')
    ? 'staff'
    : (assignableRoles[0] ?? 'staff');
  const [role, setRole] = useState<Role>(defaultRole);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailReason, setEmailReason] = useState('');

  const rolesForInvite = assignableRoles;

  useEffect(() => {
    if (!assignableRoles.includes(role) && assignableRoles.length) {
      setRole(assignableRoles.includes('staff') ? 'staff' : assignableRoles[0]);
    }
  }, [assignableRoles, role]);

  useEffect(() => {
    const allowed = new Set(stores.map((s) => s.id));
    setStoreIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [stores]);

  const copyLink = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignore */
    }
  }, []);

  async function send() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const data = await createInvitation({
        email: trimmed,
        role,
        storeIds,
        origin: window.location.origin,
      });
      setInviteLink(String(data.inviteUrl || ''));
      setEmailSent(!!data.emailSent);
      setEmailReason(data.emailSent ? '' : String(data.emailReason || ''));
      setSent(true);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.users.couldNotSendCode);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    const sentLink = inviteLink;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className={emailSent ? 'alert-success' : 'alert-info'}>
          <p className="small">
            {emailSent ? t.invite.emailSent : t.invite.emailNotSent}{' '}
            <strong>{email}</strong> ({role}).
          </p>
          {!emailSent && emailReason ? (
            <p className="small text-danger" style={{ margin: '8px 0 0' }}>
              {emailReason}
            </p>
          ) : null}
        </div>

        <div className="alert-info">
          <p className="small alert-info-title">{t.common.directSignInLink}</p>
          <p className="small" style={{ margin: '0 0 10px' }}>
            {t.users.inviteLinkHint}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              readOnly
              value={sentLink}
              onFocus={(e) => e.target.select()}
              className="input-readonly-muted"
              style={{
                flex: 1, fontSize: 12, fontFamily: 'monospace',
                padding: '10px 12px', borderRadius: 10, minWidth: 0,
              }}
            />
            <button
              className={copied ? 'success' : 'secondary'}
              style={{ fontSize: 13, padding: '10px 16px', minHeight: 0, whiteSpace: 'nowrap' }}
              onClick={() => copyLink(sentLink)}
            >
              {copied ? t.common.copied : t.common.copyLink}
            </button>
          </div>
        </div>

        <button
          className="secondary"
          style={{ alignSelf: 'flex-start', fontSize: 13, padding: '8px 14px', minHeight: 36 }}
          onClick={() => {
            setSent(false);
            setEmail('');
            setInviteLink('');
            setCopied(false);
            setStoreIds([]);
            setEmailReason('');
          }}
        >
          {t.common.inviteAnother}
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="small" style={{ marginBottom: 14 }}>
        {t.users.inviteHint}
      </p>

      <div className="grid two" style={{ marginBottom: 12 }}>
        <label>
          {t.users.emailAddress}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="employee@example.com"
            autoFocus
            className="input-accent"
          />
        </label>

        <label>
          {t.common.role}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            style={{ marginTop: 6 }}
          >
            {rolesForInvite.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: 'block', marginBottom: 12 }}>
        {t.invite.selectStoresOptional}
        <div style={{ marginTop: 6 }}>
          <StorePicker stores={stores} selectedStoreIds={storeIds} onChange={setStoreIds} />
        </div>
      </label>

      {error && <p className="small text-danger" style={{ marginBottom: 10 }}>{error}</p>}

      <button
        className="btn-gold"
        style={{ width: '100%' }}
        onClick={send}
        disabled={loading || !email.trim()}
      >
        {loading ? t.auth.sending : t.common.sendSignInCode}
      </button>
    </div>
  );
}

function StoresAssignControl({
  profile,
  allStores,
  canEdit,
}: {
  profile: Profile;
  /** Stores the actor may view/edit — out-of-scope assignments are preserved on save. */
  allStores: Store[];
  canEdit: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const assignedIds = (profile.stores ?? []).map((s) => s.id);
  const editableIds = new Set(allStores.map((s) => s.id));
  const visibleAssignedIds = assignedIds.filter((id) => editableIds.has(id));
  const assignedCodes = allStores
    .filter((s) => visibleAssignedIds.includes(s.id))
    .map((s) => s.code);
  const hiddenAssignedCount = assignedIds.filter((id) => !editableIds.has(id)).length;

  function openModal() {
    if (!canEdit) return;
    setSelectedStoreIds([...visibleAssignedIds]);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const prev = new Set(visibleAssignedIds);
      const next = new Set(selectedStoreIds.filter((id) => editableIds.has(id)));
      const txs = [
        ...[...next]
          .filter((id) => !prev.has(id))
          .map((id) => db.tx.profiles[profile.id].link({ stores: id })),
        ...[...prev]
          .filter((id) => !next.has(id))
          .map((id) => db.tx.profiles[profile.id].unlink({ stores: id })),
      ];
      if (txs.length) await db.transact(txs);
      setOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const label = assignedCodes.length
    ? assignedCodes.join(', ')
    : hiddenAssignedCount
      ? t.common.none
      : t.common.none;

  return (
    <>
      <button
        className="secondary"
        style={{
          fontSize: 12,
          padding: '6px 10px',
          minHeight: 32,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          opacity: canEdit ? 1 : 0.6,
        }}
        onClick={openModal}
        title={canEdit ? t.users.manageStoresTitle : t.users.noPermissionStores}
      >
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {canEdit && <span style={{ opacity: 0.5 }}>✎</span>}
      </button>

      {open && (
        <ModalShell
          title={t.users.assignStores}
          onClose={() => !saving && setOpen(false)}
        >
          <p className="small" style={{ marginTop: 0 }}>
            <strong>{profile.displayName || profile.email}</strong>
          </p>
          <p className="small">{profile.email}</p>

          <label style={{ marginTop: 12, display: 'block' }}>{t.users.assignStores}</label>
          <StorePicker
            stores={allStores}
            selectedStoreIds={selectedStoreIds}
            onChange={setSelectedStoreIds}
          />

          <div className="capture-actions" style={{ marginTop: 20 }}>
            <button className="secondary" onClick={() => setOpen(false)} disabled={saving}>
              {t.common.cancel}
            </button>
            <button onClick={save} disabled={saving}>
              {saving ? t.common.saving : t.common.save}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  );
}

function ApproveModal({
  pending,
  stores,
  currentProfile,
  defs,
  assignableRoles,
  onClose,
}: {
  pending: Profile;
  stores: Store[];
  currentProfile: Profile;
  defs: import('../types').RoleDefinition[];
  assignableRoles: Role[];
  onClose: () => void;
}) {
  const { t } = useLang();
  const initialRole = assignableRoles.includes(pending.role)
    ? pending.role
    : assignableRoles.includes('staff')
      ? 'staff'
      : (assignableRoles[0] ?? 'staff');
  const [role, setRole] = useState<Role>(initialRole);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>(() => {
    const allowed = new Set(stores.map((s) => s.id));
    const fromInvite = parseAccessReviewStoreIds(pending.invitedStoreIdsJson);
    const raw = fromInvite.length
      ? fromInvite
      : parseAccessReviewStoreIds(pending.accessReviewStoreIdsJson);
    return raw.filter((id) => allowed.has(id));
  });
  const [saving, setSaving] = useState(false);

  async function approve() {
    setSaving(true);
    try {
      const now = nowIso();
      const txs = [
        ...profileRoleAssignTx(pending.id, role, defs, pending.roleDefinition?.id),
        db.tx.profiles[pending.id].update({
          approvalStatus: 'approved',
          approvedAt: now,
          approvedByEmail: currentProfile.email,
          updatedAt: now,
        }),
        ...selectedStoreIds.map((sid) => db.tx.profiles[pending.id].link({ stores: sid })),
        ...buildAccessFinalizedNotification(pending, 'approved', currentProfile),
      ];
      await db.transact(txs);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.users.approveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={t.users.approveAccess} onClose={onClose}>
      <p>
        <strong>{pending.displayName || pending.email}</strong>
      </p>
      <p className="small">{pending.email}</p>

      <label style={{ marginTop: 12, display: 'block' }}>
        {t.common.role}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          style={{ marginTop: 4 }}
        >
          {assignableRoles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label style={{ marginTop: 12, display: 'block' }}>{t.users.assignStores}</label>
      <StorePicker stores={stores} selectedStoreIds={selectedStoreIds} onChange={setSelectedStoreIds} />

      <div className="capture-actions" style={{ marginTop: 20 }}>
        <button className="secondary" onClick={onClose} disabled={saving}>
          {t.common.cancel}
        </button>
        <button className="success" onClick={approve} disabled={saving}>
          {saving ? t.users.approving : t.common.approve}
        </button>
      </div>
    </ModalShell>
  );
}

function RequestManagerModal({
  target,
  stores,
  currentProfile,
  allProfiles,
  onClose,
}: {
  target: Profile;
  stores: Store[];
  currentProfile: Profile;
  allProfiles: Profile[];
  onClose: () => void;
}) {
  const { t } = useLang();
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>(() =>
    parseAccessReviewStoreIds(target.accessReviewStoreIdsJson),
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!selectedStoreIds.length) {
      alert(t.users.selectStoreRequired);
      return;
    }
    setSaving(true);
    try {
      const now = nowIso();
      await db.transact([
        db.tx.profiles[target.id].update({
          approvalStatus: 'manager_review',
          accessReviewStoreIdsJson: JSON.stringify(selectedStoreIds),
          accessReviewNote: note.trim(),
          accessReviewRequestedByEmail: currentProfile.email,
          accessReviewRequestedAt: now,
          updatedAt: now,
        }),
        ...buildAccessManagerRequestedNotifications(
          target,
          selectedStoreIds,
          note,
          currentProfile,
          allProfiles,
        ),
      ]);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={t.users.requestManagerTitle} onClose={onClose}>
      <p className="small">{t.users.requestManagerHint}</p>
      <p>
        <strong>{target.displayName || target.email}</strong>
      </p>
      <p className="small">{target.email}</p>

      <label style={{ marginTop: 12, display: 'block' }}>{t.users.designatedStores}</label>
      <StorePicker stores={stores} selectedStoreIds={selectedStoreIds} onChange={setSelectedStoreIds} />

      <label style={{ marginTop: 12, display: 'block' }}>
        {t.users.reviewNote}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ marginTop: 4, minHeight: 72 }}
        />
      </label>

      <div className="capture-actions" style={{ marginTop: 20 }}>
        <button className="secondary" onClick={onClose} disabled={saving}>
          {t.common.cancel}
        </button>
        <button onClick={submit} disabled={saving}>
          {saving ? t.common.saving : t.users.requestManager}
        </button>
      </div>
    </ModalShell>
  );
}

function NoteActionModal({
  title,
  hint,
  confirmLabel,
  noteRequired,
  onConfirm,
  onClose,
}: {
  title: string;
  hint: string;
  confirmLabel: string;
  noteRequired?: boolean;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (noteRequired && !note.trim()) {
      alert(t.users.flagNoteRequired);
      return;
    }
    setSaving(true);
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="small">{hint}</p>
      <label style={{ marginTop: 12, display: 'block' }}>
        {t.users.reviewNote}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ marginTop: 4, minHeight: 72 }}
        />
      </label>
      <div className="capture-actions" style={{ marginTop: 20 }}>
        <button className="secondary" onClick={onClose} disabled={saving}>
          {t.common.cancel}
        </button>
        <button onClick={submit} disabled={saving}>
          {saving ? t.common.saving : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function AccessRequestMeta({
  profile,
  stores,
}: {
  profile: Profile;
  stores: Store[];
}) {
  const { t } = useLang();
  const designatedIds = parseAccessReviewStoreIds(profile.accessReviewStoreIdsJson);
  const designatedCodes = stores
    .filter((s) => designatedIds.includes(s.id))
    .map((s) => s.code);

  return (
    <>
      {designatedCodes.length > 0 && (
        <p className="small">
          {t.users.designatedStores}: {designatedCodes.join(', ')}
        </p>
      )}
      {profile.preApprovedByEmail && (
        <p className="small">
          {t.users.preApprovedBy}: {profile.preApprovedByEmail}
        </p>
      )}
      {profile.accessReviewNote?.trim() && (
        <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
          {t.users.reviewNote}: {profile.accessReviewNote}
        </p>
      )}
    </>
  );
}

function AccessRequestCard({
  profile,
  stores,
  canFinalApprove,
  onApprove,
  onRequestManager,
  onCheckAgain,
  onReject,
  onPreApprove,
  onFlag,
}: {
  profile: Profile;
  stores: Store[];
  /** Owner / admin / areaManager — Instant allows full approve. */
  canFinalApprove: boolean;
  onApprove?: () => void;
  onRequestManager?: () => void;
  onCheckAgain?: () => void;
  onReject?: () => void;
  onPreApprove?: () => void;
  onFlag?: () => void;
}) {
  const { t } = useLang();
  const statusClass = accessStatusBadgeClass(profile.approvalStatus);
  const inManagerHandoff =
    profile.approvalStatus === 'manager_review' ||
    profile.approvalStatus === 'needs_manager_recheck';

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ProfileAvatar profile={profile} size={40} />
        <div style={{ flex: 1 }}>
          <strong>{profile.displayName || profile.email}</strong>
          <div className="small">{profile.email}</div>
          <div className="small">{t.users.requested} {profile.createdAt?.slice(0, 10)}</div>
          <AccessRequestMeta profile={profile} stores={stores} />
        </div>
        <span className={`badge ${statusClass}`}>
          {statusLabel(t, profile.approvalStatus)}
        </span>
      </div>

      <div className="capture-actions" style={{ marginTop: 12 }}>
        {canFinalApprove && profile.approvalStatus === 'pending' && (
          <>
            <button className="danger" onClick={onReject}>
              {t.common.reject}
            </button>
            <button className="secondary" onClick={onRequestManager}>
              {t.users.requestManager}
            </button>
            <button className="success" onClick={onApprove}>
              {t.users.approveNow}
            </button>
          </>
        )}

        {canFinalApprove && inManagerHandoff && (
          <>
            <button className="danger" onClick={onReject}>
              {t.common.reject}
            </button>
            <button className="success" onClick={onApprove}>
              {t.users.approveNow}
            </button>
          </>
        )}

        {canFinalApprove && profile.approvalStatus === 'pre_approved' && (
          <>
            <button className="danger" onClick={onReject}>
              {t.common.reject}
            </button>
            <button className="secondary" onClick={onCheckAgain}>
              {t.users.checkAgain}
            </button>
            <button className="success" onClick={onApprove}>
              {t.users.finalApprove}
            </button>
          </>
        )}

        {!canFinalApprove && inManagerHandoff && onPreApprove && onFlag && (
          <>
            <button className="secondary" onClick={onFlag}>
              {t.users.flagRequest}
            </button>
            <button className="success" onClick={onPreApprove}>
              {t.users.preApprove}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function InvitationsAdminPanel({ refreshKey }: { refreshKey: number }) {
  const { t } = useLang();
  const [rows, setRows] = useState<InvitationAdminRow[]>([]);
  const [counts, setCounts] = useState({ sent: 0, pending: 0, opened: 0, accepted: 0, expired: 0, revoked: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listInvitations();
      setRows((data.invitations as InvitationAdminRow[]) || []);
      setCounts((data.counts as typeof counts) || counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errors.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.errors.loadFailed]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function onResend(id: string) {
    setBusyId(id);
    try {
      const data = await resendInvitation(id, window.location.origin);
      const url = String(data.inviteUrl || '');
      if (url) {
        try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
      }
      if (!data.emailSent) {
        alert(
          `${t.invite.emailNotSent}${data.emailReason ? `\n\n${String(data.emailReason)}` : ''}` +
            (url ? `\n\n${t.common.copyLink}: ${url}` : ''),
        );
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(id: string) {
    if (!window.confirm(t.invite.revokeInvite + '?')) return;
    setBusyId(id);
    try {
      await revokeInvitation(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="card"><p className="small">{t.common.loading}</p></div>;
  if (error) return <div className="card"><p className="small text-danger">{error}</p></div>;

  return (
    <div className="card">
      <p className="small" style={{ marginBottom: 14 }}>
        {t.invite.adminCounts
          .replace('{sent}', String(counts.sent))
          .replace('{pending}', String(counts.pending))
          .replace('{opened}', String(counts.opened))
          .replace('{accepted}', String(counts.accepted))}
      </p>
      {rows.length === 0 ? (
        <p className="small">{t.users.noOtherUsers}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row) => (
            <div key={row.id} className="panel-inset" style={{ padding: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ flex: 1 }}>{row.email}</strong>
                <span className={`badge ${badgeClass(row.status)}`}>{row.status}</span>
              </div>
              <p className="small" style={{ margin: '6px 0' }}>
                {row.role}
                {row.storeNames?.length ? ` · ${row.storeNames.join(', ')}` : ''}
                {row.invitedByEmail ? ` · ${row.invitedByEmail}` : ''}
              </p>
              <p className="small" style={{ margin: '0 0 8px', opacity: 0.7 }}>
                {row.createdAt?.slice(0, 16)}
                {row.firstOpenedAt ? ` · opened ${row.firstOpenedAt.slice(0, 16)}` : ''}
                {row.acceptedAt ? ` · accepted ${row.acceptedAt.slice(0, 16)}` : ''}
              </p>
              {(row.status === 'pending' || row.status === 'opened' || row.status === 'expired') && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="secondary"
                    style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                    disabled={busyId === row.id}
                    onClick={() => void onResend(row.id)}
                  >
                    {t.invite.resend}
                  </button>
                  {row.status !== 'expired' && (
                    <button
                      className="secondary"
                      style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                      disabled={busyId === row.id}
                      onClick={() => void onRevoke(row.id)}
                    >
                      {t.invite.revokeInvite}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UsersPage({ currentProfile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [tab, setTab] = useState<'pending' | 'all' | 'invites' | 'roles'>('pending');
  const [inviteRefreshKey, setInviteRefreshKey] = useState(0);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [requestManagerId, setRequestManagerId] = useState<string | null>(null);
  const [checkAgainId, setCheckAgainId] = useState<string | null>(null);
  const [flagId, setFlagId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    profile: Profile;
    role: Role;
  } | null>(null);
  const [roleChangeSaving, setRoleChangeSaving] = useState(false);

  const { data } = db.useQuery({
    profiles: { stores: {}, roleDefinition: {} },
    stores: {},
  });

  const profiles: Profile[] = (data?.profiles ?? []) as Profile[];
  const stores: Store[] = (data?.stores ?? []) as Store[];

  const isOwner = currentProfile.role === OWNER_ROLE_KEY;
  const canManage = canManageUsers(currentProfile.role, defs);
  const canFinalApprove = canFinalApproveAccess(currentProfile.role);
  const canPreApprove = canPreApproveAccess(currentProfile.role, defs);
  const showRolesTab = canViewRolesPermissions(currentProfile.role, defs);

  const assignableRoles = rolesAssignableBy(currentProfile.role, defs);
  const actorStoreIds = (currentProfile.stores ?? []).map((s) => s.id);
  const scopedStores = storesSelectableBy(
    currentProfile.role,
    actorStoreIds,
    stores,
    defs,
  );

  if (!canAccessUsersPage(currentProfile.role, defs)) {
    return <div className="card">{t.users.noPermission}</div>;
  }

  const managedProfiles = filterManagedProfiles(
    currentProfile.role,
    actorStoreIds,
    profiles,
    defs,
    { excludeProfileId: currentProfile.id },
  );
  // Final approvers see full pending queue; managers only see handoffs to them.
  const accessQueueProfiles = canFinalApprove
    ? managedProfiles.filter((p) => isAccessPending(p.approvalStatus))
    : managedProfiles.filter((p) => managerCanReviewAccess(currentProfile, p));
  const allProfiles = managedProfiles;

  const managerQueueProfiles = accessQueueProfiles;

  async function updateRole(profile: Profile, role: Role) {
    if (!canAssignRole(currentProfile.role, role, defs)) {
      alert(t.users.ownerRoleOnly);
      return;
    }
    await db.transact(profileRoleAssignTx(profile.id, role, defs, profile.roleDefinition?.id));
  }

  async function confirmRoleChange() {
    if (!pendingRoleChange) return;
    setRoleChangeSaving(true);
    try {
      await updateRole(pendingRoleChange.profile, pendingRoleChange.role);
      setPendingRoleChange(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setRoleChangeSaving(false);
    }
  }

  async function fixRoleLink(profile: Profile) {
    setRoleChangeSaving(true);
    try {
      await db.transact(
        profileRoleAssignTx(profile.id, profile.role as Role, defs, profile.roleDefinition?.id),
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    } finally {
      setRoleChangeSaving(false);
    }
  }

  async function rejectAccess(profile: Profile) {
    const now = nowIso();
    await db.transact([
      db.tx.profiles[profile.id].update({
        approvalStatus: 'rejected',
        updatedAt: now,
      }),
      ...buildAccessFinalizedNotification(profile, 'rejected', currentProfile),
    ]);
  }

  async function deleteUserAccess(profile: Profile) {
    if (!isOwner) return;
    if (profile.id === currentProfile.id) {
      alert(t.users.deleteSelfBlocked);
      return;
    }
    if (profile.role === OWNER_ROLE_KEY) {
      alert(t.users.deleteOwnerBlocked);
      return;
    }
    const msg = t.users.deleteConfirm.replace('{name}', profile.name || profile.email);
    if (!confirm(msg)) return;
    try {
      await rejectAccess(profile);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.errors.saveFailed);
    }
  }

  async function preApproveAccess(profile: Profile) {
    const now = nowIso();
    await db.transact([
      db.tx.profiles[profile.id].update({
        approvalStatus: 'pre_approved',
        preApprovedByUserId: currentProfile.userId,
        preApprovedByEmail: currentProfile.email,
        preApprovedAt: now,
        accessReviewNote: '',
        updatedAt: now,
      }),
      ...buildAccessAdminNotifications(profile, 'access_pre_approved', '', currentProfile, profiles),
    ]);
  }

  async function flagAccess(profile: Profile, note: string) {
    const now = nowIso();
    await db.transact([
      db.tx.profiles[profile.id].update({
        approvalStatus: 'pending',
        accessReviewNote: note,
        updatedAt: now,
      }),
      ...buildAccessAdminNotifications(profile, 'access_flagged', note, currentProfile, profiles),
    ]);
  }

  async function checkAgainAccess(profile: Profile, note: string) {
    const now = nowIso();
    await db.transact([
      db.tx.profiles[profile.id].update({
        approvalStatus: 'needs_manager_recheck',
        accessReviewNote: note,
        accessReviewRequestedByEmail: currentProfile.email,
        accessReviewRequestedAt: now,
        updatedAt: now,
      }),
      ...buildAccessRecheckNotifications(profile, note, currentProfile, profiles),
    ]);
  }

  const approvingProfile = approvingId ? profiles.find((p) => p.id === approvingId) : null;
  const requestManagerProfile = requestManagerId
    ? profiles.find((p) => p.id === requestManagerId)
    : null;
  const checkAgainProfile = checkAgainId ? profiles.find((p) => p.id === checkAgainId) : null;
  const flagProfile = flagId ? profiles.find((p) => p.id === flagId) : null;

  if (canPreApprove && !canManage && !canFinalApprove) {
    return (
      <div>
        <div className="card">
          <h1 style={{ margin: 0 }}>{t.users.managerTitle}</h1>
          <p className="small" style={{ marginTop: 8 }}>{t.users.managerSubtitle}</p>
        </div>

        {managerQueueProfiles.length === 0 ? (
          <div className="card">
            <p className="small">{t.users.noManagerRequests}</p>
          </div>
        ) : (
          managerQueueProfiles.map((p) => (
            <AccessRequestCard
              key={p.id}
              profile={p}
              stores={scopedStores}
              canFinalApprove={false}
              onPreApprove={() => preApproveAccess(p)}
              onFlag={() => setFlagId(p.id)}
            />
          ))
        )}

        {flagProfile && (
          <NoteActionModal
            title={t.users.flagTitle}
            hint={t.users.flagHint}
            confirmLabel={t.users.flagRequest}
            noteRequired
            onClose={() => setFlagId(null)}
            onConfirm={(note) => flagAccess(flagProfile, note)}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      {pendingRoleChange && (
        <ModalShell
          title={t.common.role}
          onClose={() => !roleChangeSaving && setPendingRoleChange(null)}
        >
          <p className="small" style={{ marginTop: 0 }}>
            {t.users.confirmRoleChange
              .replace('{name}', pendingRoleChange.profile.displayName || pendingRoleChange.profile.email)
              .replace('{from}', pendingRoleChange.profile.role)
              .replace('{to}', pendingRoleChange.role)}
          </p>
          <div className="capture-actions" style={{ marginTop: 20 }}>
            <button
              className="secondary"
              onClick={() => setPendingRoleChange(null)}
              disabled={roleChangeSaving}
            >
              {t.common.cancel}
            </button>
            <button onClick={confirmRoleChange} disabled={roleChangeSaving}>
              {roleChangeSaving ? t.common.saving : t.common.update}
            </button>
          </div>
        </ModalShell>
      )}

      {approvingProfile && (
        <ApproveModal
          pending={approvingProfile}
          stores={scopedStores}
          currentProfile={currentProfile}
          defs={defs}
          assignableRoles={assignableRoles}
          onClose={() => setApprovingId(null)}
        />
      )}

      {requestManagerProfile && (
        <RequestManagerModal
          target={requestManagerProfile}
          stores={scopedStores}
          currentProfile={currentProfile}
          allProfiles={managedProfiles}
          onClose={() => setRequestManagerId(null)}
        />
      )}

      {checkAgainProfile && (
        <NoteActionModal
          title={t.users.checkAgainTitle}
          hint={t.users.checkAgainHint}
          confirmLabel={t.users.checkAgain}
          onClose={() => setCheckAgainId(null)}
          onConfirm={(note) => checkAgainAccess(checkAgainProfile, note)}
        />
      )}

      {flagProfile && (
        <NoteActionModal
          title={t.users.flagTitle}
          hint={t.users.flagHint}
          confirmLabel={t.users.flagRequest}
          noteRequired
          onClose={() => setFlagId(null)}
          onConfirm={(note) => flagAccess(flagProfile, note)}
        />
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h1 style={{ margin: 0, flex: 1 }}>{t.users.title}</h1>
          {accessQueueProfiles.length > 0 && (
            <span className="badge warn">
              {accessQueueProfiles.length} {t.users.accessQueue.toLowerCase()}
            </span>
          )}
          {canManage && (
            <button
              className={showInvite ? 'secondary' : 'btn-gold'}
              style={{ fontSize: 13, padding: '8px 16px', minHeight: 36 }}
              onClick={() => setShowInvite((v) => !v)}
            >
              {showInvite ? t.common.cancel : t.users.inviteUser}
            </button>
          )}
        </div>

        {canManage && showInvite && (
          <div className="panel-inset" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{t.users.sendSignInCodeTitle}</h3>
            <InviteUserForm
              currentProfile={currentProfile}
              assignableRoles={assignableRoles}
              stores={scopedStores}
              onCreated={() => setInviteRefreshKey((k) => k + 1)}
            />
          </div>
        )}

        <div className="tabs" style={{ marginBottom: 0 }}>
          <button
            className={tab === 'pending' ? 'active' : ''}
            onClick={() => setTab('pending')}
          >
            {t.users.accessQueue} ({accessQueueProfiles.length})
          </button>
          <button
            className={tab === 'all' ? 'active' : ''}
            onClick={() => setTab('all')}
          >
            {t.users.allUsers} ({allProfiles.length})
          </button>
          {canManage && (
            <button
              className={tab === 'invites' ? 'active' : ''}
              onClick={() => setTab('invites')}
            >
              {t.invite.adminTab}
            </button>
          )}
          {showRolesTab && (
            <button
              className={tab === 'roles' ? 'active' : ''}
              onClick={() => setTab('roles')}
            >
              {t.users.rolesPermissions.tab}
            </button>
          )}
        </div>
      </div>

      {tab === 'invites' && canManage && (
        <InvitationsAdminPanel refreshKey={inviteRefreshKey} />
      )}

      {tab === 'roles' && showRolesTab && (
        <RolesPermissionsPanel
          currentProfile={currentProfile}
          allProfiles={managedProfiles}
          readOnly={!isOwner}
        />
      )}

      {tab === 'pending' && (
        <>
          {accessQueueProfiles.length === 0 ? (
            <div className="card">
              <p className="small">{t.users.noPending}</p>
            </div>
          ) : (
            accessQueueProfiles.map((p) => (
              <AccessRequestCard
                key={p.id}
                profile={p}
                stores={scopedStores}
                canFinalApprove={canFinalApprove}
                onApprove={() => setApprovingId(p.id)}
                onRequestManager={() => setRequestManagerId(p.id)}
                onCheckAgain={() => setCheckAgainId(p.id)}
                onReject={() => rejectAccess(p)}
                onPreApprove={() => preApproveAccess(p)}
                onFlag={() => setFlagId(p.id)}
              />
            ))
          )}
        </>
      )}

      {tab === 'all' && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.users.user}</th>
                <th>{t.common.role}</th>
                <th>{t.common.status}</th>
                <th>{t.common.stores}</th>
                <th>{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {allProfiles.map((p) => {
                const canEditRole =
                  canFinalApprove && canAssignRole(currentProfile.role, p.role, defs);
                const linkStatus = getRoleLinkStatus(p, defs);
                const roleDef = getRoleDef(p.role, defs);
                const linkedKey = p.roleDefinition?.key;
                const roleOptions = canEditRole
                  ? assignableRoles.includes(p.role)
                    ? assignableRoles
                    : [p.role, ...assignableRoles.filter((r) => r !== p.role)]
                  : [p.role];
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ProfileAvatar profile={p} size={34} />
                        <div>
                          <strong style={{ fontSize: 14 }}>{p.displayName || '—'}</strong>
                          <div className="small">{p.email}</div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <select
                        value={p.role}
                        onChange={(e) => {
                          const nextRole = e.target.value as Role;
                          if (nextRole === p.role) return;
                          setPendingRoleChange({ profile: p, role: nextRole });
                        }}
                        disabled={!canEditRole || roleChangeSaving}
                        style={{ minWidth: 120, fontSize: 13 }}
                      >
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {linkStatus === 'ok' && roleDef && (
                          <span className="small" style={{ color: '#94A3B8' }}>
                            {t.users.roleLinkOk}: {roleDef.label}
                          </span>
                        )}
                        {linkStatus === 'missing_link' && (
                          <span className="badge warn" style={{ width: 'fit-content' }}>
                            {t.users.roleLinkMissing}
                          </span>
                        )}
                        {linkStatus === 'wrong_key' && (
                          <span className="badge warn" style={{ width: 'fit-content' }}>
                            {t.users.roleLinkMismatch
                              .replace('{linked}', linkedKey || p.roleDefinition?.id || '?')
                              .replace('{role}', p.role)}
                          </span>
                        )}
                        {linkStatus === 'unknown_role' && (
                          <span className="badge bad" style={{ width: 'fit-content' }}>
                            {t.users.roleLinkUnknown.replace('{role}', p.role)}
                          </span>
                        )}
                        {isOwner && linkStatus !== 'ok' && (
                          <button
                            type="button"
                            className="secondary"
                            style={{ fontSize: 11, padding: '4px 8px', minHeight: 26, width: 'fit-content' }}
                            onClick={() => fixRoleLink(p)}
                            disabled={roleChangeSaving}
                          >
                            {t.users.fixRoleLink}
                          </button>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className={badgeClass(p.approvalStatus)}>
                        {statusLabel(t, p.approvalStatus)}
                      </span>
                    </td>

                    <td>
                      <StoresAssignControl
                        profile={p}
                        allStores={scopedStores}
                        canEdit={canFinalApprove}
                      />
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {p.approvalStatus !== 'rejected' &&
                          isOwner &&
                          p.id !== currentProfile.id &&
                          p.role !== OWNER_ROLE_KEY && (
                          <button
                            className="danger"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => deleteUserAccess(p)}
                          >
                            {t.common.delete}
                          </button>
                        )}
                        {canFinalApprove && p.approvalStatus !== 'rejected' && !isOwner && (
                          <button
                            className="danger"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => rejectAccess(p)}
                          >
                            {t.users.revoke}
                          </button>
                        )}
                        {canFinalApprove && p.approvalStatus !== 'approved' && (
                          <button
                            className="success"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => setApprovingId(p.id)}
                          >
                            {t.common.approve}
                          </button>
                        )}
                        {canManage && (
                          <button
                            className="secondary"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={async () => {
                              try {
                                await db.auth.sendMagicCode({ email: p.email });
                                alert(`${t.users.codeSent} ${p.email}`);
                              } catch {
                                alert(t.users.codeSendFailed);
                              }
                            }}
                            title={t.users.sendSignInCodeTitle}
                          >
                            {t.users.sendCode}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!allProfiles.length && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>
                    {t.users.noOtherUsers}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
