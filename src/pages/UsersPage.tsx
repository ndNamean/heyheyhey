import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { useLang } from '../i18n';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import RolesPermissionsPanel from '../components/RolesPermissionsPanel';
import StorePicker from '../components/StorePicker';
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
  canManageUsers,
  canPreApproveAccess,
  canViewRolesPermissions,
  getOrderedRoles,
} from '../lib/roles';
import { ELEVATED_ASSIGN_ROLE_KEYS, OWNER_ROLE_KEY } from '../types';
import { badgeClass, nowIso } from '../lib/utils';
import type { Profile, Role, Store } from '../types';

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
}: {
  currentProfile: Profile;
  assignableRoles: Role[];
}) {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState('');

  const rolesForInvite = assignableRoles;

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
      const user = await db.getAuth();
      const token = user?.refresh_token;
      if (!token) throw new Error(t.users.couldNotSendCode);

      const resp = await fetch('/api/invite-user', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: trimmed,
          role,
          origin: window.location.origin,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        error?: string;
        inviteLink?: string;
      };
      if (!resp.ok) {
        throw new Error(data.error || t.users.couldNotSendCode);
      }

      setInviteLink(
        data.inviteLink ||
          `${window.location.origin}/?invite=${encodeURIComponent(trimmed)}` +
            `&role=${encodeURIComponent(role)}`,
      );
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.users.couldNotSendCode);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    const sentLink =
      inviteLink ||
      `${window.location.origin}/?invite=${encodeURIComponent(email.trim())}` +
        `&role=${encodeURIComponent(role)}`;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="alert-success">
          <p className="small">
            {t.users.inviteSent} <strong>{email}</strong> as <strong>{role}</strong>.
          </p>
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
  allStores: Store[];
  canEdit: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const assignedIds = (profile.stores ?? []).map((s) => s.id);
  const assignedCodes = allStores
    .filter((s) => assignedIds.includes(s.id))
    .map((s) => s.code);

  function openModal() {
    if (!canEdit) return;
    setSelectedStoreIds([...assignedIds]);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const prev = new Set(assignedIds);
      const next = new Set(selectedStoreIds);
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
          {assignedCodes.length ? assignedCodes.join(', ') : t.common.none}
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
  const [role, setRole] = useState<Role>('staff');
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>(() =>
    parseAccessReviewStoreIds(pending.accessReviewStoreIdsJson),
  );
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
  isAdmin,
  onApprove,
  onRequestManager,
  onCheckAgain,
  onReject,
  onPreApprove,
  onFlag,
}: {
  profile: Profile;
  stores: Store[];
  isAdmin: boolean;
  onApprove?: () => void;
  onRequestManager?: () => void;
  onCheckAgain?: () => void;
  onReject?: () => void;
  onPreApprove?: () => void;
  onFlag?: () => void;
}) {
  const { t } = useLang();
  const statusClass = accessStatusBadgeClass(profile.approvalStatus);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="avatar-circle">
          {(profile.displayName || profile.email)[0]?.toUpperCase()}
        </div>
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
        {isAdmin && profile.approvalStatus === 'pending' && (
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

        {isAdmin &&
          (profile.approvalStatus === 'manager_review' ||
            profile.approvalStatus === 'needs_manager_recheck') && (
            <>
              <button className="danger" onClick={onReject}>
                {t.common.reject}
              </button>
              <button className="success" onClick={onApprove}>
                {t.users.approveNow}
              </button>
            </>
          )}

        {isAdmin && profile.approvalStatus === 'pre_approved' && (
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

        {!isAdmin && onPreApprove && onFlag && (
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

export default function UsersPage({ currentProfile }: Props) {
  const { t } = useLang();
  const { defs } = useRoleDefinitions();
  const [tab, setTab] = useState<'pending' | 'all' | 'roles'>('pending');
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
  const isAdmin = canManageUsers(currentProfile.role, defs);
  const isManager = canPreApproveAccess(currentProfile.role, defs);
  const showRolesTab = canViewRolesPermissions(currentProfile.role, defs);

  const allRoleKeys = getOrderedRoles(defs);
  const assignableRoles = allRoleKeys.filter(
    (r) => isOwner || !ELEVATED_ASSIGN_ROLE_KEYS.includes(r as (typeof ELEVATED_ASSIGN_ROLE_KEYS)[number]),
  );

  if (!canAccessUsersPage(currentProfile.role, defs)) {
    return <div className="card">{t.users.noPermission}</div>;
  }

  const accessQueueProfiles = profiles.filter((p) => isAccessPending(p.approvalStatus));
  const allProfiles = profiles.filter((p) => p.id !== currentProfile.id);

  const managerQueueProfiles = isManager
    ? accessQueueProfiles.filter((p) => managerCanReviewAccess(currentProfile, p))
    : [];

  async function updateRole(profile: Profile, role: Role) {
    if (!isOwner && ELEVATED_ASSIGN_ROLE_KEYS.includes(role as (typeof ELEVATED_ASSIGN_ROLE_KEYS)[number])) {
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

  if (isManager && !isAdmin) {
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
              stores={stores}
              isAdmin={false}
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
          stores={stores}
          currentProfile={currentProfile}
          defs={defs}
          assignableRoles={assignableRoles}
          onClose={() => setApprovingId(null)}
        />
      )}

      {requestManagerProfile && (
        <RequestManagerModal
          target={requestManagerProfile}
          stores={stores}
          currentProfile={currentProfile}
          allProfiles={profiles}
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

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h1 style={{ margin: 0, flex: 1 }}>{t.users.title}</h1>
          {accessQueueProfiles.length > 0 && (
            <span className="badge warn">
              {accessQueueProfiles.length} {t.users.accessQueue.toLowerCase()}
            </span>
          )}
          <button
            className={showInvite ? 'secondary' : 'btn-gold'}
            style={{ fontSize: 13, padding: '8px 16px', minHeight: 36 }}
            onClick={() => setShowInvite((v) => !v)}
          >
            {showInvite ? t.common.cancel : t.users.inviteUser}
          </button>
        </div>

        {showInvite && (
          <div className="panel-inset" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>{t.users.sendSignInCodeTitle}</h3>
            <InviteUserForm currentProfile={currentProfile} assignableRoles={assignableRoles} />
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

      {tab === 'roles' && showRolesTab && (
        <RolesPermissionsPanel
          currentProfile={currentProfile}
          allProfiles={profiles}
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
                stores={stores}
                isAdmin
                onApprove={() => setApprovingId(p.id)}
                onRequestManager={() => setRequestManagerId(p.id)}
                onCheckAgain={() => setCheckAgainId(p.id)}
                onReject={() => rejectAccess(p)}
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
                  isOwner ||
                  !ELEVATED_ASSIGN_ROLE_KEYS.includes(
                    p.role as (typeof ELEVATED_ASSIGN_ROLE_KEYS)[number],
                  );
                const linkStatus = getRoleLinkStatus(p, defs);
                const roleDef = getRoleDef(p.role, defs);
                const linkedKey = p.roleDefinition?.key;
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="avatar-circle" style={{ width: 34, height: 34, fontSize: 14 }}>
                          {(p.displayName || p.email)[0]?.toUpperCase()}
                        </div>
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
                        {allRoleKeys.filter(
                          (r) =>
                            isOwner ||
                            !ELEVATED_ASSIGN_ROLE_KEYS.includes(
                              r as (typeof ELEVATED_ASSIGN_ROLE_KEYS)[number],
                            ),
                        ).map((r) => (
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
                        allStores={stores}
                        canEdit={isAdmin}
                      />
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {p.approvalStatus !== 'rejected' && (
                          <button
                            className="danger"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => rejectAccess(p)}
                          >
                            {t.users.revoke}
                          </button>
                        )}
                        {p.approvalStatus !== 'approved' && (
                          <button
                            className="success"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => setApprovingId(p.id)}
                          >
                            {t.common.approve}
                          </button>
                        )}
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
