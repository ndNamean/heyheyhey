import { useState } from 'react';
import { db } from '../db';
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
  const [code, setCode] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Pre-load media records for lookup
  const { data } = db.useQuery({ mediaRecords: { file: {} }, stores: {} });

  async function verify() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setLoading(true);
    try {
      const allMedia: MediaRecord[] = (data?.mediaRecords ?? []) as MediaRecord[];
      const match = allMedia.find((m) => m.photoCode === trimmed);

      if (!match) {
        setResult({ valid: false, reason: 'Photo code not found in the database.' });
        return;
      }

      const stores = data?.stores ?? [];
      const store = (stores as { id: string; code: string }[]).find(
        (s) => s.id === match.storeId,
      );

      setResult({
        valid: true,
        reason: 'Photo is authentic and on record.',
        photoCode: match.photoCode,
        capturedAt: match.capturedAt,
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
        <h1>Photo Verification</h1>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="HP-VO-20260630-XXXX"
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && verify()}
          />
          <button onClick={verify} disabled={loading} style={{ flex: '0 0 auto' }}>
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      </div>

      {result && (
        <div className="card">
          <span className={result.valid ? 'badge good' : 'badge bad'}>
            {result.valid ? 'Authentic' : 'Not found'}
          </span>
          <p className="small" style={{ marginTop: 8 }}>
            {result.reason}
          </p>
          {result.valid && (
            <div style={{ marginTop: 12 }}>
              {[
                ['Photo code', result.photoCode],
                ['Store', result.storeCode],
                ['Captured at', result.capturedAt?.slice(0, 16)],
                ['Coordinates', result.lat ? `${result.lat?.toFixed(5)}, ${result.lng?.toFixed(5)}` : 'No GPS'],
                ['Capture mode', result.captureMode],
              ].map(([label, value]) => (
                <p key={label} className="small">
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
