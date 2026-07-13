export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export async function searchNominatim(
  query: string,
  signal?: AbortSignal,
): Promise<NominatimResult[]> {
  const q = query.trim();
  if (!q) return [];

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`,
      { headers: { 'Accept-Language': 'en-US,en' }, signal },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}
