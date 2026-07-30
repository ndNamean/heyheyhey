/**
 * Post-login store Wi-Fi + Web Push status banner.
 * Never auto-requests Notification permission — only on explicit Enable CTA.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import InstallAppCard from './InstallAppCard';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useLang } from '../i18n';
import { db } from '../db';
import { getOrCreateWifiNotifyDeviceId } from '../lib/deviceId';
import {
  activateWifiNotify,
  fetchWifiNotifyStatus,
  getPushPermissionState,
  sendTestPush,
  type WifiNotifyStatusResponse,
} from '../lib/pushClient';
import type { NotificationActivationSession, Profile } from '../types';

type Props = {
  profile: Profile;
};

function formatExpiry(iso: string, lang: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(lang === 'vi' ? 'vi-VN' : undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function pickActiveSession(
  sessions: NotificationActivationSession[],
  deviceId: string,
  nowMs: number,
): NotificationActivationSession | null {
  const active = sessions.filter((s) => {
    if (s.deviceId !== deviceId) return false;
    if ((s.deactivatedAt ?? '').trim()) return false;
    const exp = Date.parse(s.expiresAt);
    return Number.isFinite(exp) && exp > nowMs;
  });
  active.sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
  return active[0] ?? null;
}

export default function WifiNotifyStatus({ profile }: Props) {
  const { t, lang } = useLang();
  const install = usePwaInstall();
  const deviceId = useMemo(() => getOrCreateWifiNotifyDeviceId(), []);

  const { data: sessionData } = db.useQuery({
    notificationActivationSessions: {
      $: { where: { userId: profile.userId } },
    },
  });

  const [status, setStatus] = useState<WifiNotifyStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showInstallGate, setShowInstallGate] = useState(false);
  const [localActive, setLocalActive] = useState<{
    storeCode: string;
    expiresAt: string;
  } | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await fetchWifiNotifyStatus();
      setStatus(next);
      setStatusError(null);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : t.wifiNotify.statusFailed);
    }
  }, [t.wifiNotify.statusFailed]);

  useEffect(() => {
    void refreshStatus();
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshStatus]);

  const queriedActive = useMemo(
    () =>
      pickActiveSession(
        (sessionData?.notificationActivationSessions ?? []) as NotificationActivationSession[],
        deviceId,
        Date.now(),
      ),
    [sessionData?.notificationActivationSessions, deviceId],
  );

  const activeStoreCode =
    localActive?.storeCode ||
    queriedActive?.storeCode ||
    (status?.sessionActive ? status.storeCode || '' : '') ||
    '';
  const activeExpiresAt =
    localActive?.expiresAt ||
    queriedActive?.expiresAt ||
    (status?.sessionActive ? status.expiresAt || '' : '') ||
    '';

  const hasActiveSession = Boolean(activeStoreCode && activeExpiresAt);

  async function runEnable() {
    setBusy(true);
    setActionMessage(null);
    try {
      // iOS: require Home Screen install before permission prompt
      if (install.isIos && !install.standalone && !install.installed) {
        setShowInstallGate(true);
        return;
      }
      if (getPushPermissionState() === 'unsupported') {
        setActionMessage(t.wifiNotify.unsupported);
        return;
      }
      if (getPushPermissionState() === 'denied') {
        setActionMessage(t.wifiNotify.permissionDenied);
        return;
      }

      const result = await activateWifiNotify(deviceId);
      if (!result.ok) {
        setActionMessage(result.error || result.reason || t.wifiNotify.activateFailed);
        await refreshStatus();
        return;
      }
      const storeCode = result.storeCode || status?.storeCode || '';
      const expiresAt = result.expiresAt || status?.expiresAt || '';
      if (storeCode && expiresAt) {
        setLocalActive({ storeCode, expiresAt });
      }
      setShowInstallGate(false);
      setActionMessage(null);
      await refreshStatus();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : t.wifiNotify.activateFailed);
    } finally {
      setBusy(false);
    }
  }

  async function onTestPush() {
    setBusy(true);
    setActionMessage(null);
    try {
      const result = await sendTestPush();
      setActionMessage(
        result.ok
          ? result.message || t.wifiNotify.testSent
          : result.message || t.wifiNotify.testFailed,
      );
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : t.wifiNotify.testFailed);
    } finally {
      setBusy(false);
    }
  }

  // Still loading first status and no Instant session yet — stay quiet
  if (!status && !statusError && !hasActiveSession) {
    return null;
  }

  if (hasActiveSession) {
    return (
      <div className="alert-success wifi-notify-banner" style={{ marginBottom: 12 }}>
        <p className="small" style={{ margin: 0 }}>
          {t.wifiNotify.active
            .replace('{storeCode}', activeStoreCode)
            .replace('{time}', formatExpiry(activeExpiresAt, lang))}
        </p>
        <p className="small" style={{ margin: '8px 0 0', opacity: 0.85 }}>
          {t.wifiNotify.limitation}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button className="secondary" disabled={busy} onClick={() => void onTestPush()}>
            {t.wifiNotify.sendTest}
          </button>
        </div>
        {actionMessage && (
          <p className="small" style={{ margin: '8px 0 0' }}>
            {actionMessage}
          </p>
        )}
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="alert-info wifi-notify-banner" style={{ marginBottom: 12 }}>
        <p className="small" style={{ margin: 0 }}>
          {t.wifiNotify.statusFailed}: {statusError}
        </p>
        <button
          className="secondary"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => void refreshStatus()}
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  if (!status?.recognized) {
    return (
      <div className="alert-info wifi-notify-banner" style={{ marginBottom: 12 }}>
        <p className="small" style={{ margin: 0 }}>
          {t.wifiNotify.unrecognized}
        </p>
        <p className="small" style={{ margin: '8px 0 0', opacity: 0.85 }}>
          {t.wifiNotify.limitation}
        </p>
      </div>
    );
  }

  const storeCode = status.storeCode || '—';

  return (
    <div className="alert-info wifi-notify-banner" style={{ marginBottom: 12 }}>
      <p className="small alert-info-title" style={{ margin: '0 0 6px' }}>
        {t.wifiNotify.recognizedTitle.replace('{storeCode}', storeCode)}
      </p>
      <p className="small" style={{ margin: 0 }}>
        {t.wifiNotify.enableHint}
      </p>
      <p className="small" style={{ margin: '8px 0 0', opacity: 0.85 }}>
        {t.wifiNotify.limitation}
      </p>

      {showInstallGate && install.isIos && !install.standalone ? (
        <div style={{ marginTop: 10 }}>
          <p className="small" style={{ margin: '0 0 8px' }}>
            {t.wifiNotify.iosInstallFirst}
          </p>
          <InstallAppCard
            compact
            onContinue={() => {
              // Stay gated until installed / standalone — do not request permission in browser
              setShowInstallGate(false);
            }}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button className="btn-gold" disabled={busy} onClick={() => void runEnable()}>
            {busy ? t.wifiNotify.enabling : t.wifiNotify.enable}
          </button>
        </div>
      )}

      {actionMessage && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {actionMessage}
        </p>
      )}
    </div>
  );
}
