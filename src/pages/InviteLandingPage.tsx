import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import LanguageSelector from './LanguageSelector';
import InstallAppCard from './InstallAppCard';
import {
  acceptInvitation,
  clearStashedInviteToken,
  stashInviteToken,
  validateInvitation,
} from '../lib/inviteClient';

type Phase =
  | 'validating'
  | 'ready'
  | 'auth'
  | 'accepting'
  | 'accepted'
  | 'already_accepted'
  | 'wrong_email'
  | 'expired'
  | 'revoked'
  | 'invalid'
  | 'offline';

type InvitePublic = {
  status: string;
  emailMasked: string;
  email: string;
  role: string;
  storeNames: string[];
  invitedByEmail: string;
  expiresAt: string;
};

function TicketShell({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <main className="auth-page">
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50 }}>
        <LanguageSelector />
      </div>
      <div className="ticket">
        <div className="ticket-top">
          <div className="ticket-logo">HP</div>
          <h1>Hey Pelo Ops</h1>
          <p className="ticket-subtitle">{t.invite.landingSubtitle}</p>
        </div>
        <div className="ticket-tear">
          <hr className="ticket-tear-line" />
        </div>
        <div className="ticket-body">{children}</div>
      </div>
    </main>
  );
}

function formatExpiry(iso: string, locale: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export default function InviteLandingPage() {
  const { t, lang } = useLang();
  const token = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return (p.get('token') || '').trim();
  }, []);

  const { user, isLoading: authLoading } = db.useAuth();
  const [phase, setPhase] = useState<Phase>('validating');
  const [invite, setInvite] = useState<InvitePublic | null>(null);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const validatedRef = useRef(false);
  const acceptStartedRef = useRef(false);

  const goHome = useCallback(() => {
    clearStashedInviteToken();
    window.location.assign('/');
  }, []);

  const runValidate = useCallback(async () => {
    if (!token) {
      setPhase('invalid');
      return;
    }
    setPhase('validating');
    setError('');
    try {
      stashInviteToken(token);
      const { ok, data } = await validateInvitation(token);
      if (!ok) {
        const status = String(data.status || '');
        if (status === 'expired') setPhase('expired');
        else if (status === 'revoked') setPhase('revoked');
        else setPhase('invalid');
        setError(String(data.error || t.invite.invalidLink));
        return;
      }
      const payload = data as unknown as InvitePublic & { ok?: boolean };
      setInvite(payload);
      if (payload.status === 'accepted') {
        setPhase('already_accepted');
      } else {
        setPhase('ready');
      }
    } catch {
      setPhase(navigator.onLine === false ? 'offline' : 'invalid');
      setError(t.invite.networkError);
    }
  }, [token, t.invite.invalidLink, t.invite.networkError]);

  useEffect(() => {
    if (validatedRef.current) return;
    validatedRef.current = true;
    void runValidate();
  }, [runValidate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const sendCode = useCallback(async () => {
    if (!invite?.email) return;
    setBusy(true);
    setError('');
    try {
      await db.auth.sendMagicCode({ email: invite.email });
      setCodeSent(true);
      setPhase('auth');
      setCooldown(30);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.invite.sendCodeFailed);
    } finally {
      setBusy(false);
    }
  }, [invite?.email, t.invite.sendCodeFailed]);

  const verifyCode = useCallback(async () => {
    if (!invite?.email || !code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await db.auth.signInWithMagicCode({ email: invite.email, code: code.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.invite.wrongCode);
      setBusy(false);
    }
  }, [invite?.email, code, t.invite.wrongCode]);

  const doAccept = useCallback(async () => {
    if (!token || acceptStartedRef.current) return;
    acceptStartedRef.current = true;
    setPhase('accepting');
    setBusy(true);
    setError('');
    try {
      const result = await acceptInvitation(token);
      setPhase(result.alreadyAccepted ? 'already_accepted' : 'accepted');
      if (invite) {
        setInvite({
          ...invite,
          role: String(result.role || invite.role),
          storeNames: Array.isArray(result.storeNames)
            ? (result.storeNames as string[])
            : invite.storeNames,
          status: 'accepted',
        });
      }
    } catch (e: unknown) {
      acceptStartedRef.current = false;
      const err = e as { data?: { status?: string; error?: string }; message?: string };
      const status = err.data?.status;
      if (status === 'email_mismatch') {
        setPhase('wrong_email');
      } else if (status === 'expired') {
        setPhase('expired');
      } else if (status === 'revoked') {
        setPhase('revoked');
      } else {
        setPhase('ready');
        setError(err.data?.error || err.message || t.invite.acceptFailed);
      }
    } finally {
      setBusy(false);
    }
  }, [token, invite, t.invite.acceptFailed]);

  // After auth resolves on a ready invite, accept automatically when emails match
  useEffect(() => {
    if (authLoading) return;
    if (!invite || !token) return;
    if (phase !== 'ready' && phase !== 'auth') return;
    if (!user?.email) return;

    const authEmail = user.email.trim().toLowerCase();
    const invited = invite.email.trim().toLowerCase();
    if (authEmail !== invited) {
      setPhase('wrong_email');
      return;
    }
    void doAccept();
  }, [authLoading, user, invite, token, phase, doAccept]);

  async function signOutAndContinue() {
    setBusy(true);
    try {
      await db.auth.signOut();
      setPhase('ready');
      acceptStartedRef.current = false;
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'validating' || (authLoading && phase === 'ready')) {
    return (
      <TicketShell>
        <p className="small" style={{ textAlign: 'center' }}>{t.invite.checking}</p>
      </TicketShell>
    );
  }

  if (phase === 'offline') {
    return (
      <TicketShell>
        <h2 className="ticket-section-title">{t.invite.offlineTitle}</h2>
        <p className="small">{error || t.invite.networkError}</p>
        <button className="btn-gold" style={{ width: '100%', marginTop: 16 }} onClick={() => { validatedRef.current = false; void runValidate(); }}>
          {t.common.retry}
        </button>
      </TicketShell>
    );
  }

  if (phase === 'invalid' || phase === 'expired' || phase === 'revoked') {
    const title =
      phase === 'expired' ? t.invite.expiredTitle
        : phase === 'revoked' ? t.invite.revokedTitle
          : t.invite.invalidTitle;
    const body =
      phase === 'expired' ? t.invite.expiredBody
        : phase === 'revoked' ? t.invite.revokedBody
          : t.invite.invalidBody;
    return (
      <TicketShell>
        <h2 className="ticket-section-title">{title}</h2>
        <p className="small">{error || body}</p>
        <button className="secondary" style={{ width: '100%', marginTop: 16 }} onClick={goHome}>
          {t.invite.backToApp}
        </button>
      </TicketShell>
    );
  }

  if (phase === 'wrong_email') {
    return (
      <TicketShell>
        <h2 className="ticket-section-title">{t.invite.wrongEmailTitle}</h2>
        <p className="small">
          {t.invite.wrongEmailBody} <strong>{invite?.emailMasked}</strong>
        </p>
        <p className="small" style={{ marginTop: 8 }}>
          {t.invite.signedInAs} <strong>{user?.email}</strong>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
          <button className="btn-gold" disabled={busy} onClick={() => void signOutAndContinue()}>
            {t.invite.signOutContinue}
          </button>
          <button className="secondary" onClick={goHome}>{t.invite.staySignedIn}</button>
        </div>
      </TicketShell>
    );
  }

  if (phase === 'accepted' || phase === 'already_accepted' || phase === 'accepting') {
    return (
      <TicketShell>
        <h2 className="ticket-section-title">
          {phase === 'accepting' ? t.invite.accepting : t.invite.accountReady}
        </h2>
        {invite && phase !== 'accepting' && (
          <>
            <p className="small">{t.invite.roleLabel}: <strong>{invite.role}</strong></p>
            {invite.storeNames?.length > 0 && (
              <p className="small">{t.invite.storesLabel}: {invite.storeNames.join(', ')}</p>
            )}
            <p className="small" style={{ marginTop: 8 }}>{t.invite.pendingApprovalNote}</p>
            <InstallAppCard onContinue={goHome} />
          </>
        )}
        {phase === 'accepting' && <p className="small">{t.invite.accepting}</p>}
      </TicketShell>
    );
  }

  // ready | auth
  return (
    <TicketShell>
      <h2 className="ticket-section-title">{t.invite.youveBeenInvited}</h2>
      {invite && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          <div>{t.invite.forEmail}: <strong>{invite.emailMasked}</strong></div>
          <div>{t.invite.roleLabel}: <strong>{invite.role}</strong></div>
          {invite.storeNames?.length > 0 && (
            <div>{t.invite.storesLabel}: {invite.storeNames.join(', ')}</div>
          )}
          {invite.invitedByEmail && (
            <div>{t.invite.invitedBy}: {invite.invitedByEmail}</div>
          )}
          {invite.expiresAt && (
            <div>{t.invite.expires}: {formatExpiry(invite.expiresAt, lang)}</div>
          )}
        </div>
      )}

      {error && <p className="small auth-error">{error}</p>}

      {phase === 'auth' || codeSent ? (
        <>
          <p className="small" style={{ marginBottom: 10 }}>
            {t.invite.codeSentTo} <strong>{invite?.emailMasked}</strong>
          </p>
          <label>
            {t.auth.codeLabel}
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void verifyCode()}
              placeholder="123456"
              autoFocus
            />
          </label>
          <button
            className="btn-gold"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy || code.trim().length < 4}
            onClick={() => void verifyCode()}
          >
            {busy ? t.auth.verifying : t.invite.verifyAndAccept}
          </button>
          <button
            className="secondary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={busy || cooldown > 0}
            onClick={() => void sendCode()}
          >
            {cooldown > 0 ? `${t.common.resendCode} (${cooldown})` : t.common.resendCode}
          </button>
        </>
      ) : (
        <>
          {user?.email?.toLowerCase() === invite?.email.toLowerCase() ? (
            <button
              className="btn-gold"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => void doAccept()}
            >
              {busy ? t.invite.accepting : t.invite.acceptInvitation}
            </button>
          ) : (
            <button
              className="btn-gold"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => void sendCode()}
            >
              {busy ? t.auth.sending : t.invite.sendSignInCode}
            </button>
          )}
        </>
      )}
    </TicketShell>
  );
}
