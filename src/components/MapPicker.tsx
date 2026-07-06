import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import { Icon } from 'leaflet';
import 'leaflet/dist/leaflet.css';

const PIN = new Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

function ClickHandler({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prevRef = useRef({ lat: 0, lng: 0 });

  useEffect(() => {
    if (!lat || !lng) return;
    if (prevRef.current.lat === lat && prevRef.current.lng === lng) return;
    prevRef.current = { lat, lng };
    map.flyTo([lat, lng], 16, { duration: 1.2 });
  }, [lat, lng, map]);

  return null;
}

interface Props {
  lat: number;
  lng: number;
  onSelect: (lat: number, lng: number, address: string) => void;
}

export default function MapPicker({ lat, lng, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null);

  const hasPin = Boolean(lat || lng);
  const centre: [number, number] = hasPin ? [lat, lng] : [10.7769, 106.7009];

  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`,
        { headers: { 'Accept-Language': 'en-US,en' } },
      );
      setResults(await res.json());
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pickResult(r: NominatimResult) {
    const newLat = parseFloat(r.lat);
    const newLng = parseFloat(r.lon);
    setFlyTo({ lat: newLat, lng: newLng });
    setResults([]);
    setQuery(r.display_name.split(',')[0].trim());
    onSelect(newLat, newLng, r.display_name);
  }

  function handleMapClick(clickLat: number, clickLng: number) {
    setFlyTo(null);
    onSelect(clickLat, clickLng, '');
  }

  return (
    <div>
      <div className="map-search-wrap">
        <div className="map-search-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); search(); }
            }}
            placeholder="Search address, landmark, or place name…"
            style={{ flex: 1 }}
          />
          <button
            className="secondary"
            style={{ flex: '0 0 auto', minWidth: 88, fontSize: 13 }}
            onClick={search}
            disabled={searching || !query.trim()}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {results.length > 0 && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 399 }}
              onClick={() => setResults([])}
            />
            <div className="map-search-dropdown">
              {results.map((r) => (
                <button
                  key={r.place_id}
                  className="map-search-item"
                  onClick={() => pickResult(r)}
                >
                  {r.display_name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="map-frame">
        <MapContainer
          center={centre}
          zoom={hasPin ? 16 : 12}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onSelect={handleMapClick} />
          {flyTo && <FlyTo lat={flyTo.lat} lng={flyTo.lng} />}
          {hasPin && <Marker position={[lat, lng]} icon={PIN} />}
        </MapContainer>
      </div>

      <p className="small" style={{ marginTop: 8 }}>
        Search for a location above, or click anywhere on the map to drop the pin.
        Latitude &amp; Longitude fill in automatically.
      </p>
    </div>
  );
}
