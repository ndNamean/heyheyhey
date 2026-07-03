import { useCallback, useEffect, useRef, useState } from 'react';
import { generatePhotoCode } from '../lib/utils';
import type { Profile, Store, UploadedMedia } from '../types';

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

interface ProofSnapshot {
  capturedAt: string;
  displayTime: string;
  storeCode: string;
  itemTitle: string;
  userName: string;
  locationLine: string;
  gps: { lat: number; lng: number; accuracy: number } | null;
  address: string;
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
  return [
    proof.storeCode,
    proof.itemTitle,
    proof.displayTime,
    proof.userName,
    proof.locationLine,
  ];
}

function ProofTimestampOverlay({ proof }: { proof: ProofSnapshot }) {
  return (
    <div className="proof-timestamp-overlay" aria-hidden="true">
      <div className="proof-ts-store">{proof.storeCode}</div>
      <div>{proof.itemTitle}</div>
      <div className="proof-ts-time">{proof.displayTime}</div>
      <div>{proof.userName}</div>
      <div className="proof-ts-location">{proof.locationLine}</div>
    </div>
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

  const [gps,      setGps]      = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState('');

  const [liveNow, setLiveNow] = useState(() => new Date());
  const [frozenProof, setFrozenProof] = useState<ProofSnapshot | null>(null);

  // Camera overlay visibility
  const [cameraOn,  setCameraOn]  = useState(false);
  const [camState,  setCamState]  = useState<CamState>('idle');
  const [camError,  setCamError]  = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [retryTick, setRetryTick] = useState(0);

  // Post-capture preview
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl,  setCapturedUrl]  = useState('');

  const [uploading,     setUploading]     = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const buildProofSnapshot = useCallback(
    (at: Date, gpsSnap: typeof gps, addressSnap: string): ProofSnapshot => {
      const storeCode = store?.code?.trim() || '—';
      const title = itemTitle?.trim() || '—';
      const userName =
        profile?.displayName?.trim() ||
        profile?.email?.split('@')[0]?.trim() ||
        '—';
      const address = addressSnap?.trim() ?? '';
      const locationLine = buildLocationLine(gpsSnap, gpsError, address);

      return {
        capturedAt: at.toISOString(),
        displayTime: formatProofTime(at),
        storeCode,
        itemTitle: title,
        userName,
        locationLine,
        gps: gpsSnap,
        address,
      };
    },
    [store, itemTitle, profile, gpsError],
  );

  const liveProof = buildProofSnapshot(liveNow, gps, resolvedAddress);

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

  // ── Live clock while camera open (before capture) ────────────────────────
  useEffect(() => {
    if (!cameraOn || frozenProof) return;
    setLiveNow(new Date());
    const id = setInterval(() => setLiveNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [cameraOn, frozenProof]);

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

  function handleOpenCamera() {
    if (capturedUrl) { URL.revokeObjectURL(capturedUrl); setCapturedUrl(''); }
    setCapturedBlob(null);
    setFrozenProof(null);
    setLiveNow(new Date());
    setCamState('idle');
    setCamError('');
    setCameraOn(true);
  }

  function handleCloseCamera() {
    setCameraOn(false);
    setCamState('idle');
    setCamError('');
  }

  function handleSwitchCamera() {
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

    const captureMoment = new Date();
    const proof = buildProofSnapshot(captureMoment, gps, resolvedAddress);
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

  function handleRetake() {
    URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl('');
    setConfirmError('');
    setFrozenProof(null);
    setLiveNow(new Date());
    setCameraOn(true);
  }

  const gpsStatus = gpsError ? 'error' : !gps ? 'warn' : gps.accuracy > 50 ? 'warn' : 'ok';
  const gpsLabel  = gpsError ? 'GPS ✗' : gps ? `±${Math.round(gps.accuracy)}m` : 'GPS…';

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
            <div className={`gps-badge ${gpsStatus}`}>
              <span className={`gps-dot${gps ? ' gps-dot-pulse' : ''}`} />
              {gpsLabel}
            </div>
          </div>

          <div className="camera-viewfinder">
            <video ref={videoRef} playsInline muted autoPlay />

            {camState === 'ready' && !frozenProof && (
              <ProofTimestampOverlay proof={liveProof} />
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
