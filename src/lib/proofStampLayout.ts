import { PROOF_FONT } from './proofFonts';
import type { ProofSnapshot } from './proofWatermarkDraw';

export interface StampLayoutInput {
  frameWidth: number;
  frameHeight: number;
  proof: ProofSnapshot;
  logoImg: HTMLImageElement | null;
  measureCtx: CanvasRenderingContext2D;
}

export type StampSegmentKind = 'store' | 'task' | 'timestamp' | 'sep';

export interface StampSegment {
  kind: StampSegmentKind;
  text: string;
}

export interface StampLayoutResult {
  margin: number;
  padding: number;
  rowGap: number;
  zoneGap: number;
  lineHeight: number;
  box: { x: number; y: number; w: number; h: number };
  fonts: { user: number; store: number; task: number; timestamp: number; detail: number };
  logo: { w: number; h: number; show: boolean; gap: number };
  row1H: number;
  row2H: number;
  row3H: number;
  row1: { userLines: string[] };
  row2: { segments: StampSegment[]; height: number };
  row3: { timestampLine: string | null; height: number };
  timestampOnRow3: boolean;
  floating: { maxWidth: number; lines: string[]; top: number };
  cssVars: Record<string, string>;
}

const SEPARATOR = ' · ';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const trimmed = text.trim();
  if (!trimmed || maxWidth <= 0) return trimmed ? [trimmed] : [];

  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = '';
    for (const ch of word) {
      const next = chunk + ch;
      if (ctx.measureText(next).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines;
}

function capWrappedLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const capped = lines.slice(0, maxLines);
  const last = capped[maxLines - 1] ?? '';
  capped[maxLines - 1] = last.length > 1 ? `${last.slice(0, Math.max(0, last.length - 1))}…` : '…';
  return capped;
}

function measureTextW(ctx: CanvasRenderingContext2D, text: string, size: number, font: string): number {
  ctx.font = `${size}px ${font}`;
  return ctx.measureText(text).width;
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  font: string,
): string {
  if (!text || maxWidth <= 0) return text;
  if (measureTextW(ctx, text, size, font) <= maxWidth) return text;
  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (measureTextW(ctx, candidate, size, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis;
}

function segmentFontSize(kind: StampSegmentKind, fonts: StampLayoutResult['fonts']): number {
  switch (kind) {
    case 'store':
      return fonts.store;
    case 'task':
      return fonts.task;
    case 'timestamp':
      return fonts.timestamp;
    case 'sep':
      return fonts.timestamp;
  }
}

function segmentFontFamily(kind: StampSegmentKind): string {
  switch (kind) {
    case 'store':
      return PROOF_FONT.store;
    case 'task':
      return PROOF_FONT.task;
    case 'timestamp':
    case 'sep':
      return PROOF_FONT.timestamp;
  }
}

function measureSegmentWidth(
  ctx: CanvasRenderingContext2D,
  seg: StampSegment,
  fonts: StampLayoutResult['fonts'],
): number {
  const size = segmentFontSize(seg.kind, fonts);
  const font = segmentFontFamily(seg.kind);
  return measureTextW(ctx, seg.text, size, font);
}

function measureSegmentsWidth(
  ctx: CanvasRenderingContext2D,
  segments: StampSegment[],
  fonts: StampLayoutResult['fonts'],
): number {
  return segments.reduce((sum, seg) => sum + measureSegmentWidth(ctx, seg, fonts), 0);
}

function buildSegments(parts: Array<{ kind: 'store' | 'task' | 'timestamp'; text: string }>): StampSegment[] {
  const segments: StampSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) segments.push({ kind: 'sep', text: SEPARATOR });
    segments.push({ kind: parts[i]!.kind, text: parts[i]!.text });
  }
  return segments;
}

function detailRowHeight(fonts: StampLayoutResult['fonts']): number {
  return Math.round(Math.max(fonts.store, fonts.task, fonts.timestamp) * 1.15);
}

function layoutRow1User(
  ctx: CanvasRenderingContext2D,
  userText: string,
  innerW: number,
  logoW: number,
  logoGap: number,
  userSize: number,
): { userLines: string[]; height: number; width: number } {
  const trimmed = userText.trim();
  if (!trimmed) return { userLines: [], height: 0, width: 0 };

  const userMaxW = innerW - (logoW > 0 ? logoW + logoGap : 0);
  const truncated = truncateText(ctx, trimmed, Math.max(userMaxW, 0), userSize, PROOF_FONT.user);
  const width = measureTextW(ctx, truncated, userSize, PROOF_FONT.user);
  return {
    userLines: [truncated],
    height: Math.round(userSize * 1.15),
    width: (logoW > 0 ? logoW + logoGap : 0) + width,
  };
}

function layoutDetailRow(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  innerW: number,
  fonts: StampLayoutResult['fonts'],
): {
  segments: StampSegment[];
  height: number;
  timestampOnRow3: boolean;
  row3Timestamp: string | null;
  width: number;
} {
  const store = proof.storeCode.trim();
  const task = proof.itemTitle.trim();
  const timestamp = proof.displayTime.trim();

  const allParts: Array<{ kind: 'store' | 'task' | 'timestamp'; text: string }> = [];
  if (store) allParts.push({ kind: 'store', text: store });
  if (task) allParts.push({ kind: 'task', text: task });
  if (timestamp) allParts.push({ kind: 'timestamp', text: timestamp });

  if (allParts.length === 0) {
    return { segments: [], height: 0, timestampOnRow3: false, row3Timestamp: null, width: 0 };
  }

  let segments = buildSegments(allParts);
  let width = measureSegmentsWidth(ctx, segments, fonts);

  if (width <= innerW) {
    return {
      segments,
      height: detailRowHeight(fonts),
      timestampOnRow3: false,
      row3Timestamp: null,
      width,
    };
  }

  const partsNoTs = allParts.filter((p) => p.kind !== 'timestamp');
  const row3Timestamp = timestamp || null;
  const timestampOnRow3 = !!timestamp;

  if (partsNoTs.length === 0) {
    segments = [{ kind: 'timestamp', text: timestamp }];
    width = measureSegmentsWidth(ctx, segments, fonts);
    return {
      segments,
      height: detailRowHeight(fonts),
      timestampOnRow3: false,
      row3Timestamp: null,
      width,
    };
  }

  segments = buildSegments(partsNoTs);
  width = measureSegmentsWidth(ctx, segments, fonts);

  if (width <= innerW) {
    return {
      segments,
      height: detailRowHeight(fonts),
      timestampOnRow3,
      row3Timestamp,
      width,
    };
  }

  const taskIdx = partsNoTs.findIndex((p) => p.kind === 'task');
  if (taskIdx >= 0) {
    const storePart = partsNoTs.find((p) => p.kind === 'store');
    let reserved = 0;
    if (storePart) {
      reserved += measureTextW(ctx, storePart.text, fonts.store, PROOF_FONT.store);
      reserved += measureTextW(ctx, SEPARATOR, fonts.timestamp, PROOF_FONT.timestamp);
    }
    const maxTaskW = Math.max(innerW - reserved, 0);
    partsNoTs[taskIdx] = {
      kind: 'task',
      text: truncateText(ctx, partsNoTs[taskIdx]!.text, maxTaskW, fonts.task, PROOF_FONT.task),
    };
    segments = buildSegments(partsNoTs);
    width = measureSegmentsWidth(ctx, segments, fonts);
  }

  return {
    segments,
    height: detailRowHeight(fonts),
    timestampOnRow3,
    row3Timestamp,
    width,
  };
}

export function computeStampLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);

  const margin = Math.round(fw * 0.035);
  const padding = Math.round(fw * 0.022);
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.3);
  const logoGap = Math.max(8, Math.round(padding * 0.5));
  const logoMaxW = Math.min(Math.round(fw * 0.14), 70);
  const rowGap = Math.max(2, Math.round(padding * 0.25));
  const zoneGap = Math.max(8, Math.round(padding * 0.6));
  const inlineGap = Math.max(4, Math.round(padding * 0.35));

  const fonts = {
    user: Math.round(baseFontSize * 1.22),
    store: Math.round(baseFontSize * 1.08),
    task: baseFontSize,
    timestamp: Math.round(baseFontSize * 0.95),
    detail: baseFontSize,
  };

  const showLogo =
    proof.cameraOptionsSnapshot.logoEnabled &&
    proof.proofLogoUrl.trim().length > 0;

  let logoW = 0;
  let logoH = 0;
  if (showLogo) {
    if (logoImg) {
      const scale = logoMaxW / logoImg.width;
      logoW = logoMaxW;
      logoH = logoImg.height * scale;
    } else {
      logoW = logoMaxW;
      logoH = Math.round(logoMaxW * 0.55);
    }
  }

  const targetW = Math.round(fw * 0.72);
  const minW = Math.round(fw * 0.58);
  const maxW = Math.round(fw * 0.86);

  let boxW = clamp(targetW, minW, maxW);
  let innerW = boxW - padding * 2;

  let row1 = layoutRow1User(ctx, proof.userName, innerW, logoW, logoGap, fonts.user);
  let detail = layoutDetailRow(ctx, proof, innerW, fonts);

  const row3TsW = detail.row3Timestamp
    ? measureTextW(ctx, detail.row3Timestamp, fonts.timestamp, PROOF_FONT.timestamp)
    : 0;

  const contentNeedW = Math.max(row1.width, detail.width, row3TsW, targetW - padding * 2);
  boxW = clamp(Math.max(contentNeedW + padding * 2, minW), minW, maxW);
  innerW = boxW - padding * 2;

  row1 = layoutRow1User(ctx, proof.userName, innerW, logoW, logoGap, fonts.user);
  detail = layoutDetailRow(ctx, proof, innerW, fonts);

  const row1H = Math.max(logoH, row1.height);
  const row2H = detail.height;
  const row3H = detail.timestampOnRow3 && detail.row3Timestamp
    ? Math.round(fonts.timestamp * 1.15)
    : 0;

  let boxH = padding * 2;
  if (row1H > 0 || row1.userLines.length > 0 || logoW > 0) boxH += row1H;
  if (row2H > 0) boxH += rowGap + row2H;
  if (row3H > 0) boxH += rowGap + row3H;

  const boxX = margin;
  const boxY = fh - margin - boxH;

  ctx.font = `${fonts.detail}px ${PROOF_FONT.detail}`;
  const floatMaxWidth = fw - margin * 2;
  const floatingLines: string[] = [];
  if (proof.locationLine.trim()) {
    floatingLines.push(...capWrappedLines(wrapText(ctx, proof.locationLine, floatMaxWidth), 4));
  }
  if (proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine.trim()) {
    floatingLines.push(...wrapText(ctx, proof.weatherLine, floatMaxWidth));
  }
  const floatBlockH = floatingLines.length * lineHeight;
  let floatTop = boxY - zoneGap - floatBlockH;
  if (floatTop < margin) floatTop = margin;

  const cssVars: Record<string, string> = {
    '--stamp-box-w': `${boxW}px`,
    '--stamp-box-min-w': `${minW}px`,
    '--stamp-pad-v': `${padding}px`,
    '--stamp-pad-h': `${padding}px`,
    '--stamp-row-gap': `${rowGap}px`,
    '--stamp-inline-gap': `${inlineGap}px`,
    '--font-user': `${fonts.user}px`,
    '--font-store': `${fonts.store}px`,
    '--font-task': `${fonts.task}px`,
    '--font-ts': `${fonts.timestamp}px`,
    '--font-detail': `${fonts.detail}px`,
    '--logo-max-w': `${logoW}px`,
    '--logo-max-h': `${logoH}px`,
    '--stamp-line-height': `${lineHeight}px`,
  };

  return {
    margin,
    padding,
    rowGap,
    zoneGap,
    lineHeight,
    box: { x: boxX, y: boxY, w: boxW, h: boxH },
    fonts,
    logo: { w: logoW, h: logoH, show: showLogo && logoW > 0, gap: logoGap },
    row1H,
    row2H,
    row3H,
    row1: { userLines: row1.userLines },
    row2: { segments: detail.segments, height: detail.height },
    row3: {
      timestampLine: detail.timestampOnRow3 ? detail.row3Timestamp : null,
      height: row3H,
    },
    timestampOnRow3: detail.timestampOnRow3,
    floating: { maxWidth: floatMaxWidth, lines: floatingLines, top: floatTop },
    cssVars,
  };
}

export function createMeasureContext(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.getContext('2d')!;
}
