import { useRef, useState, useCallback } from 'react';
import { db } from '../db';
import { ROLES } from '../lib/roles';
import { badgeClass, nowIso } from '../lib/utils';
import type { ApprovalStatus, Profile, Role, Store } from '../types';

interface Props {
  currentProfile: Profile;
}

// ─── Invite user form ─────────────────────────────────────────────────────────

function InviteUserForm({ currentProfile }: { currentProfile: Profile }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const isOwner = currentProfile.role === 'owner';

  // Roles the current admin is allowed to invite
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
      setError(e instanceof Error ? e.message : 'Could not send code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    // Link carries email + intended role so the app pre-sets the role on first sign-in
    const sentLink =
      `${window.location.origin}/?invite=${encodeURIComponent(email.trim())}` +
      `&role=${encodeURIComponent(role)}`;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Success */}
        <div style={{ background: '#d9f8e2', border: '1px solid #a3e9b8', borderRadius: 10, padding: '12px 16px' }}>
          <p className="small" style={{ color: '#0a5c22', margin: 0 }}>
            Sign-in code emailed to <strong>{email}</strong> as <strong>{role}</strong>.
          </p>
        </div>

        {/* Copy link */}
        <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 10, padding: '14px 16px' }}>
          <p className="small" style={{ margin: '0 0 4px', fontWeight: 700 }}>Direct sign-in link</p>
          <p className="small" style={{ margin: '0 0 10px', color: '#666' }}>
            The email InstantDB sent contains the 6-digit code. Share this link too —
            when they click it their email is pre-filled and the code is sent again automatically.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              readOnly
              value={sentLink}
              onFocus={(e) => e.target.select()}
              style={{
                flex: 1, fontSize: 12, fontFamily: 'monospace',
                padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd',
                background: '#fff', color: '#333', minWidth: 0,
              }}
            />
            <button
              className={copied ? 'success' : 'secondary'}
              style={{ fontSize: 13, padding: '10px 16px', minHeight: 0, whiteSpace: 'nowrap' }}
              onClick={() => copyLink(sentLink)}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>

        <button
          className="secondary"
          style={{ alignSelf: 'flex-start', fontSize: 13, padding: '8px 14px', minHeight: 36 }}
          onClick={() => { setSent(false); setEmail(''); setCopied(false); }}
        >
          ← Invite another
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="small" style={{ marginBottom: 14 }}>
        Enter their email and select a role. A sign-in code will be emailed to them and
        you'll get a direct link to share via WhatsApp, Telegram, or any channel.
      </p>

      <div className="grid two" style={{ marginBottom: 12 }}>
        <label>
          Email address
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="employee@example.com"
            autoFocus
            style={{
              marginTop: 6, fontSize: 15, padding: '13px 14px',
              border: '2px solid #FDC216', borderRadius: 12,
              color: '#111', background: '#fff',
            }}
          />
        </label>

        <label>
          Role
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

      {error && <p className="small" style={{ color: '#b00020', marginBottom: 10 }}>{error}</p>}

      <button
        className="btn-gold"
        style={{ width: '100%' }}
        onClick={send}
        disabled={loading || !email.trim()}
      >
        {loading ? 'Sending…' : 'Send sign-in code + get invite link →'}
      </button>
    </div>
  );
}

// ─── Stores dropdown ──────────────────────────────────────────────────────────

function StoresDropdown({
  profile,
  allStores,
  canEdit,
}: {
  profile: Profile;
  allStores: Store[];
  canEdit: boolean;
}) {
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
        title={canEdit ? 'Click to manage stores' : 'No permission'}
      >
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {assignedCodes.length ? assignedCodes.join(', ') : 'None'}
        </span>
        {canEdit && <span style={{ opacity: 0.5 }}>▾</span>}
      </button>

      {open && (
        <>
          {/* click-away overlay */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 100,
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 10,
              padding: 8,
              minWidth: 200,
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              marginTop: 4,
            }}
          >
            {allStores.length === 0 && (
              <p className="small" style={{ padding: '4px 8px', margin: 0 }}>
                No stores yet.
              </p>
            )}
            {allStores.map((store) => (
              <label
                key={store.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: saving === store.id ? '#f5f5f5' : undefined,
                }}
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

// ─── Approve modal ────────────────────────────────────────────────────────────

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
      alert(e instanceof Error ? e.message : 'Failed to approve');
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
        <h2 style={{ marginTop: 0 }}>Approve access</h2>
        <p>
          <strong>{pending.displayName || pending.email}</strong>
        </p>
        <p className="small">{pending.email}</p>

        <label style={{ marginTop: 12, display: 'block' }}>
          Role
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

        <label style={{ marginTop: 12, display: 'block' }}>Assign stores</label>
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
          {!stores.length && <p className="small">No stores yet.</p>}
        </div>

        <div className="capture-actions" style={{ marginTop: 20 }}>
          <button className="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="success" onClick={approve} disabled={saving}>
            {saving ? 'Approving...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main users page ──────────────────────────────────────────────────────────

export default function UsersPage({ currentProfile }: Props) {
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
    return <div className="card">Only owner or area manager can manage users.</div>;
  }

  async function updateRole(profile: Profile, role: Role) {
    if (!isOwner && ['owner', 'areaManager'].includes(role)) {
      alert('Only the owner can assign owner or area manager roles.');
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

      {/* ── Header ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h1 style={{ margin: 0, flex: 1 }}>Users &amp; Access</h1>
          {pendingProfiles.length > 0 && (
            <span className="badge warn">{pendingProfiles.length} pending</span>
          )}
          <button
            className={showInvite ? 'secondary' : 'btn-gold'}
            style={{ fontSize: 13, padding: '8px 16px', minHeight: 36 }}
            onClick={() => setShowInvite((v) => !v)}
          >
            {showInvite ? 'Cancel' : '+ Invite user'}
          </button>
        </div>

        {showInvite && (
          <div
            style={{
              background: '#fafafa',
              border: '1px solid #eee',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Send sign-in code</h3>
            <InviteUserForm currentProfile={currentProfile} />
          </div>
        )}

        <div className="tabs" style={{ marginBottom: 0 }}>
          <button
            className={tab === 'pending' ? 'active' : ''}
            onClick={() => setTab('pending')}
          >
            Pending ({pendingProfiles.length})
          </button>
          <button
            className={tab === 'all' ? 'active' : ''}
            onClick={() => setTab('all')}
          >
            All users ({allProfiles.length})
          </button>
        </div>
      </div>

      {/* ── Pending tab ── */}
      {tab === 'pending' && (
        <>
          {pendingProfiles.length === 0 ? (
            <div className="card">
              <p className="small">No pending access requests.</p>
            </div>
          ) : (
            pendingProfiles.map((p) => (
              <div className="card" key={p.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: '#f0f0f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    {(p.displayName || p.email)[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <strong>{p.displayName || p.email}</strong>
                    <div className="small">{p.email}</div>
                    <div className="small">Requested {p.createdAt?.slice(0, 10)}</div>
                  </div>
                  <span className="badge warn">Pending</span>
                </div>
                <div className="capture-actions" style={{ marginTop: 12 }}>
                  <button
                    className="danger"
                    onClick={() =>
                      updateStatus(p, 'rejected')
                    }
                  >
                    Reject
                  </button>
                  <button className="success" onClick={() => setApprovingId(p.id)}>
                    Approve
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* ── All users tab ── */}
      {tab === 'all' && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Stores</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allProfiles.map((p) => {
                const canEditRole =
                  isOwner || !['owner', 'areaManager'].includes(p.role);
                return (
                  <tr key={p.id}>
                    {/* User */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: '50%',
                            background: '#f0f0f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: 14,
                            flexShrink: 0,
                          }}
                        >
                          {(p.displayName || p.email)[0]?.toUpperCase()}
                        </div>
                        <div>
                          <strong style={{ fontSize: 14 }}>{p.displayName || '—'}</strong>
                          <div className="small">{p.email}</div>
                        </div>
                      </div>
                    </td>

                    {/* Role dropdown */}
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

                    {/* Status dropdown */}
                    <td>
                      <select
                        value={p.approvalStatus}
                        onChange={(e) => updateStatus(p, e.target.value as ApprovalStatus)}
                        style={{
                          minWidth: 110,
                          fontSize: 13,
                          background:
                            p.approvalStatus === 'approved'
                              ? '#d9f8e2'
                              : p.approvalStatus === 'rejected'
                                ? '#ffe1e1'
                                : '#fff0c2',
                          color:
                            p.approvalStatus === 'approved'
                              ? '#0a5c22'
                              : p.approvalStatus === 'rejected'
                                ? '#8b0000'
                                : '#7a5c00',
                          fontWeight: 600,
                          border: '1px solid',
                          borderColor:
                            p.approvalStatus === 'approved'
                              ? '#a3e9b8'
                              : p.approvalStatus === 'rejected'
                                ? '#f5b8b8'
                                : '#f5dfa0',
                        }}
                      >
                        <option value="pending">pending</option>
                        <option value="approved">approved</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </td>

                    {/* Stores dropdown */}
                    <td>
                      <StoresDropdown
                        profile={p}
                        allStores={stores}
                        canEdit={isAdmin}
                      />
                    </td>

                    {/* Actions */}
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {p.approvalStatus !== 'rejected' && (
                          <button
                            className="danger"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => updateStatus(p, 'rejected')}
                          >
                            Revoke
                          </button>
                        )}
                        {p.approvalStatus !== 'approved' && (
                          <button
                            className="success"
                            style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                            onClick={() => updateStatus(p, 'approved')}
                          >
                            Approve
                          </button>
                        )}
                        <button
                          className="secondary"
                          style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                          onClick={async () => {
                            try {
                              await db.auth.sendMagicCode({ email: p.email });
                              alert(`Sign-in code sent to ${p.email}`);
                            } catch {
                              alert('Failed to send code.');
                            }
                          }}
                          title="Send a new sign-in code to this user"
                        >
                          Send code
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!allProfiles.length && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>
                    No other users yet. Use "Invite user" above to get started.
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
