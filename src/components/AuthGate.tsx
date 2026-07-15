import { useEffect, useRef, useState, useMemo } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { nowIso } from '../lib/utils';
import { useLang } from '../i18n';
import { BACK_PRIORITY, useNativeBack } from '../lib/nativeBack';
import LanguageSelector from './LanguageSelector';
import type { ApprovalStatus, Profile } from '../types';

interface Props {
  children: (profile: Profile) => React.ReactNode;
}

// ─── Ticket layout shell ─────────────────────────────────────────────────────

function TicketShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <main className="auth-page">
      {/* Language selector floats top-right */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50 }}>
        <LanguageSelector />
      </div>
      <div className="ticket">
        <div className="ticket-top">
          <div className="ticket-logo">HP</div>
          <h1>Hey Pelo Ops</h1>
          <p className="ticket-subtitle">{t.auth.subtitle}</p>
        </div>
        <div className="ticket-tear">
          <hr className="ticket-tear-line" />
        </div>
        <div className="ticket-body">{children}</div>
      </div>
    </main>
  );
}

// ─── Magic code sign-in ──────────────────────────────────────────────────────

function LoginScreen() {
  const { t } = useLang();
  // Parse invite params from URL once on mount
  const { inviteEmail, inviteRole, inviteCode } = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      inviteEmail: p.get('invite') ? decodeURIComponent(p.get('invite')!) : '',
      inviteRole:  p.get('role')   ? decodeURIComponent(p.get('role')!)   : 'staff',
      inviteCode:  p.get('code')   ? decodeURIComponent(p.get('code')!)   : '',
    };
  }, []);

  const [email, setEmail] = useState(inviteEmail);
  const [code, setCode]   = useState(inviteCode);
  const [sent, setSent]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const autoSentRef = useRef(false);

  // On first render with invite params: clean URL, then auto-verify OR auto-send
  useEffect(() => {
    if (!inviteEmail || autoSentRef.current) return;
    autoSentRef.current = true;

    // Persist intended role so the profile-creation effect can pick it up
    if (inviteRole) sessionStorage.setItem('inviteRole', inviteRole);

    // Clean up URL parameters without reloading the page
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('role');
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url.toString());

    setLoading(true);

    if (inviteCode) {
      // Link carries the code (set via InstantDB email template) — auto-verify directly
      db.auth
        .signInWithMagicCode({ email: inviteEmail, code: inviteCode })
        .catch((e: unknown) => {
          // Code expired or wrong — fall back to send a fresh code
          setError('');
          setCode('');
          return db.auth.sendMagicCode({ email: inviteEmail }).then(() => setSent(true));
        })
        .finally(() => setLoading(false));
    } else {
      // No code in link — just send the code so they land straight on the entry step
      db.auth
        .sendMagicCode({ email: inviteEmail })
        .then(() => setSent(true))
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'Could not send code.');
        })
        .finally(() => setLoading(false));
    }
  }, [inviteEmail, inviteCode]);

  async function sendCode() {
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

  async function verifyCode() {
    setLoading(true);
    setError('');
    try {
      await db.auth.signInWithMagicCode({ email: email.trim(), code: code.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wrong code. Check your email and try again.');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  useNativeBack(
    () => {
      setSent(false);
      setCode('');
      setError('');
      return true;
    },
    sent && !loading,
    BACK_PRIORITY.MODAL,
  );

  // Spinner while auto-processing invite link
  if (loading && inviteEmail && !sent) {
    return (
      <>
        <h2 className="ticket-section-title">
          {inviteCode ? t.auth.signingIn : t.auth.sendingCode}
        </h2>
        <p className="small">{t.auth.settingUp} <strong>{inviteEmail}</strong></p>
      </>
    );
  }

  if (!sent) {
    return (
      <>
        <h2 className="ticket-section-title">{t.auth.signIn}</h2>
        <p className="small" style={{ marginBottom: 20 }}>
          {t.auth.emailLabel}
        </p>
        <label>
          {t.auth.emailLabel}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendCode()}
            placeholder={t.auth.emailPlaceholder}
            autoFocus={!inviteEmail}
            style={{ marginTop: 6 }}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button
          className="btn-gold"
          style={{ marginTop: 18 }}
          onClick={sendCode}
          disabled={loading || !email.trim()}
        >
          {loading ? t.auth.sending : t.auth.sendCode}
        </button>
      </>
    );
  }

  return (
    <>
      <h2 className="ticket-section-title">{t.auth.checkEmail}</h2>
      <p className="small" style={{ marginBottom: 20 }}>
        {t.auth.codeSentTo} <strong>{email}</strong>
      </p>
      <label>
        {t.auth.codeLabel}
        <input
          className="code-input"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verifyCode()}
          placeholder="000000"
          maxLength={6}
          inputMode="numeric"
          autoFocus
          style={{ marginTop: 6 }}
        />
      </label>
      {error && <p className="auth-error">{error}</p>}
      <button
        className="btn-gold"
        style={{ marginTop: 18 }}
        onClick={verifyCode}
        disabled={loading || code.length !== 6}
      >
        {loading ? t.auth.verifying : t.auth.signInBtn}
      </button>
      <button
        className="secondary"
        style={{ width: '100%', marginTop: 10 }}
        onClick={() => { setSent(false); setCode(''); setError(''); }}
      >
        {t.auth.useDifferent}
      </button>
    </>
  );
}

// ─── Pending approval ────────────────────────────────────────────────────────

function pendingBodyForStatus(t: ReturnType<typeof useLang>['t'], status: ApprovalStatus): string {
  switch (status) {
    case 'manager_review':
      return t.auth.pendingManagerReviewBody;
    case 'pre_approved':
      return t.auth.pendingPreApprovedBody;
    case 'needs_manager_recheck':
      return t.auth.pendingNeedsRecheckBody;
    default:
      return t.auth.pendingBody;
  }
}

function PendingScreen({ email, status }: { email: string; status: ApprovalStatus }) {
  const { t } = useLang();
  return (
    <TicketShell>
      <h2 className="ticket-section-title">{t.auth.pendingTitle}</h2>
      <p style={{ marginBottom: 8 }}><strong>{email}</strong></p>
      <p className="small" style={{ marginBottom: 8 }}>{pendingBodyForStatus(t, status)}</p>
      <p className="small" style={{ marginBottom: 24 }}>{t.auth.pendingNote}</p>
      <div className="ticket-status-badge">
        <span className="ticket-status-dot" />
        {t.auth.waitingBadge}
      </div>
      <button className="secondary" style={{ width: '100%', marginTop: 20 }} onClick={() => db.auth.signOut()}>
        {t.auth.signOut}
      </button>
    </TicketShell>
  );
}

// ─── Access rejected ─────────────────────────────────────────────────────────

function RejectedScreen({ email }: { email: string }) {
  const { t } = useLang();
  return (
    <TicketShell>
      <h2 className="ticket-section-title">{t.auth.rejectedTitle}</h2>
      <p style={{ marginBottom: 8 }}>
        {t.auth.rejectedBody} <strong>{email}</strong>
      </p>
      <p className="small" style={{ marginBottom: 24 }}>{t.auth.rejectedContact}</p>
      <button className="secondary" style={{ width: '100%' }} onClick={() => db.auth.signOut()}>
        {t.auth.signOut}
      </button>
    </TicketShell>
  );
}

// ─── Main gate ───────────────────────────────────────────────────────────────

export default function AuthGate({ children }: Props) {
  const { t } = useLang();
  const { isLoading: authLoading, user, error: authError } = db.useAuth();
  const creatingRef = useRef(false);

  const { data: profileData, isLoading: profileLoading } = db.useQuery(
    user
      ? { profiles: { $: { where: { userId: user.id } }, stores: {} } }
      : null,
  );

  const { data: roleDefData } = db.useQuery(user ? { roleDefinitions: {} } : null);

  useEffect(() => {
    if (!user || !profileData || profileData.profiles.length > 0 || creatingRef.current) return;
    creatingRef.current = true;

    // Read intended role stored in sessionStorage by the invite flow
    const storedRole = sessionStorage.getItem('inviteRole') ?? 'staff';
    sessionStorage.removeItem('inviteRole');

    const profileId = id();
    const roleDefs = roleDefData?.roleDefinitions ?? [];
    const roleDef = roleDefs.find((d: { key: string }) => d.key === storedRole);

    const profileTx = db.tx.profiles[profileId]
      .update({
        userId: user.id,
        email: user.email ?? '',
        displayName: (user.email ?? '').split('@')[0],
        role: storedRole,
        approvalStatus: 'pending',
        approvedAt: '',
        approvedByEmail: '',
        accessReviewStoreIdsJson: '[]',
        accessReviewNote: '',
        preApprovedByUserId: '',
        preApprovedByEmail: '',
        preApprovedAt: '',
        accessReviewRequestedByEmail: '',
        accessReviewRequestedAt: '',
        invitedStoreIdsJson: '[]',
        cameraOptionsJson: '{"weatherEnabled":true,"logoEnabled":true}',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .link({ '$user': user.id });

    const txs = roleDef
      ? [profileTx.link({ roleDefinition: roleDef.id })]
      : [profileTx];

    db.transact(txs).catch(() => { creatingRef.current = false; });
  }, [user, profileData, roleDefData]);

  if (authLoading || (user && profileLoading)) {
    return <div className="loading-screen">{t.common.loading}</div>;
  }

  if (authError) {
    return (
      <TicketShell>
        <h2 className="ticket-section-title">{t.auth.errorTitle}</h2>
        <p className="small" style={{ marginBottom: 20 }}>{authError.message}</p>
        <button className="secondary" style={{ width: '100%' }} onClick={() => db.auth.signOut()}>
          {t.auth.signOut}
        </button>
      </TicketShell>
    );
  }

  if (!user) {
    return (
      <TicketShell>
        <LoginScreen />
      </TicketShell>
    );
  }

  if (!profileData || profileData.profiles.length === 0) {
    return <div className="loading-screen">{t.auth.settingUpAccount}</div>;
  }

  const profile = profileData.profiles[0] as Profile;

  if (profile.approvalStatus !== 'approved' && profile.approvalStatus !== 'rejected') {
    return <PendingScreen email={profile.email} status={profile.approvalStatus} />;
  }
  if (profile.approvalStatus === 'rejected') return <RejectedScreen email={profile.email} />;

  return <>{children(profile)}</>;
}
