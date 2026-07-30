/**
 * Shift window parse / overlap (Node mirror of src/lib/storeWifiIp.ts).
 */

export function parseShiftWindow(date, startTime, endTime) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  const startMatch = /^(\d{1,2}):(\d{2})$/.exec(String(startTime ?? '').trim());
  const endMatch = /^(\d{1,2}):(\d{2})$/.exec(String(endTime ?? '').trim());
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

export function shiftOverlapsNow(shift, now = new Date()) {
  const window = parseShiftWindow(shift.date, shift.startTime, shift.endTime);
  if (!window) return false;
  const t = now.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}
