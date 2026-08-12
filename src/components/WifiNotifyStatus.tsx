/**
 * Post-login store presence + Web Push status banner.
 * Primary: Store Wi-Fi (public IP). Fallback: device location geofence.
 * Never auto-requests Notification permission — only on explicit Enable CTA.
 * When permission is already granted and presence is recognized with no session,
 * auto-runs the same activate path as Enable (subscribe + API activate).
 * iOS: require Home Screen / standalone before the notification permission prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InstallAppCard from './InstallAppCard';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useLang } from '../i18n';
import { db } from '../db';
import { useRoleDefinitions } from '../contexts/RoleDefinitionsContext';
import { getOrCreateWifiNotifyDeviceId } from '../lib/deviceId';
import {
  getCurrentDeviceLocation,
  getDeviceLocationPermissionState,
  hasRememberedLocationDenial,
  rememberLocationDenial,
  type DeviceLocationFailureReason,
} from '../lib/deviceLocation';
import {
  activateWifiNotify,
  fetchWifiNotifyStatus,
  getPushPermissionState,
  sendTestPush,
  type WifiNotifyLocationPayload,
  type WifiNotifyStatusResponse,
} from '../lib/pushClient';
import { canEditMaster } from '../lib/roles';
import {
  resolveNotificationActivationMethod,
  type NotificationActivationMethod,
  type NotificationActivationSession,
  type Profile,
} from '../types';

type Props = {
  profile: Profile;
};

type LocalActive = {
  storeCode: string;
  expiresAt: string;
  method?: NotificationActivationMethod | '';
};

type WifiNotifyCopy = {
  locationInaccurate: string;
  locationDenied: string;
  locationPermissionRequired: string;
  locationUnavailable: string;
  outsideGeofence: string;
  ambiguousStore: string;
  verifiedByWifi: string;
  verifiedByLocation: string;
  diagMethod: string;
  diagDistance: string;
  diagAccuracy: string;
  diagRadius: string;
  diagLastVerified: string;
  diagMethodWifi: string;
  diagMethodLocation: string;
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

function formatMeters(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function pickActiveSession(
  sessions: NotificationActivationSession[],
  deviceId: string,
  nowMs: number,
): NotificationActivationSession | null {
  const active = sessions.filter((s) => {
    if (s.deviceId !== deviceId) return false;
    if ((s.deactivatedAt ?? '').trim()) return false;
    const raw = String(s.expiresAt ?? '').trim();
    // Empty expiresAt = no time expiry
    if (!raw) return true;
    const exp = Date.parse(raw);
    return Number.isFinite(exp) && exp > nowMs;
  });
  active.sort((a, b) => {
    const ae = String(a.expiresAt ?? '').trim();
    const be = String(b.expiresAt ?? '').trim();
    if (!ae && !be) return 0;
    if (!ae) return -1;
    if (!be) return 1;
    return Date.parse(be) - Date.parse(ae);
  });
  return active[0] ?? null;
}

function parseSessionNumber(raw?: string | null): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toLocationPayload(
  lat: number,
  lng: number,
  accuracy: number,
): WifiNotifyLocationPayload {
  return { latitude: lat, longitude: lng, accuracy };
}

function geoFailureStatusReason(reason: DeviceLocationFailureReason): string {
  if (reason === 'location_denied') return 'location_denied';
  return 'location_unavailable';
}

function reasonMessage(
  reason: string | null | undefined,
  copy: WifiNotifyCopy,
): string | null {
  switch (String(reason || '').trim()) {
    case 'location_inaccurate':
      return copy.locationInaccurate;
    case 'location_denied':
      return copy.locationDenied;
    case 'location_permission_required':
      return copy.locationPermissionRequired;
    case 'location_unavailable':
    case 'location_timeout':
    case 'location_unsupported':
    case 'malformed_location':
      return copy.locationUnavailable;
    case 'outside_geofence':
      return copy.outsideGeofence;
    case 'ambiguous_store':
      return copy.ambiguousStore;
    default:
      return null;
  }
}

function verificationCopy(
  method: NotificationActivationMethod | '' | null | undefined,
  copy: WifiNotifyCopy,
): string | null {
  if (method === 'geofence') return copy.verifiedByLocation;
  if (method === 'wifi_ip') return copy.verifiedByWifi;
  return null;
}

type ObtainLocationResult =
  | { ok: true; location: WifiNotifyLocationPayload; prompted: boolean }
  | { ok: false; reason: string; prompted: boolean };

async function obtainDeviceLocation(opts: {
  allowPrompt: boolean;
  alreadyPrompted: boolean;
  maximumAgeMs?: number;
}): Promise<ObtainLocationResult> {
  const perm = await getDeviceLocationPermissionState();
  if (perm === 'granted') {
    const geo = await getCurrentDeviceLocation({
      maximumAgeMs: opts.maximumAgeMs ?? 0,
      timeoutMs: 15_000,
    });
    if (geo.ok) {
      return {
        ok: true,
        location: toLocationPayload(geo.lat, geo.lng, geo.accuracy),
        prompted: false,
      };
    }
    return {
      ok: false,
      reason: geoFailureStatusReason(geo.reason),
      prompted: false,
    };
  }
  if (perm === 'denied') {
    rememberLocationDenial();
    return { ok: false, reason: 'location_denied', prompted: false };
  }
  if (perm === 'unsupported') {
    return { ok: false, reason: 'location_unavailable', prompted: false };
  }
  if (hasRememberedLocationDenial() && !opts.allowPrompt) {
    return { ok: false, reason: 'location_denied', prompted: false };
  }
  if (!opts.allowPrompt && opts.alreadyPrompted) {
    return { ok: false, reason: 'location_permission_required', prompted: true };
  }
  const geo = await getCurrentDeviceLocation({
    maximumAgeMs: opts.maximumAgeMs ?? 0,
    timeoutMs: 15_000,
  });
  if (geo.ok) {
    return {
      ok: true,
      location: toLocationPayload(geo.lat, geo.lng, geo.accuracy),
      prompted: true,
    };
  }
  return {
    ok: false,
    reason: geoFailureStatusReason(geo.reason),
    prompted: true,
  };
}

function PresenceDiagnostics({
  method,
  distanceM,
  accuracyM,
  geofenceRadiusM,
  presenceVerifiedAt,
  lang,
  copy,
}: {
  method?: NotificationActivationMethod | '' | null;
  distanceM?: number | null;
  accuracyM?: number | null;
  geofenceRadiusM?: number | null;
  presenceVerifiedAt?: string | null;
  lang: string;
  copy: WifiNotifyCopy;
}) {
  const methodLabel =
    method === 'geofence'
      ? copy.diagMethodLocation
      : method === 'wifi_ip'
        ? copy.diagMethodWifi
        : method || null;
  const hasAny =
    Boolean(methodLabel) ||
    distanceM != null ||
    accuracyM != null ||
    geofenceRadiusM != null ||
    Boolean(presenceVerifiedAt);
  if (!hasAny) return null;
  return (
    <div className="small" style={{ margin: '8px 0 0', opacity: 0.85 }}>
      {methodLabel ? (
        <p style={{ margin: 0 }}>{copy.diagMethod.replace('{method}', methodLabel)}</p>
      ) : null}
      {distanceM != null ? (
        <p style={{ margin: '2px 0 0' }}>
          {copy.diagDistance.replace('{distance}', formatMeters(distanceM))}
        </p>
      ) : null}
      {accuracyM != null ? (
        <p style={{ margin: '2px 0 0' }}>
          {copy.diagAccuracy.replace('{accuracy}', formatMeters(accuracyM))}
        </p>
      ) : null}
      {geofenceRadiusM != null ? (
        <p style={{ margin: '2px 0 0' }}>
          {copy.diagRadius.replace('{radius}', formatMeters(geofenceRadiusM))}
        </p>
      ) : null}
      {presenceVerifiedAt ? (
        <p style={{ margin: '2px 0 0' }}>
          {copy.diagLastVerified.replace('{time}', formatExpiry(presenceVerifiedAt, lang))}
        </p>
      ) : null}
    </div>
  );
}

export default function WifiNotifyStatus({ profile }: Props) {
  const { t, lang } = useLang();
  const { defs } = useRoleDefinitions();
  const install = usePwaInstall();
  const deviceId = useMemo(() => getOrCreateWifiNotifyDeviceId(), []);
  const autoActivateRef = useRef<{ inFlight: boolean; attemptedStoreId: string | null }>({
    inFlight: false,
    attemptedStoreId: null,
  });
  const queriedActiveRef = useRef<NotificationActivationSession | null>(null);
  const lastLocationRef = useRef<WifiNotifyLocationPayload | null>(null);
  const lastStatusMethodRef = useRef<NotificationActivationMethod | '' | null>(null);
  const geoPromptedRef = useRef(false);
  const refreshGenRef = useRef(0);
  const geoSessionRefreshedRef = useRef(false);

  const showDiagnostics = canEditMaster(profile.role, defs);
  const copy = t.wifiNotify;

  const { data: sessionData } = db.useQuery({
    notificationActivationSessions: {
      $: { where: { userId: profile.userId } },
    },
  });

  const [status, setStatus] = useState<WifiNotifyStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [clientLocationReason, setClientLocationReason] = useState<string | null>(null);
  const [checkingLocation, setCheckingLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showInstallGate, setShowInstallGate] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [localActive, setLocalActive] = useState<LocalActive | null>(null);

  useEffect(() => {
    if (actionMessage || statusError || showInstallGate) {
      setDetailsOpen(true);
    }
  }, [actionMessage, statusError, showInstallGate]);

  const refreshStatus = useCallback(
    async (opts?: {
      withLocation?: boolean;
      allowPrompt?: boolean;
      silentLocation?: boolean;
    }) => {
      const gen = ++refreshGenRef.current;
      try {
        const session = queriedActiveRef.current;
        const sessionMethod = session
          ? resolveNotificationActivationMethod(session)
          : '';
        const knownGeo =
          sessionMethod === 'geofence' || lastStatusMethodRef.current === 'geofence';
        const sendLocationFirst = Boolean(opts?.withLocation || knownGeo);

        let location: WifiNotifyLocationPayload | null = null;
        if (sendLocationFirst) {
          if (!opts?.silentLocation && !knownGeo) setCheckingLocation(true);
          const obtained = await obtainDeviceLocation({
            allowPrompt: opts?.allowPrompt ?? knownGeo,
            alreadyPrompted: geoPromptedRef.current,
            maximumAgeMs: knownGeo ? 30_000 : 0,
          });
          if (gen !== refreshGenRef.current) return;
          if (!opts?.silentLocation && !knownGeo) setCheckingLocation(false);
          if (obtained.prompted) geoPromptedRef.current = true;
          if (obtained.ok) {
            location = obtained.location;
            lastLocationRef.current = location;
            setClientLocationReason(null);
          } else if (!knownGeo) {
            setClientLocationReason(obtained.reason);
          }
        }

        let next = await fetchWifiNotifyStatus(deviceId, location);
        if (gen !== refreshGenRef.current) return;

        if (!next.recognized && !location && !sendLocationFirst) {
          const perm = await getDeviceLocationPermissionState();
          const rememberedDenied = hasRememberedLocationDenial();
          if (perm === 'denied' || (rememberedDenied && perm !== 'granted')) {
            if (perm === 'denied') rememberLocationDenial();
            setClientLocationReason('location_denied');
          } else if (perm === 'unsupported') {
            geoPromptedRef.current = true;
            setClientLocationReason('location_unavailable');
          } else if (
            (perm === 'prompt' || perm === 'unknown') &&
            geoPromptedRef.current &&
            !opts?.allowPrompt
          ) {
            setClientLocationReason('location_permission_required');
          } else {
            if (perm === 'prompt' || perm === 'unknown') geoPromptedRef.current = true;
            if (!opts?.silentLocation) setCheckingLocation(true);
            const obtained = await obtainDeviceLocation({
              allowPrompt: opts?.allowPrompt ?? true,
              alreadyPrompted: false,
              maximumAgeMs: 0,
            });
            if (gen !== refreshGenRef.current) return;
            if (!opts?.silentLocation) setCheckingLocation(false);
            if (obtained.prompted) geoPromptedRef.current = true;
            if (obtained.ok) {
              location = obtained.location;
              lastLocationRef.current = location;
              setClientLocationReason(null);
              next = await fetchWifiNotifyStatus(deviceId, location);
              if (gen !== refreshGenRef.current) return;
            } else {
              setClientLocationReason(obtained.reason);
            }
          }
        }

        lastStatusMethodRef.current = next.method ?? null;
        if (next.method === 'geofence' && location) {
          geoSessionRefreshedRef.current = true;
        }
        setStatus(next);
        setStatusError(null);
        if (!next.sessionActive) setLocalActive(null);
      } catch (e) {
        if (gen !== refreshGenRef.current) return;
        setCheckingLocation(false);
        setStatusError(e instanceof Error ? e.message : t.wifiNotify.statusFailed);
      }
    },
    [deviceId, t.wifiNotify.statusFailed],
  );

  useEffect(() => {
    void refreshStatus();
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void refreshStatus({ silentLocation: true });
      }
    };
    const onOnline = () => {
      void refreshStatus({ silentLocation: true });
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
    };
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
  queriedActiveRef.current = queriedActive;

  useEffect(() => {
    const method = queriedActive
      ? resolveNotificationActivationMethod(queriedActive)
      : '';
    if (method !== 'geofence') {
      geoSessionRefreshedRef.current = false;
      return;
    }
    if (geoSessionRefreshedRef.current || lastStatusMethodRef.current === 'geofence') {
      return;
    }
    void refreshStatus({ withLocation: true, silentLocation: true });
  }, [queriedActive, refreshStatus]);

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
  const activeMethod: NotificationActivationMethod | '' | null =
    localActive?.method ||
    (queriedActive ? resolveNotificationActivationMethod(queriedActive) : '') ||
    status?.method ||
    null;

  const hasActiveSession = Boolean(
    queriedActive ||
      localActive?.storeCode ||
      (status?.sessionActive && (status.storeCode || activeStoreCode)),
  );

  const iosInstallRequired =
    install.isIos && !install.standalone && !install.installed;
  const permissionGranted = getPushPermissionState() === 'granted';
  const canAutoActivate = permissionGranted && !iosInstallRequired;

  const displayReason = clientLocationReason || status?.reason || null;
  const distanceM =
    status?.distanceM ?? parseSessionNumber(queriedActive?.distanceFromStoreM);
  const accuracyM =
    status?.accuracyM ?? parseSessionNumber(queriedActive?.locationAccuracyM);
  const geofenceRadiusM = status?.geofenceRadiusM ?? null;
  const presenceVerifiedAt =
    status?.presenceVerifiedAt || queriedActive?.presenceVerifiedAt || null;

  const runEnable = useCallback(async () => {
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

      const needsLocation =
        status?.method === 'geofence' ||
        !status?.recognized ||
        lastStatusMethodRef.current === 'geofence';
      let location = lastLocationRef.current;
      if (needsLocation && !location) {
        setCheckingLocation(true);
        const obtained = await obtainDeviceLocation({
          allowPrompt: true,
          alreadyPrompted: geoPromptedRef.current,
          maximumAgeMs: 0,
        });
        setCheckingLocation(false);
        if (obtained.prompted) geoPromptedRef.current = true;
        if (obtained.ok) {
          location = obtained.location;
          lastLocationRef.current = location;
          setClientLocationReason(null);
        } else if (!status?.recognized) {
          setClientLocationReason(obtained.reason);
          setActionMessage(
            reasonMessage(obtained.reason, t.wifiNotify) || t.wifiNotify.activateFailed,
          );
          return;
        }
      }

      const result = await activateWifiNotify(
        deviceId,
        status?.method === 'geofence' || !status?.recognized ? location : null,
      );
      if (!result.ok) {
        setActionMessage(result.error || result.reason || t.wifiNotify.activateFailed);
        await refreshStatus({
          withLocation: Boolean(location),
          silentLocation: true,
        });
        return;
      }
      const storeCode = result.storeCode || status?.storeCode || '';
      const expiresAt = result.expiresAt || status?.expiresAt || '';
      const method = result.method || status?.method || '';
      if (storeCode) {
        setLocalActive({ storeCode, expiresAt, method });
        if (method === 'geofence' || method === 'wifi_ip') {
          lastStatusMethodRef.current = method;
        }
      }
      setShowInstallGate(false);
      setActionMessage(null);
      await refreshStatus({
        withLocation: method === 'geofence' || Boolean(location),
        silentLocation: true,
      });
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : t.wifiNotify.activateFailed);
    } finally {
      setBusy(false);
      setCheckingLocation(false);
    }
  }, [
    deviceId,
    install.isIos,
    install.installed,
    install.standalone,
    refreshStatus,
    status?.expiresAt,
    status?.method,
    status?.recognized,
    status?.storeCode,
    t.wifiNotify,
  ]);

  // Auto-activate when recognized + permission already granted + no session
  useEffect(() => {
    if (!status?.recognized || hasActiveSession || status.sessionActive) {
      if (!status?.recognized || hasActiveSession) {
        autoActivateRef.current.attemptedStoreId = null;
      }
      return;
    }
    if (!canAutoActivate) return;
    if (busy || checkingLocation || autoActivateRef.current.inFlight) return;

    const storeKey = String(status.storeId || status.storeCode || '').trim();
    if (!storeKey) return;
    if (autoActivateRef.current.attemptedStoreId === storeKey) return;

    autoActivateRef.current.attemptedStoreId = storeKey;
    autoActivateRef.current.inFlight = true;
    void runEnable().finally(() => {
      autoActivateRef.current.inFlight = false;
    });
  }, [busy, canAutoActivate, checkingLocation, hasActiveSession, runEnable, status]);

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
  if (!status && !statusError && !hasActiveSession && !checkingLocation) {
    return null;
  }

  const toggleDetailsLabel = detailsOpen ? '▲' : '▼';
  const detailsToggle = (
    <button
      className="secondary wifi-notify-toggle"
      type="button"
      aria-expanded={detailsOpen}
      aria-label={detailsOpen ? t.wifiNotify.hideDetails : t.wifiNotify.showDetails}
      onClick={() => setDetailsOpen((v) => !v)}
    >
      {toggleDetailsLabel}
    </button>
  );

  const verification = verificationCopy(activeMethod || status?.method, copy);
  const specificReason = reasonMessage(displayReason, copy);

  if (hasActiveSession) {
    return (
      <div className="alert-success wifi-notify-banner">
        <div className="wifi-notify-summary">
          <div>
            <p className="small">
              {t.wifiNotify.recognizedTitle.replace('{storeCode}', activeStoreCode)}
            </p>
            {verification ? (
              <p className="small" style={{ margin: '2px 0 0', opacity: 0.8, fontSize: 11 }}>
                {verification}
              </p>
            ) : null}
          </div>
          {detailsToggle}
        </div>
        {detailsOpen && (
          <>
            <p className="small" style={{ margin: '6px 0 0' }}>
              {activeExpiresAt
                ? t.wifiNotify.activeUntil
                    .replace('{storeCode}', activeStoreCode)
                    .replace('{time}', formatExpiry(activeExpiresAt, lang))
                : t.wifiNotify.active.replace('{storeCode}', activeStoreCode)}
            </p>
            <p className="small" style={{ margin: '6px 0 0', opacity: 0.85 }}>
              {t.wifiNotify.limitation}
            </p>
            {showDiagnostics ? (
              <PresenceDiagnostics
                method={activeMethod || status?.method}
                distanceM={distanceM}
                accuracyM={accuracyM}
                geofenceRadiusM={geofenceRadiusM}
                presenceVerifiedAt={presenceVerifiedAt}
                lang={lang}
                copy={copy}
              />
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button className="secondary" disabled={busy} onClick={() => void onTestPush()}>
                {t.wifiNotify.sendTest}
              </button>
            </div>
            {actionMessage && (
              <p className="small" style={{ margin: '6px 0 0' }}>
                {actionMessage}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="alert-info wifi-notify-banner">
        <div className="wifi-notify-summary">
          <p className="small">
            {t.wifiNotify.statusFailed}: {statusError}
          </p>
          {detailsToggle}
        </div>
        {detailsOpen && (
          <button
            className="secondary"
            style={{ marginTop: 6 }}
            disabled={busy}
            onClick={() => void refreshStatus({ allowPrompt: true })}
          >
            {t.common.retry}
          </button>
        )}
      </div>
    );
  }

  if (!status?.recognized) {
    const summary = checkingLocation
      ? t.wifiNotify.checkingLocation
      : specificReason || t.wifiNotify.unrecognized;
    return (
      <div className="alert-info wifi-notify-banner">
        <div className="wifi-notify-summary">
          <p className="small">{summary}</p>
          {detailsToggle}
        </div>
        {detailsOpen && (
          <>
            {!checkingLocation && specificReason && specificReason !== t.wifiNotify.unrecognized ? (
              <p className="small" style={{ margin: '6px 0 0' }}>
                {t.wifiNotify.unrecognized}
              </p>
            ) : null}
            <p className="small" style={{ margin: '6px 0 0', opacity: 0.85 }}>
              {t.wifiNotify.limitation}
            </p>
            {showDiagnostics ? (
              <PresenceDiagnostics
                method={status?.method}
                distanceM={distanceM}
                accuracyM={accuracyM}
                geofenceRadiusM={geofenceRadiusM}
                presenceVerifiedAt={presenceVerifiedAt}
                lang={lang}
                copy={copy}
              />
            ) : null}
            {!checkingLocation ? (
              <button
                className="secondary"
                style={{ marginTop: 8 }}
                disabled={busy}
                onClick={() => void refreshStatus({ withLocation: true, allowPrompt: true })}
              >
                {t.common.retry}
              </button>
            ) : null}
          </>
        )}
      </div>
    );
  }

  const storeCode = status.storeCode || '—';
  const recognizedVerification = verificationCopy(status.method || 'wifi_ip', copy);
  // Auto path: no Enable unless prior attempt failed (actionMessage) so user can retry
  const showEnableCta = !canAutoActivate || Boolean(actionMessage);
  const showEnabling = canAutoActivate && busy && !actionMessage;

  return (
    <div className="alert-info wifi-notify-banner">
      <div className="wifi-notify-summary">
        <div>
          <p className="small alert-info-title" style={{ margin: 0, fontSize: 12, lineHeight: 1.25 }}>
            {showEnabling
              ? t.wifiNotify.enabling
              : t.wifiNotify.recognizedTitle.replace('{storeCode}', storeCode)}
          </p>
          {!showEnabling && recognizedVerification ? (
            <p className="small" style={{ margin: '2px 0 0', opacity: 0.8, fontSize: 11 }}>
              {recognizedVerification}
            </p>
          ) : null}
        </div>
        {detailsToggle}
      </div>
      {detailsOpen && (
        <>
          {showEnableCta && (
            <p className="small" style={{ margin: '8px 0 0' }}>
              {t.wifiNotify.enableHint}
            </p>
          )}
          <p className="small" style={{ margin: '8px 0 0', opacity: 0.85 }}>
            {t.wifiNotify.limitation}
          </p>
          {showDiagnostics ? (
            <PresenceDiagnostics
              method={status.method || 'wifi_ip'}
              distanceM={distanceM}
              accuracyM={accuracyM}
              geofenceRadiusM={geofenceRadiusM}
              presenceVerifiedAt={presenceVerifiedAt}
              lang={lang}
              copy={copy}
            />
          ) : null}

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
          ) : showEnableCta ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              <button className="btn-gold" disabled={busy} onClick={() => void runEnable()}>
                {busy ? t.wifiNotify.enabling : t.wifiNotify.enable}
              </button>
            </div>
          ) : showEnabling ? (
            <p className="small" style={{ margin: '10px 0 0' }}>
              {t.wifiNotify.enabling}
            </p>
          ) : null}

          {actionMessage && (
            <p className="small" style={{ margin: '8px 0 0' }}>
              {actionMessage}
            </p>
          )}
        </>
      )}
    </div>
  );
}
