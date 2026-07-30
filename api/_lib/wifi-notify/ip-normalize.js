/**
 * Public IP normalize / validate (Node mirror of src/lib/storeWifiIp.ts).
 */

export function normalizePublicIp(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function parseIpv4Octets(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isPrivateOrReservedIpv4(octets) {
  const [a, b] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function parseIpv6Hextets(ip) {
  if (ip.includes('.')) return null;
  if ((ip.match(/::/g) ?? []).length > 1) return null;

  let head;
  let tail;
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    head = left === '' ? [] : left.split(':');
    tail = right === '' ? [] : right.split(':');
  } else {
    head = ip.split(':');
    tail = [];
  }

  if (head.some((h) => h === '') || tail.some((t) => t === '')) return null;
  const missing = 8 - (head.length + tail.length);
  if (ip.includes('::')) {
    if (missing < 1) return null;
  } else if (head.length !== 8) {
    return null;
  }

  const zeros = ip.includes('::') ? Array(Math.max(missing, 0)).fill('0') : [];
  const parts = [...head, ...zeros, ...tail];
  if (parts.length !== 8) return null;

  const hextets = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    hextets.push(parseInt(part, 16));
  }
  return hextets;
}

function isPrivateOrReservedIpv6(hextets) {
  if (hextets.every((h) => h === 0)) return true;
  if (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0 &&
    hextets[6] === 0 &&
    hextets[7] === 1
  ) {
    return true;
  }
  if ((hextets[0] & 0xfe00) === 0xfc00) return true;
  if ((hextets[0] & 0xffc0) === 0xfe80) return true;
  return false;
}

export function isValidExactPublicIp(ip) {
  const normalized = normalizePublicIp(ip);
  if (!normalized) return false;
  if (normalized.includes('/') || normalized.includes('*')) return false;
  if (/\s/.test(normalized)) return false;

  if (normalized.includes(':')) {
    const hextets = parseIpv6Hextets(normalized);
    if (!hextets) return false;
    return !isPrivateOrReservedIpv6(hextets);
  }

  const octets = parseIpv4Octets(normalized);
  if (!octets) return false;
  return !isPrivateOrReservedIpv4(octets);
}

export function findDuplicateActiveIpAssignment(ip, wifiIps, excludeId) {
  const normalized = normalizePublicIp(ip);
  if (!normalized) return null;

  for (const row of wifiIps) {
    if (!row.active) continue;
    if (excludeId && row.id === excludeId) continue;
    if (normalizePublicIp(row.publicIp) === normalized) {
      return row;
    }
  }
  return null;
}
