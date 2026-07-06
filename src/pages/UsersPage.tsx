import { useRef, useState, useCallback } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { statusLabel } from '../lib/i18nUtils';
import { ROLES } from '../lib/roles';
import { nowIso } from '../lib/utils';
import type { ApprovalStatus, Profile, Role, Store } from '../types';

interface Props {
  currentProfile: Profile;
}

function InviteUserForm({ currentProfile }: { currentProfile: Profile }) {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const isOwner = currentProfile.role === 'owner';

  const assignableRoles = ROLES.filter(
    (r) => isOwner || !['owner', 'areaManager'].includes(r),
  );

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
      await db.auth.sendMagicCode({ email: trimmed });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.users.couldNotSendCode);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    const sentLink =
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
          onClick={() => { setSent(false); setEmail(''); setCopied(false); }}
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
            {assignableRoles.map((r) => (
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

function StoresDropdown({
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
  const [saving, setSaving] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const assignedIds = new Set((profile.stores ?? []).map((s) => s.id));
  const assignedCodes = allStores
    .filter((s) => assignedIds.has(s.id))
    .map((s) => s.code);

  async function toggle(store: Store) {
    if (!canEdit) return;
    setSaving(store.id);
    try {
      if (assignedIds.has(store.id)) {
        await db.transact(db.tx.profiles[profile.id].unlink({ stores: store.id }));
      } else {
        await db.transact(db.tx.profiles[profile.id].link({ stores: store.id }));
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
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
        onClick={() => canEdit && setOpen((v) => !v)}
        title={canEdit ? t.users.manageStoresTitle : t.users.noPermissionStores}
      >
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {assignedCodes.length ? assignedCodes.join(', ') : t.common.none}
        </span>
        {canEdit && <span style={{ opacity: 0.5 }}>▾</span>}
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="dropdown-panel dropdown-panel--below"
            style={{ zIndex: 100 }}
          >
            {allStores.length === 0 && (
              <p className="small" style={{ padding: '4px 8px', margin: 0 }}>
                {t.stores.noStores}
              </p>
            )}
            {allStores.map((store) => (
              <label
                key={store.id}
                className={`dropdown-check-row${saving === store.id ? ' dropdown-check-row--saving' : ''}`}
              >
                <input
                  type="checkbox"
                  style={{ width: 16, height: 16 }}
                  checked={assignedIds.has(store.id)}
                  onChange={() => toggle(store)}
                  disabled={saving === store.id}
                />
                <span style={{ fontSize: 13 }}>
                  <strong>{store.code}</strong> — {store.name}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ApproveModal({
  pending,
  stores,
  currentProfile,
  onClose,
}: {
  pending: Profile;
  stores: Store[];
  currentProfile: Profile;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [role, setRole] = useState<Role>('staff');
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const assignableRoles = ROLES.filter(
    (r) => currentProfile.role === 'owner' || !['owner', 'areaManager'].includes(r),
  );

  async function approve() {
    setSaving(true);
    try {
      const tx = db.tx.profiles[pending.id].update({
        role,
        approvalStatus: 'approved',
        approvedAt: nowIso(),
        approvedByEmail: currentProfile.email,
        updatedAt: nowIso(),
      });
      const storeLinkTxs = selectedStoreIds.map((sid) =>
        db.tx.profiles[pending.id].link({ stores: sid }),
      );
      await db.transact([tx, ...storeLinkTxs]);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : t.users.approveFailed);
    } finally {
      setSaving(false);
    }
  }

  function toggleStore(storeId: string) {
    setSelectedStoreIds((prev) =>
      prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId],
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 300,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card" style={{ width: '100%', maxWidth: 480, margin: 0 }}>
        <h2 style={{ marginTop: 0 }}>{t.users.approveAccess}</h2>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {stores.map((s) => (
            <label
              key={s.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={selectedStoreIds.includes(s.id)}
                onChange={() => toggleStore(s.id)}
              />
              <span>
                {s.code} — {s.name}
              </span>
            </label>
          ))}
          {!stores.length && <p className="small">{t.stores.noStores}</p>}
        </div>

        <div className="capture-actions" style={{ marginTop: 20 }}>
          <button className="secondary" onClick={onClose} disabled={saving}>
            {t.common.cancel}
          </button>
          <button className="success" onClick={approve} disabled={saving}>
            {saving ? t.users.approving : t.common.approve}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage({ currentProfile }: Props) {
  const { t } = useLang();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const { data } = db.useQuery({
    profiles: { stores: {} },
    stores: {},
  });

  const profiles: Profile[] = (data?.profiles ?? []) as Profile[];
  const stores: Store[] = (data?.stores ?? []) as Store[];

  const pendingProfiles = profiles.filter((p) => p.approvalStatus === 'pending');
  const allProfiles = profiles.filter((p) => p.id !== currentProfile.id);

  const isOwner = currentProfile.role === 'owner';
  const isAdmin = currentProfile.role === 'owner' || currentProfile.role === 'areaManager';

  if (!isAdmin) {
    return <div className="card">{t.users.noPermission}</div>;
  }

  async function updateRole(profile: Profile, role: Role) {
    if (!isOwner && ['owner', 'areaManager'].includes(role)) {
      alert(t.users.ownerRoleOnly);
      return;
    }
    await db.transact(db.tx.profiles[profile.id].update({ role, updatedAt: nowIso() }));
  }

  async function updateStatus(profile: Profile, status: ApprovalStatus) {
    await db.transact(
      db.tx.profiles[profile.id].update({ approvalStatus: status, updatedAt: nowIso() }),
    );
  }

  const approvingProfile = approvingId ? profiles.find((p) => p.id === approvingId) : null;

  return (
    <div>
      {approvingProfile && (
        <ApproveModal
          pending={approvingProfile}
          stores={stores}
          currentProfile={currentProfile}
          onClose={() => setApprovingId(null)}
        />
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h1 style={{ margin: 0, flex: 1 }}>{t.users.title}</h1>
          {pendingProfiles.length > 0 && (
            <span className="badge warn">{pendingProfiles.length} {t.users.pending.toLowerCase()}</span>
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
            <InviteUserForm currentProfile={currentProfile} />
          </div>
        )}

        <div className="tabs" style={{ marginBottom: 0 }}>
          <button
            className={tab === 'pending' ? 'active' : ''}
            onClick={() => setTab('pending')}
          >
            {t.users.pending} ({pendingProfiles.length})
          </button>
          <button
            className={tab === 'all' ? 'active' : ''}
            onClick={() => setTab('all')}
          >
            {t.users.allUsers} ({allProfiles.length})
          </button>
        </div>
      </div>

      {tab === 'pending' && (
        <>
          {pendingProfiles.length === 0 ? (
            <div className="card">
              <p className="small">{t.users.noPending}</p>
            </div>
          ) : (
            pendingProfiles.map((p) => (
              <div className="card" key={p.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="avatar-circle">
                    {(p.displayName || p.email)[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <strong>{p.displayName || p.email}</strong>
                    <div className="small">{p.email}</div>
                    <div className="small">{t.users.requested} {p.createdAt?.slice(0, 10)}</div>
                  </div>
                  <span className="badge warn">{t.users.pending}</span>
                </div>
                <div className="capture-actions" style={{ marginTop: 12 }}>
                  <button
                    className="danger"
                    onClick={() =>
                      updateStatus(p, 'rejected')
                    }
                  >
                    {t.common.reject}
                  </button>
                  <button className="success" onClick={() => setApprovingId(p.id)}>
                    {t.common.approve}
                  </button>
                </div>
              </div>
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
                  isOwner || !['owner', 'areaManager'].includes(p.role);
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
                        onChange={(e) => updateRole(p, e.target.value as Role)}
                        disabled={!canEditRole}
                        style={{ minWidth: 120, fontSize: 13 }}
                      >
                        {ROLES.filter(
                          (r) => isOwner || !['owner', 'areaManager'].includes(r),
                        ).map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <select
                        value={p.approvalStatus}
                        onChange={(e) => updateStatus(p, e.target.value as ApprovalStatus)}
                        className={`approval-select approval-select--${p.approvalStatus}`}
                      >
                        <option value="pending">{statusLabel(t, 'pending')}</option>
                        <option value="approved">{statusLabel(t, 'approved')}</option>
                        <option value="rejected">{statusLabel(t, 'rejected')}</option>
                      </select>
                    </td>

                    <td>
                      <StoresDropdown
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
                            onClick={() => updateStatus(p, 'rejected')}
                          >
                            {t.users.revoke}
                          </button>
                        )}
                        {p.approvalStatus !== 'approved' && (
                          <button
                            className="success"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => updateStatus(p, 'approved')}
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
