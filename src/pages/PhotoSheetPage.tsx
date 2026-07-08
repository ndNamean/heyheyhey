import { useState } from 'react';
import { db } from '../db';
import { useLang } from '../i18n';
import { canReview } from '../lib/roles';
import ProofPhoto from '../components/ProofPhoto';
import type { MediaRecord, Profile } from '../types';

interface Props {
  profile: Profile;
}

export default function PhotoSheetPage({ profile }: Props) {
  const { t } = useLang();
  const [filterStoreId, setFilterStoreId] = useState('all');

  const { data } = db.useQuery({
    mediaRecords: {
      file: {},
    },
    stores: {},
  });

  const allPhotos: MediaRecord[] = (data?.mediaRecords ?? []) as MediaRecord[];
  const stores = data?.stores ?? [];

  const photos = filterStoreId === 'all'
    ? allPhotos
    : allPhotos.filter((p) => p.storeId === filterStoreId);

  const sorted = [...photos].sort((a, b) =>
    (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''),
  );

  if (!canReview(profile.role)) {
    return <div className="card">{t.photoSheet.noPermission}</div>;
  }

  return (
    <div>
      <div className="card">
        <h1>{t.photoSheet.title}</h1>
        <p className="small">{t.photoSheet.subtitle}</p>
        <div style={{ marginTop: 8 }}>
          <select value={filterStoreId} onChange={(e) => setFilterStoreId(e.target.value)}>
            <option value="all">{t.common.allStores}</option>
            {(stores as { id: string; code: string; name: string }[]).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t.common.photoCode}</th>
              <th>{t.common.store}</th>
              <th>{t.photoSheet.gps}</th>
              <th>{t.photoSheet.captureMode}</th>
              <th>{t.photoSheet.captured}</th>
              <th>{t.photoSheet.preview}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const store = (stores as { id: string; code: string }[]).find(
                (s) => s.id === p.storeId,
              );
              return (
                <tr key={p.id}>
                  <td>
                    <span className="photo-code-value" style={{ fontSize: 12 }}>
                      {p.photoCode || '—'}
                    </span>
                  </td>
                  <td>{store?.code ?? '—'}</td>
                  <td>
                    <span className={p.lat ? 'badge good' : 'badge warn'}>
                      {p.lat
                        ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`
                        : t.photoSheet.noGps}
                    </span>
                  </td>
                  <td className="small">{p.captureMode ?? '—'}</td>
                  <td className="small">{p.capturedAt?.slice(0, 16) ?? '—'}</td>
                  <td>
                    <ProofPhoto
                      media={p}
                      className="proof-photo-sheet-thumb"
                      reviewContext={{
                        storeCode: store?.code,
                        watermarked: p.watermarked,
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            {!sorted.length && (
              <tr>
                <td colSpan={6}>{t.photoSheet.noPhotos}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
