import { useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { formatMediaCaptureTime } from '../lib/proofTime';
import type { MediaRecord, Profile } from '../types';

interface Props {
  profile: Profile;
}

interface VerifyResult {
  valid: boolean;
  reason: string;
  photoCode?: string;
  capturedAt?: string;
  lat?: number;
  lng?: number;
  captureMode?: string;
  storeCode?: string;
}

export default function VerifyPhotoPage(_props: Props) {
  const { t } = useLang();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);

  const { data } = db.useQuery({ mediaRecords: { file: {} }, stores: {} });

  async function verify() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setLoading(true);
    try {
      const allMedia: MediaRecord[] = (data?.mediaRecords ?? []) as MediaRecord[];
      const match = allMedia.find((m) => m.photoCode === trimmed);

      if (!match) {
        setResult({ valid: false, reason: t.verifyPhoto.notFoundReason });
        return;
      }

      const stores = data?.stores ?? [];
      const store = (stores as { id: string; code: string }[]).find(
        (s) => s.id === match.storeId,
      );

      setResult({
        valid: true,
        reason: t.verifyPhoto.authenticReason,
        photoCode: match.photoCode,
        capturedAt: formatMediaCaptureTime(match),
        lat: match.lat,
        lng: match.lng,
        captureMode: match.captureMode,
        storeCode: store?.code,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h1>{t.verifyPhoto.title}</h1>
        <p className="small">{t.verifyPhoto.subtitle}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="HP-VO-20260630-XXXX"
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && verify()}
          />
          <button onClick={verify} disabled={loading} style={{ flex: '0 0 auto' }}>
            {loading ? t.verifyPhoto.verifying : t.verifyPhoto.verify}
          </button>
        </div>
      </div>

      {result && (
        <div className="card">
          <span className={result.valid ? 'badge good' : 'badge bad'}>
            {result.valid ? t.verifyPhoto.authentic : t.verifyPhoto.notFound}
          </span>
          <p className="small" style={{ marginTop: 8 }}>
            {result.reason}
          </p>
          {result.valid && (
            <div style={{ marginTop: 12 }}>
              {[
                [t.common.photoCode, result.photoCode],
                [t.common.store, result.storeCode],
                [t.verifyPhoto.capturedAt, result.capturedAt],
                [t.verifyPhoto.coordinates, result.lat ? `${result.lat?.toFixed(5)}, ${result.lng?.toFixed(5)}` : t.photoSheet.noGps],
                [t.photoSheet.captureMode, result.captureMode],
              ].map(([label, value]) => (
                <p key={String(label)} className="small">
                  <strong>{label}:</strong> {value ?? '—'}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
