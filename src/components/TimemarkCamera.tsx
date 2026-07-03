import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../db';
import {
  DEFAULT_LOGOS,
  buildWeatherLine,
  canEditStoreLogo,
  parseCameraOptions,
  resolveActiveLogoUrl,
  serializeCameraOptions,
} from '../lib/cameraSettings';
import { generatePhotoCode, nowIso } from '../lib/utils';
import type { CameraOptions, Profile, ProofWeather, Store, UploadedMedia } from '../types';

interface Props {
  store: Store;
  itemTitle: string;
  reportDate: string;
  reportId: string;
  reportResponseId: string;
  profile: Profile;
  existingMedia: UploadedMedia[];
  onCapture: (media: UploadedMedia) => void;
}

type CamState = 'idle' | 'opening' | 'ready' | 'error';
type WeatherStatus = 'waiting' | 'loading' | 'ready' | 'unavailable';

interface ProofSnapshot {
  capturedAt: string;
  displayTime: string;
  storeCode: string;
  itemTitle: string;
  userName: string;
  locationLine: string;
  gps: { lat: number; lng: number; accuracy: number } | null;
  address: string;
  weatherLine: string;
  proofWeather: ProofWeather | null;
  proofLogoUrl: string;
  cameraOptionsSnapshot: CameraOptions;
}

function formatProofTime(d: Date): string {
  return d.toLocaleString('en-GB', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function buildLocationLine(
  gps: { lat: number; lng: number; accuracy: number } | null,
  gpsError: string | null,
  address: string,
): string {
  if (gpsError) return 'Location unavailable';
  if (!gps) return 'GPS verifying...';
  const coords = `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${Math.round(gps.accuracy)}m)`;
  if (address.trim()) return address.trim();
  return coords;
}

function proofWatermarkLines(proof: ProofSnapshot): string[] {
  const lines = [
    proof.storeCode,
    proof.itemTitle,
    proof.displayTime,
    proof.userName,
    proof.locationLine,
  ];
  if (proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine.trim()) {
    lines.push(proof.weatherLine);
  }
  return lines;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function ProofTimestampOverlay({ proof }: { proof: ProofSnapshot }) {
  return (
    <div className="proof-timestamp-overlay" aria-hidden="true">
      <div className="proof-ts-store">{proof.storeCode}</div>
      <div>{proof.itemTitle}</div>
      <div className="proof-ts-time">{proof.displayTime}</div>
      <div>{proof.userName}</div>
      <div className="proof-ts-location">{proof.locationLine}</div>
      {proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine && (
        <div className="proof-ts-weather">{proof.weatherLine}</div>
      )}
    </div>
  );
}

function ProofLogoOverlay({ url }: { url: string }) {
  if (!url.trim()) return null;
  return (
    <img
      className="proof-logo-overlay"
      src={url}
      alt=""
      aria-hidden="true"
    />
  );
}

export default function TimemarkCamera({
  store,
  itemTitle,
  reportDate,
  reportId,
  reportResponseId,
  profile,
  existingMedia,
  onCapture,
}: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const bsTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weatherTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

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

  const [cameraOn,  setCameraOn]  = useState(false);
  const [camState,  setCamState]  = useState<CamState>('idle');
  const [camError,  setCamError]  = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [retryTick, setRetryTick] = useState(0);

  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl,  setCapturedUrl]  = useState('');

  const [uploading,     setUploading]     = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const isAdminLogo = canEditStoreLogo(profile?.role);
  const activeLogoUrl = storeLogoUrl.trim() || resolveActiveLogoUrl(store);

  useEffect(() => {
    setCameraOptions(parseCameraOptions(profile));
  }, [profile?.cameraOptionsJson, profile?.id]);

  useEffect(() => {
    setStoreLogoUrl(store?.proofLogoUrl?.trim() ?? '');
  }, [store?.id, store?.proofLogoUrl]);

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
      const locationLine = buildLocationLine(gpsSnap, gpsError, address);
      const weatherLine = buildWeatherLine(opts.weatherEnabled, gpsSnap, gpsError, wStatus, weather);

      return {
        capturedAt: at.toISOString(),
        displayTime: formatProofTime(at),
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
    [store, itemTitle, profile, gpsError],
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
    if (!navigator.geolocation) { setGpsError('Geolocation not supported'); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err)  => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

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

    if (!gps) {
      setWeatherStatus('waiting');
      return;
    }
    if (gpsError) {
      setWeatherStatus('unavailable');
      return;
    }

    if (weatherTimer.current) clearTimeout(weatherTimer.current);
    weatherTimer.current = setTimeout(() => {
      setWeatherStatus('loading');
      fetch(`/api/weather/current?lat=${encodeURIComponent(gps.lat)}&lon=${encodeURIComponent(gps.lng)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data.temperature === 'number') {
            setLiveWeather(data as ProofWeather);
            setWeatherStatus('ready');
          } else {
            setWeatherStatus('unavailable');
          }
        })
        .catch(() => setWeatherStatus('unavailable'));
    }, 1000);

    return () => {
      if (weatherTimer.current) clearTimeout(weatherTimer.current);
    };
  }, [cameraOn, frozenProof, gps, gpsError, cameraOptions.weatherEnabled]);

  // ── Live clock while camera open (before capture) ────────────────────────
  useEffect(() => {
    if (!cameraOn || frozenProof) return;
    setLiveNow(new Date());
    const id = setInterval(() => setLiveNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [cameraOn, frozenProof]);

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
          audio: false,
        });
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        let msg = '';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg =
            'Camera cannot open. Please allow camera permission in your browser.\n\n' +
            'Không thể mở camera. Vui lòng cho phép quyền camera trong trình duyệt.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          msg =
            'Camera may be used by another app or unavailable.\n\n' +
            'Camera đang được dùng bởi ứng dụng khác hoặc trình duyệt không thể truy cập.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg =
            'This device or browser does not support live camera.\n\n' +
            'Thiết bị hoặc trình duyệt này không hỗ trợ camera trực tiếp.';
        } else {
          msg = (err.message || 'Camera error.') + '\n\nLỗi camera.';
        }
        setCamState('error');
        setCamError(msg);
        return;
      }

      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        setCamState('error');
        setCamError('Video element unavailable. Please try again.\n\nPhần tử video không khả dụng.');
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
            setCamError(
              'Camera opened but no image is visible. Please retry.\n\n' +
              'Camera đã mở nhưng không có hình ảnh. Vui lòng thử lại.',
            );
          }
        }, 4000);
      }

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (!cancelled) {
          setCamState('error');
          setCamError(
            'Camera was disconnected. Tap Retry.\n\n' +
            'Camera đã bị ngắt. Thử lại.',
          );
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, facingMode, retryTick]);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function watermarkBlob(blob: Blob, proof: ProofSnapshot): Promise<Blob> {
    const lines = proofWatermarkLines(proof);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d')!;
    canvas.width  = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);

    if (proof.cameraOptionsSnapshot.logoEnabled && proof.proofLogoUrl.trim()) {
      const logo = await loadImage(proof.proofLogoUrl);
      if (logo) {
        const maxH = Math.max(48, Math.floor(canvas.height * 0.08));
        const scale = maxH / logo.height;
        const w = logo.width * scale;
        const h = logo.height * scale;
        const margin = Math.max(12, Math.floor(canvas.width * 0.02));
        ctx.drawImage(logo, canvas.width - w - margin, margin, w, h);
      }
    }

    const padding    = Math.max(16, Math.floor(canvas.width * 0.025));
    const fontSize   = Math.max(20, Math.floor(canvas.width * 0.032));
    const lineHeight = Math.floor(fontSize * 1.35);
    const boxHeight  = padding * 2 + lineHeight * lines.length;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight);
    ctx.font      = `${fontSize}px Arial`;
    ctx.fillStyle = 'white';
    lines.forEach((line, i) => {
      ctx.fillText(line, padding, canvas.height - boxHeight + padding + lineHeight * (i + 0.75));
    });
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
    mode: 'live_camera' | 'file_fallback',
    proof: ProofSnapshot,
  ) {
    setUploading(true);
    try {
      const photoCode  = generatePhotoCode(store?.code ?? 'XX');
      const capturedAt = proof.capturedAt;
      const path       = `stores/${store.id}/reports/${reportId}/${reportResponseId}/${Date.now()}_${fileName}`;

      const proofMetadataJson = JSON.stringify({
        proofTimestamp: proof.displayTime,
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
            ? 'Server error — photo upload API failed. Please try again in a moment.'
            : rawText.slice(0, 120) || `Upload failed (${resp.status})`,
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
      setLogoMsg('Logo saved.');
    } catch {
      setLogoMsg('Could not save logo. Try again.');
    }
  }

  async function handleLogoFile(file: File) {
    if (!isAdminLogo) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setLogoMsg('Use PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoMsg('Max file size 2MB.');
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
        setLogoMsg(result.error ?? 'Upload failed.');
        return;
      }
      await saveStoreLogoUrl(result.url);
    } catch {
      setLogoMsg('Upload failed. Keeping current logo.');
    } finally {
      setLogoUploading(false);
    }
  }

  function handleOpenCamera() {
    if (capturedUrl) { URL.revokeObjectURL(capturedUrl); setCapturedUrl(''); }
    setCapturedBlob(null);
    setFrozenProof(null);
    setLiveNow(new Date());
    setOptionsOpen(false);
    setCamState('idle');
    setCamError('');
    setCameraOn(true);
  }

  async function handleCloseCamera() {
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

  async function handleCapture() {
    const video = videoRef.current;
    if (!video || camState !== 'ready') return;
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) return;
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
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const raw = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const watermarked = await watermarkBlob(raw, proof);

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setCamState('idle');
    setOptionsOpen(false);

    const url = URL.createObjectURL(watermarked);
    setCapturedBlob(watermarked);
    setCapturedUrl(url);
  }

  async function handleConfirmPhoto() {
    if (!capturedBlob || uploading || !frozenProof) return;
    setConfirmError('');
    try {
      await uploadBlob(capturedBlob, `${store?.code ?? 'photo'}_${Date.now()}.jpg`, 'live_camera', frozenProof);
      URL.revokeObjectURL(capturedUrl);
      setCapturedBlob(null);
      setCapturedUrl('');
      setFrozenProof(null);
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Upload failed. Please try again.\n\nTải lên thất bại. Vui lòng thử lại.');
    }
  }

  async function handleRetake() {
    URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl('');
    setConfirmError('');
    setFrozenProof(null);
    setLiveNow(new Date());
    setOptionsOpen(false);
    setCameraOn(true);
  }

  const gpsStatus = gpsError ? 'error' : !gps ? 'warn' : gps.accuracy > 50 ? 'warn' : 'ok';
  const gpsLabel  = gpsError ? 'GPS ✗' : gps ? `±${Math.round(gps.accuracy)}m` : 'GPS…';

  const showLiveOverlay = camState === 'ready' && !frozenProof;
  const showLogo = cameraOptions.logoEnabled && activeLogoUrl;

  return (
    <div>
      {!cameraOn && !capturedBlob && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={handleOpenCamera} disabled={uploading}>
            📷  Open Camera / Mở camera
          </button>
        </div>
      )}

      {cameraOn && (
        <div className="camera-fullscreen">
          <div className="camera-topbar">
            <button
              className="cam-icon-btn"
              onClick={handleCloseCamera}
              aria-label="Close camera"
              style={{ minWidth: 44, minHeight: 44, padding: '4px 8px', fontSize: 18, borderRadius: 10 }}
            >
              ✕
            </button>
            <span className="camera-topbar-title">Chụp ảnh minh chứng</span>
            <div className="camera-topbar-actions">
              {torchProbed && (
                torchSupported ? (
                  <button
                    className={`cam-icon-btn cam-flash-btn${torchOn ? ' active' : ''}`}
                    onClick={() => applyTorch(!torchOn)}
                    aria-label={torchOn ? 'Turn flash off' : 'Turn flash on'}
                    title={torchOn ? 'Flash on' : 'Flash off'}
                  >
                    ⚡
                  </button>
                ) : (
                  <button
                    className="cam-icon-btn"
                    disabled
                    title="Flash not supported on this device."
                    aria-label="Flash not supported"
                  >
                    ⚡
                  </button>
                )
              )}
              <button
                className={`cam-icon-btn${optionsOpen ? ' active' : ''}`}
                onClick={() => setOptionsOpen((o) => !o)}
                aria-label="Camera options"
                title="Options"
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
                <span>Flashlight</span>
                {torchSupported ? (
                  <button type="button" className="cam-opt-toggle" onClick={() => applyTorch(!torchOn)}>
                    {torchOn ? 'On' : 'Off'}
                  </button>
                ) : (
                  <span className="cam-opt-muted">Not supported</span>
                )}
              </div>
              <div className="camera-options-row">
                <span>Weather overlay</span>
                <button
                  type="button"
                  className="cam-opt-toggle"
                  onClick={() => saveCameraOptions({ ...cameraOptions, weatherEnabled: !cameraOptions.weatherEnabled })}
                >
                  {cameraOptions.weatherEnabled ? 'On' : 'Off'}
                </button>
              </div>
              <div className="camera-options-row">
                <span>Logo overlay</span>
                <button
                  type="button"
                  className="cam-opt-toggle"
                  onClick={() => saveCameraOptions({ ...cameraOptions, logoEnabled: !cameraOptions.logoEnabled })}
                >
                  {cameraOptions.logoEnabled ? 'On' : 'Off'}
                </button>
              </div>
              {cameraOptions.logoEnabled && activeLogoUrl && (
                <div className="camera-options-logo-preview">
                  <img src={activeLogoUrl} alt="Logo preview" />
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
                    {logoUploading ? 'Uploading…' : 'Change logo'}
                  </button>
                  <div className="camera-options-defaults">
                    {DEFAULT_LOGOS.map((url) => (
                      <button
                        key={url}
                        type="button"
                        className="cam-opt-default-thumb"
                        onClick={() => void saveStoreLogoUrl(url)}
                        title="Use this default logo"
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
                    Use default logo
                  </button>
                </div>
              )}
              {logoMsg && <p className="cam-opt-msg">{logoMsg}</p>}
            </div>
          )}

          <div className="camera-viewfinder">
            <video ref={videoRef} playsInline muted autoPlay />

            {showLiveOverlay && (
              <>
                <ProofTimestampOverlay proof={liveProof} />
                {showLogo && <ProofLogoOverlay url={activeLogoUrl} />}
              </>
            )}

            {camState === 'opening' && (
              <div className="cam-state-overlay">
                <div className="cam-spinner" />
                <p style={{ color: '#fff', textAlign: 'center', margin: 0, fontSize: 14 }}>
                  Opening camera…<br />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>Đang mở camera…</span>
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
                    🔄 Retry / Thử lại
                  </button>
                  <button
                    className="secondary"
                    onClick={handleCloseCamera}
                    style={{ fontSize: 13, padding: '10px 20px', borderRadius: 10 }}
                  >
                    ✕ Close / Đóng
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="camera-controls">
            <button
              className="cam-icon-btn"
              onClick={handleSwitchCamera}
              disabled={camState === 'opening'}
              aria-label="Switch camera"
              title="Switch camera / Đổi camera"
            >
              🔄<span>Đổi</span>
            </button>

            <button
              className={`shutter${camState !== 'ready' ? ' disabled' : ''}`}
              onClick={handleCapture}
              disabled={camState !== 'ready'}
              aria-label="Capture photo"
            >
              <div className="shutter-inner" />
            </button>

            <button
              className="cam-icon-btn"
              onClick={handleCloseCamera}
              aria-label="Close camera"
              title="Close / Đóng"
            >
              ✕<span>Đóng</span>
            </button>
          </div>
        </div>
      )}

      {capturedBlob && frozenProof && (
        <div className="postcapture-sheet">
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>
            Xem lại ảnh / Review Photo
          </div>

          <div className="postcapture-thumb">
            <img src={capturedUrl} alt="Captured photo" />
            <ProofTimestampOverlay proof={frozenProof} />
            {frozenProof.cameraOptionsSnapshot.logoEnabled && frozenProof.proofLogoUrl && (
              <ProofLogoOverlay url={frozenProof.proofLogoUrl} />
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
              ↩ Chụp lại<br /><span style={{ fontWeight: 400, fontSize: 11 }}>Retake</span>
            </button>
            <button
              onClick={handleConfirmPhoto}
              disabled={uploading}
              style={{ background: '#FDC216', color: '#111', fontWeight: 700, borderRadius: 12 }}
            >
              {uploading ? 'Saving…' : '✓ Dùng ảnh này'}<br />
              {!uploading && <span style={{ fontWeight: 400, fontSize: 11 }}>Use Photo</span>}
            </button>
          </div>
        </div>
      )}

      {existingMedia.length > 0 && !cameraOn && !capturedBlob && (
        <div className="thumb-grid" style={{ marginTop: 10 }}>
          {existingMedia.map((m) => (
            <div key={m.mediaRecordId}>
              <img src={m.url} alt={m.fileName} />
              <div className="photo-code-box" style={{ marginTop: 4 }}>
                <div className="photo-code-label">Photo code</div>
                <div className="photo-code-value">{m.photoCode}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
