/** Store Wi-Fi public IP normalize/validate + shift overlap helpers. */

export interface WifiIpRowLike {
  id: string;
  storeId: string;
  publicIp: string;
  active: boolean;
}

export interface ShiftWindowLike {
  date: string;
  startTime: string;
  endTime: string;
}

export interface ParsedShiftWindow {
  start: Date;
  end: Date;
}

/**
 * Trim whitespace and lowercase (IPv6). Returns null for empty input.
 * Does not expand compressed IPv6 forms — callers should store the normalized string.
 */
export function normalizePublicIp(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function parseIpv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // Reject leading zeros like 01 except plain "0"
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isPrivateOrReservedIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  // 0.0.0.0/8 — "this" network
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  return false;
}

/** Expand a single IPv6 address to 8 hextets (lowercase, no leading zeros stripped beyond normalize). */
function parseIpv6Hextets(ip: string): number[] | null {
  if (ip.includes('.')) {
    // IPv4-mapped / embedded — reject for exact public matching simplicity
    return null;
  }
  if ((ip.match(/::/g) ?? []).length > 1) return null;

  let head: string[];
  let tail: string[];
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
    // :: must compress at least one hextet
    if (missing < 1) return null;
  } else if (head.length !== 8) {
    return null;
  }

  const zeros = ip.includes('::') ? Array(Math.max(missing, 0)).fill('0') : [];
  const parts = [...head, ...zeros, ...tail];
  if (parts.length !== 8) return null;

  const hextets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    hextets.push(parseInt(part, 16));
  }
  return hextets;
}

function isPrivateOrReservedIpv6(hextets: number[]): boolean {
  // :: (unspecified)
  if (hextets.every((h) => h === 0)) return true;
  // ::1 loopback
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
  // fc00::/7 unique local
  if ((hextets[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local
  if ((hextets[0] & 0xffc0) === 0xfe80) return true;
  return false;
}

/**
 * Exact IPv4/IPv6 only. Rejects CIDR, wildcards, private/loopback/link-local.
 */
export function isValidExactPublicIp(ip: string | null | undefined): boolean {
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

/**
 * Find another active Wi-Fi IP row with the same normalized public IP.
 * Used to enforce cross-store (and same-list) uniqueness among active assignments.
 */
export function findDuplicateActiveIpAssignment(
  ip: string,
  wifiIps: WifiIpRowLike[],
  excludeId?: string,
): WifiIpRowLike | null {
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

/**
 * Interpret shift date + HH:mm as a local calendar window.
 * If endTime <= startTime, the end is treated as the next calendar day (overnight).
 */
export function parseShiftWindow(
  date: string,
  startTime: string,
  endTime: string,
): ParsedShiftWindow | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const startMatch = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  const endMatch = /^(\d{1,2}):(\d{2})$/.exec(endTime.trim());
  if (!dateMatch || !startMatch || !endMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const startH = Number(startMatch[1]);
  const startM = Number(startMatch[2]);
  const endH = Number(endMatch[1]);
  const endM = Number(endMatch[2]);

  if (
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > 31 ||
    startH > 23 ||
    startM > 59 ||
    endH > 23 ||
    endM > 59
  ) {
    return null;
  }

  const start = new Date(year, month, day, startH, startM, 0, 0);
  if (
    start.getFullYear() !== year ||
    start.getMonth() !== month ||
    start.getDate() !== day
  ) {
    return null;
  }

  let end = new Date(year, month, day, endH, endM, 0, 0);
  if (end.getTime() <= start.getTime()) {
    end = new Date(year, month, day + 1, endH, endM, 0, 0);
  }

  return { start, end };
}

/** True when `now` is in [start, end). */
export function shiftOverlapsNow(
  shift: ShiftWindowLike,
  now: Date = new Date(),
): boolean {
  const window = parseShiftWindow(shift.date, shift.startTime, shift.endTime);
  if (!window) return false;
  const t = now.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}
