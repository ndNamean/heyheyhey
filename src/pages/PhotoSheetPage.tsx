import { useState } from 'react';
import { db } from '../db';
import { canReview } from '../lib/roles';
import type { MediaRecord, Profile } from '../types';

interface Props {
  profile: Profile;
}

export default function PhotoSheetPage({ profile }: Props) {
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

  // Sort newest first
  const sorted = [...photos].sort((a, b) =>
    (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''),
  );

  if (!canReview(profile.role)) {
    return <div className="card">You need at least leader role to view the photo sheet.</div>;
  }

  return (
    <div>
      <div className="card">
        <h1>Photo Sheet</h1>
        <div style={{ marginTop: 8 }}>
          <select value={filterStoreId} onChange={(e) => setFilterStoreId(e.target.value)}>
            <option value="all">All stores</option>
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
              <th>Photo code</th>
              <th>Store</th>
              <th>GPS</th>
              <th>Capture mode</th>
              <th>Captured</th>
              <th>Preview</th>
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
                        : 'No GPS'}
                    </span>
                  </td>
                  <td className="small">{p.captureMode ?? '—'}</td>
                  <td className="small">{p.capturedAt?.slice(0, 16) ?? '—'}</td>
                  <td>
                    {(p as MediaRecord & { file?: { url: string } }).file?.url && (
                      <a
                        href={(p as MediaRecord & { file?: { url: string } }).file!.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={(p as MediaRecord & { file?: { url: string } }).file!.url}
                          alt="proof"
                          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }}
                        />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
            {!sorted.length && (
              <tr>
                <td colSpan={6}>No photos found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
