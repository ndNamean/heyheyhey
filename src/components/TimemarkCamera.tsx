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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported');
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) =>
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const watermarkLines = useMemo(
    () => [
      `${store.code} | ${store.name} | ${itemTitle}`,
      `${reportDate} | ${nowText()} | ${gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'GPS pending'}`,
      `Submitted by: ${profile.displayName || profile.email}`,
    ],
    [store, itemTitle, reportDate, gps, profile],
  );

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      fileRef.current?.click();
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  async function watermarkBlob(blob: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    const padding = Math.max(16, Math.floor(canvas.width * 0.025));
    const fontSize = Math.max(22, Math.floor(canvas.width * 0.035));
    const lineHeight = Math.floor(fontSize * 1.35);
    const boxHeight = padding * 2 + lineHeight * watermarkLines.length;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight);
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = 'white';
    watermarkLines.forEach((line, i) => {
      ctx.fillText(line, padding, canvas.height - boxHeight + padding + lineHeight * (i + 0.75));
    });
    return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.85));
  }

  async function uploadBlob(blob: Blob, fileName: string) {
    setUploading(true);
    try {
      const photoCode = generatePhotoCode(store.code);
      const capturedAt = nowIso();
      const path = `stores/${store.id}/reports/${reportId}/${reportResponseId}/${Date.now()}_${fileName}`;

      const file = new File([blob], fileName, { type: 'image/jpeg' });
      const { data: fileData } = await db.storage.uploadFile(path, file, {
        contentType: 'image/jpeg',
      });

      if (!fileData) throw new Error('Upload returned no data');

      const mediaId = id();
      await db.transact(
        db.tx.mediaRecords[mediaId]
          .update({
            reportId,
            reportResponseId,
            storeId: store.id,
            fileName,
            mimeType: 'image/jpeg',
            lat: gps?.lat ?? 0,
            lng: gps?.lng ?? 0,
            accuracy: gps?.accuracy ?? 0,
            capturedAt,
            watermarked: true,
            photoCode,
            verificationHash: '',
            captureMode: cameraOn ? 'live_camera' : 'file_fallback',
            storeDistanceM: 0,
            noteText: '',
            address: '',
            uploadedByUserId: profile.userId,
            createdAt: capturedAt,
          })
          .link({ file: fileData.id, reportResponse: reportResponseId }),
      );

      onCapture({
        mediaRecordId: mediaId,
        fileId: fileData.id,
        url: fileData.url ?? '',
        fileName,
        photoCode,
        capturedAt,
      });
    } finally {
      setUploading(false);
    }
  }

  async function captureFromVideo() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const watermarked = await watermarkBlob(blob);
    await uploadBlob(watermarked, `${store.code}_${Date.now()}.jpg`);
    stopCamera();
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const watermarked = await watermarkBlob(file);
    await uploadBlob(watermarked, file.name.replace(/\.[^.]+$/, '') + '_timestamped.jpg');
    e.target.value = '';
  }

  const gpsClass = gpsError
    ? 'gps-status error'
    : (gps?.accuracy ?? 999) > 50
      ? 'gps-status warn'
      : 'gps-status ok';

  return (
    <div>
      <div className={gpsClass}>
        {gpsError
          ? `GPS: ${gpsError}`
          : gps
            ? `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${Math.round(gps.accuracy)}m)`
            : 'Acquiring GPS...'}
      </div>

      {!cameraOn ? (
        <div>
          <button onClick={startCamera} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Open camera'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
          <button
            className="secondary"
            style={{ marginTop: 8 }}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            Choose / take photo (fallback)
          </button>
        </div>
      ) : (
        <div>
          <div className="camera-wrap">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="watermark-preview">
              {watermarkLines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>
          <div className="capture-actions">
            <button className="secondary" onClick={stopCamera}>
              Cancel
            </button>
            <button onClick={captureFromVideo} disabled={uploading}>
              {uploading ? 'Saving...' : 'Capture'}
            </button>
          </div>
        </div>
      )}

      {existingMedia.length > 0 && (
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
