import { useEffect, useMemo, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../db';
import { nowIso, nowText, generatePhotoCode } from '../lib/utils';
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
  const fileRef    = useRef<HTMLInputElement>(null);
  const bsTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [gps,      setGps]      = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Camera overlay visibility
  const [cameraOn,  setCameraOn]  = useState(false);
  const [camState,  setCamState]  = useState<CamState>('idle');
  const [camError,  setCamError]  = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  // Incrementing this with the same cameraOn/facingMode forces the effect to re-run (retry)
  const [retryTick, setRetryTick] = useState(0);

  // Post-capture preview
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl,  setCapturedUrl]  = useState('');

  const [uploading, setUploading] = useState(false);

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

  // ── Body-scroll lock while camera / preview is open ──────────────────────
  useEffect(() => {
    const lock = cameraOn || !!capturedBlob;
    document.body.style.overflow = lock ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [cameraOn, capturedBlob]);

  // ── Camera stream lifecycle ──────────────────────────────────────────────
  //
  // THE CRITICAL FIX: previously startCamera() called getUserMedia() BEFORE
  // setCameraOn(true), so videoRef.current was null and srcObject was never set.
  //
  // Now: setCameraOn(true) triggers a render that mounts <video>, THEN this
  // effect runs (after DOM commit) so videoRef.current is always valid.
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

      // Wait for the browser to have actual frame data available
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('canplay',        () => resolve(), { once: true });
      });

      if (cancelled) return;

      try { await video.play(); } catch { /* iOS may reject .play() */ }

      // Verify real pixel data (not a black frame)
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setCamState('ready');
        console.debug('[Camera] ready', video.videoWidth, 'x', video.videoHeight);
      } else {
        // Give the browser up to 4 s to produce the first frame
        const onFrame = () => {
          if (!cancelled && videoRef.current && videoRef.current.videoWidth > 0) {
            clearTimeout(bsTimer.current!);
            setCamState('ready');
            video.removeEventListener('timeupdate', onFrame);
            console.debug('[Camera] ready (deferred)', video.videoWidth, 'x', video.videoHeight);
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
              'Camera opened but no image is visible. Please retry or upload a photo.\n\n' +
              'Camera đã mở nhưng không có hình ảnh. Vui lòng thử lại hoặc tải ảnh lên.',
            );
            console.debug('[Camera] black-screen timeout');
          }
        }, 4000);
      }

      // Detect track ending mid-session (camera stolen by another app)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (!cancelled) {
          setCamState('error');
          setCamError(
            'Camera was disconnected. Tap Retry or upload instead.\n\n' +
            'Camera đã bị ngắt. Thử lại hoặc tải ảnh lên.',
          );
        }
      });

      console.debug('[Camera] track state:', stream.getVideoTracks()[0]?.readyState);
    }

    openStream();

    return () => {
      cancelled = true;
      if (bsTimer.current) clearTimeout(bsTimer.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  // retryTick forces a fresh attempt without toggling cameraOn
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, facingMode, retryTick]);

  // Stop any lingering stream on unmount
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  // ── Watermark text ──────────────────────────────────────────────────────
  const watermarkLines = useMemo(
    () => [
      `${store.code} | ${store.name} | ${itemTitle}`,
      `${reportDate} | ${nowText()} | ${gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'GPS pending'}`,
      `Submitted by: ${profile.displayName || profile.email}`,
    ],
    [store, itemTitle, reportDate, gps, profile],
  );

  // ── Watermark + canvas (unchanged logic) ────────────────────────────────
  async function watermarkBlob(blob: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d')!;
    canvas.width  = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    const padding    = Math.max(16, Math.floor(canvas.width * 0.025));
    const fontSize   = Math.max(22, Math.floor(canvas.width * 0.035));
    const lineHeight = Math.floor(fontSize * 1.35);
    const boxHeight  = padding * 2 + lineHeight * watermarkLines.length;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight);
    ctx.font      = `${fontSize}px Arial`;
    ctx.fillStyle = 'white';
    watermarkLines.forEach((line, i) => {
      ctx.fillText(line, padding, canvas.height - boxHeight + padding + lineHeight * (i + 0.75));
    });
    return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
  }

  // ── Upload (unchanged logic; added explicit mode param) ─────────────────
  async function uploadBlob(blob: Blob, fileName: string, mode: 'live_camera' | 'file_fallback') {
    setUploading(true);
    try {
      const photoCode  = generatePhotoCode(store.code);
      const capturedAt = nowIso();
      const path       = `stores/${store.id}/reports/${reportId}/${reportResponseId}/${Date.now()}_${fileName}`;
      const file       = new File([blob], fileName, { type: 'image/jpeg' });

      const { data: fileData } = await db.storage.uploadFile(path, file, { contentType: 'image/jpeg' });
      if (!fileData) throw new Error('Upload returned no data');

      const mediaId = id();
      await db.transact(
        db.tx.mediaRecords[mediaId]
          .update({
            reportId,
            reportResponseId,
            storeId:         store.id,
            fileName,
            mimeType:        'image/jpeg',
            lat:             gps?.lat      ?? 0,
            lng:             gps?.lng      ?? 0,
            accuracy:        gps?.accuracy ?? 0,
            capturedAt,
            watermarked:     true,
            photoCode,
            verificationHash: '',
            captureMode:     mode,
            storeDistanceM:  0,
            noteText:        '',
            address:         '',
            uploadedByUserId: profile.userId,
            createdAt:       capturedAt,
          })
          .link({ file: fileData.id, reportResponse: reportResponseId }),
      );

      onCapture({
        mediaRecordId: mediaId,
        fileId:        fileData.id,
        url:           fileData.url ?? '',
        fileName,
        photoCode,
        capturedAt,
      });
    } finally {
      setUploading(false);
    }
  }

  // ── Camera controls ──────────────────────────────────────────────────────

  function handleOpenCamera() {
    if (capturedUrl) { URL.revokeObjectURL(capturedUrl); setCapturedUrl(''); }
    setCapturedBlob(null);
    setCamState('idle');
    setCamError('');
    setCameraOn(true);
  }

  function handleCloseCamera() {
    setCameraOn(false);
    setCamState('idle');
    setCamError('');
  }

  /** Flip between back/front camera — effect cleanup stops old stream */
  function handleSwitchCamera() {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  }

  /** In-place retry without toggling cameraOn */
  function handleRetryCamera() {
    setCamState('idle');
    setCamError('');
    setRetryTick((t) => t + 1);
  }

  async function handleCapture() {
    const video = videoRef.current;
    if (!video || camState !== 'ready') return;
    // Final safety checks before drawing to canvas
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) return;
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    if (!tracks.length || tracks[0].readyState === 'ended') return;

    // Draw from real video dimensions — never from CSS/layout dimensions
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const raw        = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const watermarked = await watermarkBlob(raw);

    // Stop camera before showing preview
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setCamState('idle');

    const url = URL.createObjectURL(watermarked);
    setCapturedBlob(watermarked);
    setCapturedUrl(url);
  }

  async function handleConfirmPhoto() {
    if (!capturedBlob || uploading) return;
    await uploadBlob(capturedBlob, `${store.code}_${Date.now()}.jpg`, 'live_camera');
    URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl('');
  }

  function handleRetake() {
    URL.revokeObjectURL(capturedUrl);
    setCapturedBlob(null);
    setCapturedUrl('');
    setCameraOn(true);
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const watermarked = await watermarkBlob(file);
    await uploadBlob(watermarked, file.name.replace(/\.[^.]+$/, '') + '_timestamped.jpg', 'file_fallback');
    e.target.value = '';
  }

  // ── GPS badge helpers ────────────────────────────────────────────────────
  const gpsStatus = gpsError ? 'error' : !gps ? 'warn' : gps.accuracy > 50 ? 'warn' : 'ok';
  const gpsLabel  = gpsError ? 'GPS ✗' : gps ? `±${Math.round(gps.accuracy)}m` : 'GPS…';

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Hidden file input for fallback upload */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      {/* ── Idle state: open camera or upload ──────────────────────────── */}
      {!cameraOn && !capturedBlob && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={handleOpenCamera} disabled={uploading}>
            {uploading ? 'Uploading…' : '📷  Open Camera / Mở camera'}
          </button>
          <button
            className="secondary"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            📁  Upload photo instead / Tải ảnh lên thay thế
          </button>
        </div>
      )}

      {/* ── Camera full-screen overlay ──────────────────────────────────── */}
      {cameraOn && (
        <div className="camera-fullscreen">

          {/* Top bar */}
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

          {/* Viewfinder — video is always mounted here so videoRef is valid when effect runs */}
          <div className="camera-viewfinder">
            <video ref={videoRef} playsInline muted autoPlay />

            {/* Watermark overlay — only shown when feed is live */}
            {camState === 'ready' && (
              <div className="watermark-preview">
                <div className="wm-store">{watermarkLines[0]}</div>
                <div>{watermarkLines[1]}</div>
                <div>{watermarkLines[2]}</div>
              </div>
            )}

            {/* Loading overlay */}
            {camState === 'opening' && (
              <div className="cam-state-overlay">
                <div className="cam-spinner" />
                <p style={{ color: '#fff', textAlign: 'center', margin: 0, fontSize: 14 }}>
                  Opening camera…<br />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>Đang mở camera…</span>
                </p>
              </div>
            )}

            {/* Error overlay */}
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
                    onClick={() => { handleCloseCamera(); fileRef.current?.click(); }}
                    style={{ fontSize: 13, padding: '10px 20px', borderRadius: 10 }}
                  >
                    📁 Upload instead
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom controls — safe-area-inset-bottom applied via CSS */}
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

            {/* Shutter — large centre button */}
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
              onClick={() => { handleCloseCamera(); fileRef.current?.click(); }}
              aria-label="Upload photo instead"
              title="Upload instead / Tải ảnh lên"
            >
              📁<span>Tải lên</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Post-capture preview ────────────────────────────────────────── */}
      {capturedBlob && (
        <div className="postcapture-sheet">
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>
            Xem lại ảnh / Review Photo
          </div>

          <div className="postcapture-thumb">
            <img src={capturedUrl} alt="Captured photo" />
          </div>

          {gps && (
            <div className="photo-code-box">
              <div className="photo-code-label">GPS</div>
              <div className="photo-code-value" style={{ fontSize: 13, letterSpacing: 0 }}>
                {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}&nbsp;(±{Math.round(gps.accuracy)}m)
              </div>
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

      {/* ── Existing media thumbnails ───────────────────────────────────── */}
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
