/**
 * Vercel Serverless — current weather proxy (OpenWeather).
 * Key from OPENWEATHER_API_KEY env only — never exposed to client.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function cacheKey(lat, lon) {
  return `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
}

function parseCoord(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const lat = parseCoord(req.query.lat);
  const lon = parseCoord(req.query.lon);
  if (lat === null || lon === null) {
    return res.status(400).json({ error: 'Missing or invalid lat/lon' });
  }

  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Weather unavailable' });
  }

  const url =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}` +
    `&units=metric&lang=en&appid=${encodeURIComponent(apiKey)}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      console.error('[weather/current] upstream status', upstream.status);
      return res.status(503).json({ error: 'Weather unavailable' });
    }

    const raw = await upstream.json();
    const fetchedAt = new Date().toISOString();
    const data = {
      temperature: raw?.main?.temp ?? 0,
      feelsLike: raw?.main?.feels_like ?? 0,
      humidity: raw?.main?.humidity ?? 0,
      condition: raw?.weather?.[0]?.main ?? '',
      description: raw?.weather?.[0]?.description ?? '',
      windSpeed: raw?.wind?.speed ?? 0,
      city: raw?.name ?? '',
      fetchedAt,
    };

    cache.set(key, { at: Date.now(), data });
    return res.status(200).json(data);
  } catch (e) {
    console.error('[weather/current]', e);
    return res.status(503).json({ error: 'Weather unavailable' });
  }
}
