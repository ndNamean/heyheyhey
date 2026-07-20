/** Frame-fit helpers for non-Timecard watermark modes. Timecard must not import this. */

export const MAX_STAMP_HEIGHT_RATIO = 0.38;
export const MAX_ADDRESS_LINES = 3;
export const MAX_WEATHER_LINES = 2;

export type DetailLineKind = 'address' | 'weather';

export interface TaggedDetailLine {
  kind: DetailLineKind;
  text: string;
}

export function stampHeightBudget(frameHeight: number, margin: number): number {
  const fh = Math.max(frameHeight, 0);
  const m = Math.max(margin, 0);
  return Math.max(0, Math.min(fh * MAX_STAMP_HEIGHT_RATIO, Math.max(0, fh - m * 2)));
}

export function detailBlockHeight(lineCount: number, lineHeight: number): number {
  if (lineCount <= 0) return 0;
  return lineCount * lineHeight;
}

export function compositionHeight(
  primaryHeight: number,
  detailLineCount: number,
  lineHeight: number,
  zoneGap: number,
): number {
  const detailH = detailBlockHeight(detailLineCount, lineHeight);
  if (detailH <= 0) return primaryHeight;
  return primaryHeight + zoneGap + detailH;
}

/** Cap address/weather line counts (weather dropped first when over height). */
export function fitTaggedDetailLines(
  lines: TaggedDetailLine[],
  lineHeight: number,
  zoneGap: number,
  primaryHeight: number,
  maxCompositionHeight: number,
): TaggedDetailLine[] {
  let next = lines.slice();
  while (
    next.length > 0 &&
    compositionHeight(primaryHeight, next.length, lineHeight, zoneGap) > maxCompositionHeight
  ) {
    const weatherIdx = findLastIndex(next, (l) => l.kind === 'weather');
    if (weatherIdx >= 0) {
      next.splice(weatherIdx, 1);
      continue;
    }
    next.pop();
  }
  return next;
}

export function taggedTexts(lines: TaggedDetailLine[]): string[] {
  return lines.map((l) => l.text);
}

export function buildTaggedDetailLines(
  addressLines: string[],
  weatherLines: string[],
  maxAddress: number = MAX_ADDRESS_LINES,
  maxWeather: number = MAX_WEATHER_LINES,
): TaggedDetailLine[] {
  const out: TaggedDetailLine[] = [];
  for (const text of addressLines.slice(0, Math.max(0, maxAddress))) {
    out.push({ kind: 'address', text });
  }
  for (const text of weatherLines.slice(0, Math.max(0, maxWeather))) {
    out.push({ kind: 'weather', text });
  }
  return out;
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) return i;
  }
  return -1;
}
