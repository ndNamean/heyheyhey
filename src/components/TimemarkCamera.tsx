import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { useLang } from '../i18n';
import {
  DEFAULT_LOGOS,
  buildWeatherLine,
  canEditStoreLogo,
  parseCameraOptions,
  resolveActiveLogoUrl,
  serializeCameraOptions,
} from '../lib/cameraSettings';
import { generatePhotoCode, nowIso } from '../lib/utils';
import { isVideoMedia, normalizeStoredMime, videoProxyUrl } from '../lib/mediaMime';
import { ensureProofFontsLoaded } from '../lib/proofFonts';
import {
  drawProofOverlay,
  loadImageForCanvas,
  type ProofSnapshot,
} from '../lib/proofWatermarkDraw';
import { needsVideoProof } from '../lib/roles';
import ProofReviewOverlay from './ProofReviewOverlay';
import type { CameraOptions, Profile, ProofWeather, Store, UploadedMedia } from '../types';

interface Props {
  store: Store;
  itemTitle: string;
  reportDate: string;
  reportId: string;
  reportResponseId: string;
  profile: Profile;
  proofType?: string;
  existingMedia: UploadedMedia[];
  onCapture: (media: UploadedMedia) => void;
  onReviewPendingChange?: (pending: boolean) => void;
}

type CamState = 'idle' | 'opening' | 'ready' | 'error';
type WeatherStatus = 'waiting' | 'loading' | 'ready' | 'unavailable';
type CaptureMode = 'live_camera' | 'file_fallback' | 'live_video';

const MAX_VIDEO_SECONDS = 60;

function pickVideoMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

function extensionForMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.startsWith('video/')) return 'webm';
  return 'jpg';
}

function isVideoMime(mime?: string): boolean {
  return !!mime?.startsWith('video/');
}

function resolveCaptureMime(blob: Blob | null, mimeFallback?: string): string {
  if (blob?.type) return blob.type;
  if (mimeFallback?.trim()) return mimeFallback;
  return 'image/jpeg';
}

import { buildProofTimeFields } from '../lib/proofTime';

function buildLocationLine(
  gps: { lat: number; lng: number; accuracy: number } | null,
  gpsError: string | null,
  address: string,
  messages: { locationUnavailable: string; gpsVerifying: string },
): string {
  if (gpsError) return messages.locationUnavailable;
  if (!gps) return messages.gpsVerifying;
  const coords = `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${Math.round(gps.accuracy)}m)`;
  if (address.trim()) return address.trim();
  return coords;
}

function getWeatherCoords(
  gps: { lat: number; lng: number; accuracy: number } | null,
): { lat: number; lon: number } | null {
  if (!gps) return null;
  const g = gps as { lat?: number; lng?: number; latitude?: number; longitude?: number; lon?: number };
  const lat = g.latitude ?? g.lat;
  const lon = g.longitude ?? g.lon ?? g.lng;
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return { lat, lon };
}

export default function TimemarkCamera({
  store,
  itemTitle,
  reportDate,
  reportId,
  reportResponseId,
  profile,
  proofType = 'photo',
  existingMedia,
  onCapture,
  onReviewPendingChange,
}: Props) {
  const { t } = useLang();
  const videoMode = needsVideoProof(proofType);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const bsTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weatherTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedWeatherKeyRef = useRef('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartedAtRef = useRef<number>(0);
  const compositorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRafRef = useRef<number | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const recordingProofRef = useRef<ProofSnapshot | null>(null);
  const recordingLogoRef = useRef<HTMLImageElement | null>(null);

  const [gps,      setGps]      = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState('');

  const [liveNow, setLiveNow] = useState(() => new Date());
  const [frozenProof, setFrozenProof] = useState<ProofSnapshot | null>(null);

  const [cameraOptions, setCameraOptions] = useState<CameraOptions>(() => parseCameraOptions(profile));
  const [liveWeather, setLiveWeather] = useState<ProofWeather | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<WeatherStatus>('waiting');
  const [storeLogoUrl, setStoreLogoUrl] = useState(() => store?.proofLogoUrl?.trim() ?? '');

  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchProbed, setTorchProbed] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState('');
  const [micUnavailableMsg, setMicUnavailableMsg] = useState('');

  const [cameraOn,  setCameraOn]  = useState(false);
  const [camState,  setCamState]  = useState<CamState>('idle');
  const [camError,  setCamError]  = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [retryTick, setRetryTick] = useState(0);

  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl,  setCapturedUrl]  = useState('');
  const [captureSize, setCaptureSize] = useState<{ w: number; h: number } | null>(null);

  const [uploading,     setUploading]     = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [capturedMimeType, setCapturedMimeType] = useState('image/jpeg');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [previewFrameSize, setPreviewFrameSize] = useState<{ w: number; h: number } | null>(null);

  const isAdminLogo = canEditStoreLogo(profile?.role);
  const activeLogoUrl = storeLogoUrl.trim() || resolveActiveLogoUrl(store);
  const weatherCoords = getWeatherCoords(gps);
  const weatherKey =
    weatherCoords && !gpsError
      ? `${weatherCoords.lat.toFixed(2)},${weatherCoords.lon.toFixed(2)}`
      : '';

  useEffect(() => {
    setCameraOptions(parseCameraOptions(profile));
  }, [profile?.cameraOptionsJson, profile?.id]);

  useEffect(() => {
    setStoreLogoUrl(store?.proofLogoUrl?.trim() ?? '');
  }, [store?.id, store?.proofLogoUrl]);

  const locationStatusMessages = useMemo(
    () => ({
      locationUnavailable: t.camera.locationUnavailable,
      gpsVerifying: t.camera.gpsVerifying,
    }),
    [t],
  );

  const weatherStatusMessages = useMemo(
    () => ({
      unavailable: t.camera.weatherUnavailable,
      waitingGps: t.camera.weatherWaitingGps,
      loading: t.camera.weatherLoading,
    }),
    [t],
  );

  const buildProofSnapshot = useCallback(
    (
      at: Date,
      gpsSnap: typeof gps,
      addressSnap: string,
      weather: ProofWeather | null,
      wStatus: WeatherStatus,
      logoUrl: string,
      opts: CameraOptions,
    ): ProofSnapshot => {
      const storeCode = store?.code?.trim() || '—';
      const title = itemTitle?.trim() || '—';
      const userName =
        profile?.displayName?.trim() ||
        profile?.email?.split('@')[0]?.trim() ||
        '—';
      const address = addressSnap?.trim() ?? '';
      const locationLine = buildLocationLine(gpsSnap, gpsError, address, locationStatusMessages);
      const weatherLine = buildWeatherLine(
        opts.weatherEnabled,
        gpsSnap,
        gpsError,
        wStatus,
        weather,
        weatherStatusMessages,
      );
      const { capturedAt, displayTime, proofTimezone } = buildProofTimeFields(at, gpsSnap);

      return {
        capturedAt,
        displayTime,
        proofTimezone,
        storeCode,
        itemTitle: title,
        userName,
        locationLine,
        gps: gpsSnap,
        address,
        weatherLine,
        proofWeather: opts.weatherEnabled ? weather : null,
        proofLogoUrl: opts.logoEnabled ? logoUrl : '',
        cameraOptionsSnapshot: { ...opts },
      };
    },
    [store, itemTitle, profile, gpsError, locationStatusMessages, weatherStatusMessages],
  );

  const liveProof = buildProofSnapshot(
    liveNow,
    gps,
    resolvedAddress,
    liveWeather,
    weatherStatus,
    activeLogoUrl,
    cameraOptions,
  );

  const setTorchOff = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || !torchOn) {
      setTorchOn(false);
      return;
    }
    try {
      await track.applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints);
    } catch { /* unsupported */ }
    setTorchOn(false);
  }, [torchOn]);

  const applyTorch = useCallback(async (on: boolean) => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track || !torchSupported) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] } as MediaTrackConstraints);
      setTorchOn(on);
      const next = { ...cameraOptions, flashlightLastUsed: on };
      setCameraOptions(next);
      db.transact(
        db.tx.profiles[profile.id].update({
          cameraOptionsJson: serializeCameraOptions(next),
          updatedAt: nowIso(),
        }),
      ).catch(() => { /* non-blocking */ });
    } catch { /* device rejected */ }
  }, [torchSupported, cameraOptions, profile.id]);

  async function saveCameraOptions(next: CameraOptions) {
    setCameraOptions(next);
    try {
      await db.transact(
        db.tx.profiles[profile.id].update({
          cameraOptionsJson: serializeCameraOptions(next),
          updatedAt: nowIso(),
        }),
      );
    } catch { /* non-blocking */ }
  }

  // ── GPS watch (unchanged) ────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setGpsError(t.camera.geolocationNotSupported); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err)  => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [t.camera.geolocationNotSupported]);

  // ── Reverse geocode when GPS available ───────────────────────────────────
  useEffect(() => {
    if (!gps || !cameraOn) return;

    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(() => {
      const { lat, lng } = gps;
      fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json`,
        { headers: { 'Accept-Language': 'en' } },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const label = data?.display_name;
          if (typeof label === 'string' && label.trim()) setResolvedAddress(label.trim());
        })
        .catch(() => { /* keep coordinates */ });
    }, 1500);

    return () => {
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    };
  }, [gps, cameraOn]);

  // ── Weather fetch (non-blocking) ─────────────────────────────────────────
  useEffect(() => {
    if (!cameraOn || frozenProof || !cameraOptions.weatherEnabled) return;

    if (gpsError) {
      setWeatherStatus('unavailable');
      return;
    }

    if (!weatherKey) {
      setWeatherStatus('waiting');
      return;
    }

    if (weatherKey === fetchedWeatherKeyRef.current && liveWeather) {
      setWeatherStatus('ready');
      return;
    }

    if (weatherTimer.current) clearTimeout(weatherTimer.current);
    weatherTimer.current = setTimeout(() => {
      const coords = getWeatherCoords(gps);
      if (!coords) {
        setWeatherStatus('waiting');
        return;
      }
      setWeatherStatus('loading');
      fetch(`/api/weather/current?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data.temperature === 'number') {
            setLiveWeather(data as ProofWeather);
            setWeatherStatus('ready');
            fetchedWeatherKeyRef.current = weatherKey;
          } else {
            setWeatherStatus('unavailable');
          }
        })
        .catch(() => setWeatherStatus('unavailable'));
    }, 1000);

    return () => {
      if (weatherTimer.current) clearTimeout(weatherTimer.current);
    };
  }, [cameraOn, frozenProof, weatherKey, gps, gpsError, cameraOptions.weatherEnabled, liveWeather]);

  // ── Live clock while camera open (before capture) ────────────────────────
  useEffect(() => {
    if (!cameraOn || frozenProof) return;
    setLiveNow(new Date());
    const id = setInterval(() => setLiveNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [cameraOn, frozenProof]);

  const syncPreviewFrameSize = useCallback(() => {
    const video = videoRef.current;
    const viewfinder = viewfinderRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setPreviewFrameSize({ w: video.videoWidth, h: video.videoHeight });
      return;
    }
    if (viewfinder && viewfinder.clientWidth > 0 && viewfinder.clientHeight > 0) {
      setPreviewFrameSize({ w: viewfinder.clientWidth, h: viewfinder.clientHeight });
    }
  }, []);

  useEffect(() => {
    if (camState !== 'ready') return;
    syncPreviewFrameSize();
    const video = videoRef.current;
    const viewfinder = viewfinderRef.current;
    video?.addEventListener('loadedmetadata', syncPreviewFrameSize);
    window.addEventListener('resize', syncPreviewFrameSize);
    const ro = viewfinder ? new ResizeObserver(syncPreviewFrameSize) : null;
    if (viewfinder && ro) ro.observe(viewfinder);
    return () => {
      video?.removeEventListener('loadedmetadata', syncPreviewFrameSize);
      window.removeEventListener('resize', syncPreviewFrameSize);
      ro?.disconnect();
    };
  }, [camState, syncPreviewFrameSize]);

  const capturedUrlRef = useRef('');
  useEffect(() => {
    capturedUrlRef.current = capturedUrl;
  }, [capturedUrl]);

  useEffect(() => {
    onReviewPendingChange?.(!!capturedBlob);
    return () => onReviewPendingChange?.(false);
  }, [capturedBlob, onReviewPendingChange]);

  useEffect(() => () => {
    clearRecordTimer();
    stopCompositor();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    const url = capturedUrlRef.current;
    if (url) URL.revokeObjectURL(url);
    onReviewPendingChange?.(false);
  }, [onReviewPendingChange]);

  // ── Torch capability probe ───────────────────────────────────────────────
  useEffect(() => {
    if (!cameraOn || camState !== 'ready') {
      setTorchSupported(false);
      setTorchProbed(false);
      return;
    }
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      const supported = caps?.torch === true;
      setTorchSupported(supported);
      setTorchProbed(true);
      if (!supported) setTorchOn(false);
    } catch {
      setTorchSupported(false);
      setTorchProbed(true);
    }
  }, [cameraOn, camState, facingMode, retryTick]);

  // ── Turn torch off on unmount ────────────────────────────────────────────
  useEffect(() => () => {
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (track) {
      try {
        track.applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints).catch(() => {});
      } catch { /* ignore */ }
    }
  }, []);

  // ── Body-scroll lock while camera / preview is open ──────────────────────
  useEffect(() => {
    const lock = cameraOn || !!capturedBlob;
    document.body.style.overflow = lock ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [cameraOn, capturedBlob]);

  // ── Camera stream lifecycle (unchanged) ──────────────────────────────────
  useEffect(() => {
    if (!cameraOn) return;

    let cancelled = false;

    async function openStream() {
      if (bsTimer.current) clearTimeout(bsTimer.current);
      setCamState('opening');
      setCamError('');

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: videoMode,
        });
        if (videoMode) setMicUnavailableMsg('');
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        if (
          videoMode &&
          (err.name === 'NotAllowedError' ||
            err.name === 'PermissionDeniedError' ||
            err.name === 'NotFoundError' ||
            err.name === 'NotReadableError')
        ) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: facingMode } },
              audio: false,
            });
            setMicUnavailableMsg(t.camera.micUnavailable);
          } catch (retryErr) {
            const retry = retryErr as DOMException;
            let msg = '';
            if (retry.name === 'NotAllowedError' || retry.name === 'PermissionDeniedError') {
              msg = t.camera.permissionDenied;
            } else if (retry.name === 'NotReadableError' || retry.name === 'TrackStartError') {
              msg = t.camera.cameraInUse;
            } else if (retry.name === 'NotFoundError' || retry.name === 'DevicesNotFoundError') {
              msg = t.camera.cameraNotFound;
            } else {
              msg = retry.message || t.camera.cameraError;
            }
            setCamState('error');
            setCamError(msg);
            return;
          }
        } else {
          let msg = '';
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            msg = t.camera.permissionDenied;
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            msg = t.camera.cameraInUse;
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            msg = t.camera.cameraNotFound;
          } else {
            msg = err.message || t.camera.cameraError;
          }
          setCamState('error');
          setCamError(msg);
          return;
        }
      }

      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        setCamState('error');
        setCamError(t.camera.videoUnavailable);
        return;
      }

      video.srcObject = stream;

      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('canplay',        () => resolve(), { once: true });
      });

      if (cancelled) return;

      try { await video.play(); } catch { /* iOS may reject .play() */ }

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setCamState('ready');
      } else {
        const onFrame = () => {
          if (!cancelled && videoRef.current && videoRef.current.videoWidth > 0) {
            clearTimeout(bsTimer.current!);
            setCamState('ready');
            video.removeEventListener('timeupdate', onFrame);
          }
        };
        video.addEventListener('timeupdate', onFrame);

        bsTimer.current = setTimeout(() => {
          if (cancelled) return;
          video.removeEventListener('timeupdate', onFrame);
          const v = videoRef.current;
          if (v && v.videoWidth > 0) {
            setCamState('ready');
          } else {
            setCamState('error');
            setCamError(t.camera.noImage);
          }
        }, 4000);
      }

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (!cancelled) {
          setCamState('error');
          setCamError(t.camera.disconnected);
        }
      });
    }

    openStream();

    return () => {
      cancelled = true;
      if (bsTimer.current) clearTimeout(bsTimer.current);
      const track = streamRef.current?.getVideoTracks()?.[0];
      if (track) {
        try {
          track.applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints).catch(() => {});
        } catch { /* ignore */ }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [cameraOn, facingMode, retryTick, t, videoMode]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function watermarkBlob(blob: Blob, proof: ProofSnapshot): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d')!;
    canvas.width  = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);

    const hasLogo =
      proof.cameraOptionsSnapshot.logoEnabled && proof.proofLogoUrl.trim().length > 0;
    let logoImg: HTMLImageElement | null = null;
    if (hasLogo) {
      logoImg = await loadImageForCanvas(proof.proofLogoUrl);
    }

    const fontSize = Math.max(14, Math.round(bitmap.width * 0.035));
    await ensureProofFontsLoaded(fontSize);
    drawProofOverlay(ctx, canvas, proof, logoImg);

    return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
  }

  async function blobToBase64(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  }

  async function uploadBlob(
    blob: Blob,
    fileName: string,
    mode: CaptureMode,
    proof: ProofSnapshot,
    mimeType: string,
  ) {
    setUploading(true);
    try {
      const storedMime = normalizeStoredMime(mimeType);
      const photoCode  = generatePhotoCode(store?.code ?? 'XX');
      const capturedAt = proof.capturedAt;
      const path       = `stores/${store.id}/reports/${reportId}/${reportResponseId}/${Date.now()}_${fileName}`;
      const watermarked = mode === 'live_video' || storedMime.startsWith('image/');

      const proofMetadataJson = JSON.stringify({
        proofTimestamp: proof.displayTime,
        proofTimezone: proof.proofTimezone,
        proofLocation: proof.locationLine,
        proofWeather: proof.proofWeather,
        proofLogoUrl: proof.proofLogoUrl,
        cameraOptionsSnapshot: proof.cameraOptionsSnapshot,
      });

      const resp = await fetch('/api/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          fileName,
          contentType: storedMime,
          fileBase64: await blobToBase64(blob),
          metadata: {
            reportId,
            reportResponseId,
            storeId: store.id,
            lat: proof.gps?.lat ?? 0,
            lng: proof.gps?.lng ?? 0,
            accuracy: proof.gps?.accuracy ?? 0,
            capturedAt,
            photoCode,
            captureMode: mode,
            watermarked,
            mimeType: storedMime,
            uploadedByUserId: profile.userId,
            address: proof.address ?? '',
            proofMetadataJson,
          },
        }),
      });

      const rawText = await resp.text();
      let result: {
        error?: string;
        mediaRecordId?: string;
        fileId?: string;
        url?: string;
        fileName?: string;
        photoCode?: string;
        capturedAt?: string;
      };
      try {
        result = JSON.parse(rawText);
      } catch {
        throw new Error(
          rawText.startsWith('A server error')
            ? t.camera.serverUploadFailed
            : rawText.slice(0, 120) || `${t.camera.uploadFailed} (${resp.status})`,
        );
      }

      if (!resp.ok || result.error) {
        throw new Error(result.error ?? `Upload failed (${resp.status})`);
      }

      onCapture({
        mediaRecordId: result.mediaRecordId!,
        fileId:        result.fileId!,
        url:           result.url ?? '',
        fileName:      result.fileName ?? fileName,
        photoCode:     result.photoCode ?? photoCode,
        capturedAt:    result.capturedAt ?? capturedAt,
        mimeType: storedMime,
      });
    } finally {
      setUploading(false);
    }
  }

  async function saveStoreLogoUrl(url: string) {
    const next = url.trim();
    setStoreLogoUrl(next);
    try {
      await db.transact(
        db.tx.stores[store.id].update({
          proofLogoUrl: next,
          updatedAt: nowIso(),
        }),
      );
      setLogoMsg(t.camera.logoSaved);
    } catch {
      setLogoMsg(t.camera.logoSaveFailed);
    }
  }

  async function handleLogoFile(file: File) {
    if (!isAdminLogo) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setLogoMsg(t.camera.logoFileTypes);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoMsg(t.camera.logoMaxSize);
      return;
    }
    setLogoUploading(true);
    setLogoMsg('');
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const resp = await fetch('/api/upload-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: store.id,
          mimeType: file.type,
          fileBase64: btoa(binary),
        }),
      });
      const result = await resp.json();
      if (!resp.ok || !result.url) {
        setLogoMsg(result.error ?? t.camera.uploadFailed);
        return;
      }
      await saveStoreLogoUrl(result.url);
    } catch {
      setLogoMsg(t.camera.logoUploadFailedKeep);
    } finally {
      setLogoUploading(false);
    }
  }

  function handleOpenCamera() {
    if (capturedUrl) { URL.revokeObjectURL(capturedUrl); setCapturedUrl(''); }
    setCapturedBlob(null);
    setFrozenProof(null);
    setCaptureSize(null);
    setLiveNow(new Date());
    setOptionsOpen(false);
    fetchedWeatherKeyRef.current = '';
    setLiveWeather(null);
    setWeatherStatus('waiting');
    setCamState('idle');
    setCamError('');
    setIsRecording(false);
    setRecordSeconds(0);
    setCapturedMimeType('image/jpeg');
    setMicUnavailableMsg('');
    setCameraOn(true);
  }

  async function handleCloseCamera() {
    stopMediaRecorder();
    await setTorchOff();
    setOptionsOpen(false);
    setCameraOn(false);
    setCamState('idle');
    setCamError('');
  }

  async function handleSwitchCamera() {
    await setTorchOff();
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  }

  function handleRetryCamera() {
    setCamState('idle');
    setCamError('');
    setRetryTick((t) => t + 1);
  }

  function clearRecordTimer() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  function stopCompositor() {
    if (compositorRafRef.current != null) {
      cancelAnimationFrame(compositorRafRef.current);
      compositorRafRef.current = null;
    }
    compositeStreamRef.current?.getTracks().forEach((track) => track.stop());
    compositeStreamRef.current = null;
    compositorCanvasRef.current = null;
    recordingLogoRef.current = null;
  }

  function stopMediaRecorder() {
    clearRecordTimer();
    setIsRecording(false);
    setRecordSeconds(0);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      stopCompositor();
    }
    mediaRecorderRef.current = null;
  }

  async function finalizeVideoRecording(chunks: Blob[], mimeType: string) {
    if (!chunks.length) {
      setCamError(t.camera.videoNotSupported);
      recordingProofRef.current = null;
      return;
    }

    await setTorchOff();

    const proof = recordingProofRef.current ?? buildProofSnapshot(
      new Date(),
      gps,
      resolvedAddress,
      liveWeather,
      weatherStatus,
      activeLogoUrl,
      cameraOptions,
    );
    setFrozenProof(proof);
    recordingProofRef.current = null;

    const blob = new Blob(chunks, { type: mimeType });
    setCapturedMimeType(normalizeStoredMime(mimeType));
    setCaptureSize(null);

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
    setCamState('idle');
    setOptionsOpen(false);

    const url = URL.createObjectURL(blob);
    setCapturedBlob(blob);
    setCapturedUrl(url);
  }

  async function startVideoRecording() {
    const video = videoRef.current;
    const mimeType = pickVideoMimeType();
    if (!streamRef.current || !video || !mimeType) {
      setCamError(t.camera.videoNotSupported);
      return;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setCamError(t.camera.noImage);
      return;
    }

    const recordMoment = new Date();
    const frozenProof = buildProofSnapshot(
      recordMoment,
      gps,
      resolvedAddress,
      liveWeather,
      weatherStatus,
      activeLogoUrl,
      cameraOptions,
    );
    recordingProofRef.current = frozenProof;

    let logoImg: HTMLImageElement | null = null;
    if (
      frozenProof.cameraOptionsSnapshot.logoEnabled &&
      frozenProof.proofLogoUrl.trim().length > 0
    ) {
      logoImg = await loadImageForCanvas(frozenProof.proofLogoUrl);
    }
    recordingLogoRef.current = logoImg;

    const fontSize = Math.max(14, Math.round(video.videoWidth * 0.035));
    await ensureProofFontsLoaded(fontSize);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    compositorCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCamError(t.camera.cameraError);
      recordingProofRef.current = null;
      return;
    }

    const drawFrame = () => {
      const v = videoRef.current;
      const c = compositorCanvasRef.current;
      const proof = recordingProofRef.current;
      if (!v || !c || !proof || v.videoWidth === 0) return;
      const frameCtx = c.getContext('2d');
      if (!frameCtx) return;
      frameCtx.drawImage(v, 0, 0, c.width, c.height);
      drawProofOverlay(frameCtx, c, proof, recordingLogoRef.current);
      compositorRafRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    const compositeStream = canvas.captureStream(30);
    const audioTrack = streamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      compositeStream.addTrack(audioTrack);
    }
    compositeStreamRef.current = compositeStream;

    recordChunksRef.current = [];
    const recorder = new MediaRecorder(compositeStream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
    });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordChunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      stopMediaRecorder();
      setCamError(t.camera.cameraError);
    };
    recorder.onstop = () => {
      stopCompositor();
      const chunks = recordChunksRef.current;
      recordChunksRef.current = [];
      void finalizeVideoRecording(chunks, mimeType);
    };

    recorder.start();
    recordStartedAtRef.current = Date.now();
    setIsRecording(true);
    setRecordSeconds(0);

    recordTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStartedAtRef.current) / 1000);
      setRecordSeconds(elapsed);
      if (elapsed >= MAX_VIDEO_SECONDS) {
        stopMediaRecorder();
      }
    }, 500);
  }

  function handleRecordToggle() {
    if (camState !== 'ready') return;
    if (isRecording) {
      stopMediaRecorder();
    } else {
      void startVideoRecording();
    }
  }

  async function handleCapture() {
    if (videoMode) {
      handleRecordToggle();
      return;
    }
    const video = videoRef.current;
    if (!video || camState !== 'ready') return;
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (videoW === 0 || videoH === 0 || video.readyState < 2) return;
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    if (!tracks.length || tracks[0].readyState === 'ended') return;

    await setTorchOff();

    const captureMoment = new Date();
    const proof = buildProofSnapshot(
      captureMoment,
      gps,
      resolvedAddress,
      liveWeather,
      weatherStatus,
      activeLogoUrl,
      cameraOptions,
    );
    setFrozenProof(proof);

    const canvas = document.createElement('canvas');
    canvas.width  = videoW;
    canvas.height = videoH;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const raw = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const watermarked = await watermarkBlob(raw, proof);

    setCaptureSize({ w: videoW, h: videoH });

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setCamState('idle');
    setOptionsOpen(false);

    const url = URL.createObjectURL(watermarked);
    setCapturedMimeType('image/jpeg');
    setCapturedBlob(watermarked);
    setCapturedUrl(url);
  }

  async function handleConfirmPhoto() {
    if (!capturedBlob || uploading || !frozenProof) return;
    setConfirmError('');
    try {
      const mime = normalizeStoredMime(resolveCaptureMime(capturedBlob, capturedMimeType));
      const ext = extensionForMime(mime);
      const isVideo = isVideoMime(mime);
      const mode: CaptureMode = isVideo ? 'live_video' : 'live_camera';
      const prefix = isVideo ? 'video' : 'photo';
      await uploadBlob(
        capturedBlob,
        `${store?.code ?? prefix}_${Date.now()}.${ext}`,
        mode,
        frozenProof,
        mime,
      );
      URL.revokeObjectURL(capturedUrl);
      setCapturedBlob(null);
      setCapturedUrl('');
      setFrozenProof(null);
      setCaptureSize(null);
      setCapturedMimeType('image/jpeg');
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : t.camera.uploadFailed);
    }
  }

  async function handleRetake() {
    stopMediaRecorder();
    URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl('');
    setConfirmError('');
    setFrozenProof(null);
    setCaptureSize(null);
    setCapturedMimeType('image/jpeg');
    setLiveNow(new Date());
    setOptionsOpen(false);
    setCameraOn(true);
  }

  const gpsStatus = gpsError ? 'error' : !gps ? 'warn' : gps.accuracy > 50 ? 'warn' : 'ok';
  const gpsLabel  = gpsError ? 'GPS ✗' : gps ? `±${Math.round(gps.accuracy)}m` : 'GPS…';

  const showLiveOverlay = camState === 'ready' && !frozenProof && !(videoMode && isRecording);
  const reviewMime = resolveCaptureMime(capturedBlob, capturedMimeType);
  const reviewIsVideo = isVideoMime(reviewMime);

  return (
    <div>
      {!cameraOn && !capturedBlob && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={handleOpenCamera} disabled={uploading}>
            {videoMode ? `🎬 ${t.camera.openVideo}` : `📷 ${t.camera.openCamera}`}
          </button>
        </div>
      )}

      {cameraOn && createPortal(
        <div className="camera-fullscreen">
          <div className="camera-topbar">
            <button
              className="cam-icon-btn"
              onClick={handleCloseCamera}
              aria-label={t.camera.closeCamera}
              style={{ minWidth: 44, minHeight: 44, padding: '4px 8px', fontSize: 18, borderRadius: 10 }}
            >
              ✕
            </button>
            <span className="camera-topbar-title">
              {videoMode ? t.camera.captureVideoTitle : t.camera.captureTitle}
            </span>
            <div className="camera-topbar-actions">
              {torchProbed && (
                torchSupported ? (
                  <button
                    className={`cam-icon-btn cam-flash-btn${torchOn ? ' active' : ''}`}
                    onClick={() => applyTorch(!torchOn)}
                    aria-label={torchOn ? t.camera.flashlight : t.camera.flashlight}
                    title={torchOn ? t.camera.on : t.camera.off}
                  >
                    ⚡
                  </button>
                ) : (
                  <button
                    className="cam-icon-btn"
                    disabled
                    title={t.camera.flashNotSupported}
                    aria-label={t.camera.flashNotSupported}
                  >
                    ⚡
                  </button>
                )
              )}
              <button
                className={`cam-icon-btn${optionsOpen ? ' active' : ''}`}
                onClick={() => setOptionsOpen((o) => !o)}
                aria-label={t.camera.options}
                title={t.camera.options}
              >
                ⚙
              </button>
            </div>
            <div className={`gps-badge ${gpsStatus}`}>
              <span className={`gps-dot${gps ? ' gps-dot-pulse' : ''}`} />
              {gpsLabel}
            </div>
          </div>

          {optionsOpen && (
            <div className="camera-options-sheet">
              <div className="camera-options-row">
                <span>{t.camera.flashlight}</span>
                {torchSupported ? (
                  <button type="button" className="cam-opt-toggle" onClick={() => applyTorch(!torchOn)}>
                    {torchOn ? t.camera.on : t.camera.off}
                  </button>
                ) : (
                  <span className="cam-opt-muted">{t.camera.notSupported}</span>
                )}
              </div>
              <div className="camera-options-row">
                <span>{t.camera.weatherOverlay}</span>
                <button
                  type="button"
                  className="cam-opt-toggle"
                  onClick={() => saveCameraOptions({ ...cameraOptions, weatherEnabled: !cameraOptions.weatherEnabled })}
                >
                  {cameraOptions.weatherEnabled ? t.camera.on : t.camera.off}
                </button>
              </div>
              <div className="camera-options-row">
                <span>{t.camera.logoOverlay}</span>
                <button
                  type="button"
                  className="cam-opt-toggle"
                  onClick={() => saveCameraOptions({ ...cameraOptions, logoEnabled: !cameraOptions.logoEnabled })}
                >
                  {cameraOptions.logoEnabled ? t.camera.on : t.camera.off}
                </button>
              </div>
              {cameraOptions.logoEnabled && activeLogoUrl && (
                <div className="camera-options-logo-preview">
                  <img src={activeLogoUrl} alt={t.camera.logoPreview} />
                </div>
              )}
              {isAdminLogo && (
                <div className="camera-options-logo-actions">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleLogoFile(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="cam-opt-btn"
                    disabled={logoUploading}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {logoUploading ? t.camera.uploading : t.camera.changeLogo}
                  </button>
                  <div className="camera-options-defaults">
                    {DEFAULT_LOGOS.map((url) => (
                      <button
                        key={url}
                        type="button"
                        className="cam-opt-default-thumb"
                        onClick={() => void saveStoreLogoUrl(url)}
                        title={t.camera.useDefaultLogo}
                      >
                        <img src={url} alt="" />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="cam-opt-btn secondary"
                    onClick={() => void saveStoreLogoUrl('')}
                  >
                    {t.camera.useDefaultLogo}
                  </button>
                </div>
              )}
              {logoMsg && <p className="cam-opt-msg">{logoMsg}</p>}
            </div>
          )}

          <div className="camera-viewfinder" ref={viewfinderRef}>
            <video ref={videoRef} playsInline muted autoPlay />

            {micUnavailableMsg && (
              <div className="cam-mic-banner">{micUnavailableMsg}</div>
            )}

            {showLiveOverlay && (
              <ProofReviewOverlay
                proof={liveProof}
                frameWidth={previewFrameSize?.w}
                frameHeight={previewFrameSize?.h}
              />
            )}

            {isRecording && (
              <div className="cam-recording-badge">
                ● {t.camera.recording} {recordSeconds}s
              </div>
            )}

            {camState === 'opening' && (
              <div className="cam-state-overlay">
                <div className="cam-spinner" />
                <p style={{ color: '#fff', textAlign: 'center', margin: 0, fontSize: 14 }}>
                  {t.camera.opening}
                </p>
              </div>
            )}

            {camState === 'error' && (
              <div className="cam-state-overlay">
                <span style={{ fontSize: 40, lineHeight: 1 }}>📵</span>
                <p style={{ color: '#fff', textAlign: 'center', whiteSpace: 'pre-line', margin: 0, fontSize: 13 }}>
                  {camError}
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    onClick={handleRetryCamera}
                    style={{ fontSize: 13, padding: '10px 20px', borderRadius: 10 }}
                  >
                    🔄 {t.common.retry}
                  </button>
                  <button
                    className="secondary"
                    onClick={handleCloseCamera}
                    style={{ fontSize: 13, padding: '10px 20px', borderRadius: 10 }}
                  >
                    ✕ {t.camera.closeShort}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="camera-controls">
            <button
              className="cam-icon-btn"
              onClick={handleSwitchCamera}
              disabled={camState === 'opening' || isRecording}
              aria-label={t.camera.switchCamera}
              title={t.camera.switchCamera}
            >
              🔄<span>{t.camera.switchShort}</span>
            </button>

            <button
              className={`shutter${camState !== 'ready' ? ' disabled' : ''}${isRecording ? ' shutter--recording' : ''}${videoMode ? ' shutter--video' : ''}`}
              onClick={handleCapture}
              disabled={camState !== 'ready'}
              aria-label={videoMode ? (isRecording ? t.camera.stopRecording : t.camera.startRecording) : t.camera.capturePhoto}
            >
              <div className="shutter-inner" />
            </button>

            <button
              className="cam-icon-btn"
              onClick={handleCloseCamera}
              aria-label={t.camera.closeCamera}
              title={t.camera.closeShort}
            >
              ✕<span>{t.camera.closeShort}</span>
            </button>
          </div>
        </div>,
        document.body,
      )}

      {capturedBlob && frozenProof && createPortal(
        <div className="postcapture-sheet">
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>
            {reviewIsVideo ? t.camera.reviewVideo : t.camera.reviewPhoto}
          </div>

          <div
            className="postcapture-thumb"
            style={
              captureSize
                ? ({ '--capture-aspect': `${captureSize.w} / ${captureSize.h}` } as CSSProperties)
                : undefined
            }
          >
            {reviewIsVideo ? (
              <video src={capturedUrl} controls playsInline preload="metadata" />
            ) : (
              <img src={capturedUrl} alt={t.camera.capturedPhoto} />
            )}
          </div>

          {confirmError && (
            <div style={{
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.4)',
              borderRadius: 10,
              padding: '10px 14px',
              color: '#ef4444',
              fontSize: 13,
              whiteSpace: 'pre-line',
            }}>
              {confirmError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button
              onClick={handleRetake}
              disabled={uploading}
              style={{
                background: 'rgba(255,255,255,0.1)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 12,
              }}
            >
              ↩ {t.camera.retake}
            </button>
            <button
              onClick={handleConfirmPhoto}
              disabled={uploading}
              style={{ background: '#FDC216', color: '#111', fontWeight: 700, borderRadius: 12 }}
            >
              {uploading
                ? t.camera.saving
                : reviewIsVideo
                  ? `✓ ${t.camera.useVideo}`
                  : `✓ ${t.camera.usePhoto}`}
            </button>
          </div>
        </div>,
        document.body,
      )}

      {existingMedia.length > 0 && !cameraOn && !capturedBlob && (
        <div className="thumb-grid" style={{ marginTop: 10 }}>
          {existingMedia.map((m) => (
            <div key={m.mediaRecordId}>
              {isVideoMedia(m.mimeType, m.fileName) ? (
                <video
                  src={videoProxyUrl(m.mediaRecordId)}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img src={m.url} alt={m.fileName} />
              )}
              <div className="photo-code-box" style={{ marginTop: 4 }}>
                <div className="photo-code-label">{t.camera.photoCode}</div>
                <div className="photo-code-value">{m.photoCode}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
