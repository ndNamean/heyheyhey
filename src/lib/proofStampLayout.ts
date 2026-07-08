import { PROOF_FONT } from './proofFonts';
import type { ProofSnapshot } from './proofWatermarkDraw';

export interface StampLayoutInput {
  frameWidth: number;
  frameHeight: number;
  proof: ProofSnapshot;
  logoImg: HTMLImageElement | null;
  measureCtx: CanvasRenderingContext2D;
}

export type StampSegmentKind = 'user' | 'store' | 'task' | 'timestamp' | 'sep';

export interface StampSegment {
  kind: StampSegmentKind;
  text: string;
}

export interface StampLayoutResult {
  margin: number;
  padding: number;
  zoneGap: number;
  lineHeight: number;
  box: { x: number; y: number; w: number; h: number };
  fonts: { user: number; store: number; task: number; timestamp: number; detail: number };
  logo: { w: number; h: number; show: boolean; gap: number };
  rowH: number;
  inlineRow: { segments: StampSegment[]; height: number; fontScale: number };
  floating: { maxWidth: number; lines: string[]; top: number };
  cssVars: Record<string, string>;
}

const SEPARATOR = ' · ';
const FONT_SCALES = [1.0, 0.92, 0.85, 0.78] as const;

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

type StampFonts = StampLayoutResult['fonts'];

function scaleFonts(base: StampFonts, scale: number): StampFonts {
  return {
    user: Math.round(base.user * scale),
    store: Math.round(base.store * scale),
    task: Math.round(base.task * scale),
    timestamp: Math.round(base.timestamp * scale),
    detail: base.detail,
  };
}

function segmentFontSize(kind: StampSegmentKind, fonts: StampFonts): number {
  switch (kind) {
    case 'user':
      return fonts.user;
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
    case 'user':
      return PROOF_FONT.user;
    case 'store':
      return PROOF_FONT.store;
    case 'task':
      return PROOF_FONT.task;
    case 'timestamp':
    case 'sep':
      return PROOF_FONT.timestamp;
  }
}

function measureSegmentWidth(ctx: CanvasRenderingContext2D, seg: StampSegment, fonts: StampFonts): number {
  const size = segmentFontSize(seg.kind, fonts);
  const font = segmentFontFamily(seg.kind);
  return measureTextW(ctx, seg.text, size, font);
}

function measureSegmentsWidth(ctx: CanvasRenderingContext2D, segments: StampSegment[], fonts: StampFonts): number {
  return segments.reduce((sum, seg) => sum + measureSegmentWidth(ctx, seg, fonts), 0);
}

function buildSegments(parts: Array<{ kind: 'user' | 'store' | 'task' | 'timestamp'; text: string }>): StampSegment[] {
  const segments: StampSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) segments.push({ kind: 'sep', text: SEPARATOR });
    segments.push({ kind: parts[i]!.kind, text: parts[i]!.text });
  }
  return segments;
}

function inlineRowHeight(fonts: StampFonts): number {
  return Math.round(Math.max(fonts.user, fonts.store, fonts.task, fonts.timestamp) * 1.1);
}

function buildPartsFromProof(proof: ProofSnapshot): Array<{ kind: 'user' | 'store' | 'task' | 'timestamp'; text: string }> {
  const parts: Array<{ kind: 'user' | 'store' | 'task' | 'timestamp'; text: string }> = [];
  const user = proof.userName.trim();
  const store = proof.storeCode.trim();
  const task = proof.itemTitle.trim();
  const timestamp = proof.displayTime.trim();
  if (user) parts.push({ kind: 'user', text: user });
  if (store) parts.push({ kind: 'store', text: store });
  if (task) parts.push({ kind: 'task', text: task });
  if (timestamp) parts.push({ kind: 'timestamp', text: timestamp });
  return parts;
}

function fitPartsToWidth(
  ctx: CanvasRenderingContext2D,
  parts: Array<{ kind: 'user' | 'store' | 'task' | 'timestamp'; text: string }>,
  fonts: StampFonts,
  maxWidth: number,
): StampSegment[] {
  let segments = buildSegments(parts);
  if (measureSegmentsWidth(ctx, segments, fonts) <= maxWidth) return segments;

  const taskIdx = parts.findIndex((p) => p.kind === 'task');
  if (taskIdx >= 0) {
    const withoutTask = parts.filter((p) => p.kind !== 'task');
    const reserved = measureSegmentsWidth(ctx, buildSegments(withoutTask), fonts);
    const maxTaskW = Math.max(maxWidth - reserved, 0);
    parts[taskIdx] = {
      kind: 'task',
      text: truncateText(ctx, parts[taskIdx]!.text, maxTaskW, fonts.task, PROOF_FONT.task),
    };
    segments = buildSegments(parts);
    if (measureSegmentsWidth(ctx, segments, fonts) <= maxWidth) return segments;
  }

  const userIdx = parts.findIndex((p) => p.kind === 'user');
  if (userIdx >= 0) {
    const withoutUser = parts.filter((p) => p.kind !== 'user');
    const reserved = measureSegmentsWidth(ctx, buildSegments(withoutUser), fonts);
    const maxUserW = Math.max(maxWidth - reserved, 0);
    parts[userIdx] = {
      kind: 'user',
      text: truncateText(ctx, parts[userIdx]!.text, maxUserW, fonts.user, PROOF_FONT.user),
    };
    segments = buildSegments(parts);
  }

  return segments;
}

function layoutInlineRow(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  textAreaW: number,
  baseFonts: StampFonts,
): { segments: StampSegment[]; height: number; fontScale: number; fonts: StampFonts; width: number } {
  const rawParts = buildPartsFromProof(proof);
  if (rawParts.length === 0) {
    return { segments: [], height: 0, fontScale: 1, fonts: baseFonts, width: 0 };
  }

  for (const scale of FONT_SCALES) {
    const fonts = scale === 1 ? baseFonts : scaleFonts(baseFonts, scale);
    const parts = rawParts.map((p) => ({ ...p }));
    const segments = fitPartsToWidth(ctx, parts, fonts, textAreaW);
    const width = measureSegmentsWidth(ctx, segments, fonts);
    if (width <= textAreaW) {
      return {
        segments,
        height: inlineRowHeight(fonts),
        fontScale: scale,
        fonts,
        width,
      };
    }
  }

  const fonts = scaleFonts(baseFonts, FONT_SCALES[FONT_SCALES.length - 1]!);
  const parts = rawParts.map((p) => ({ ...p }));
  const segments = fitPartsToWidth(ctx, parts, fonts, textAreaW);
  return {
    segments,
    height: inlineRowHeight(fonts),
    fontScale: FONT_SCALES[FONT_SCALES.length - 1]!,
    fonts,
    width: measureSegmentsWidth(ctx, segments, fonts),
  };
}

export function computeStampLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);

  const margin = Math.round(fw * 0.035);
  const padding = Math.round(fw * 0.018);
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.3);
  const logoGap = Math.max(6, Math.round(padding * 0.5));
  const logoMaxW = Math.min(Math.round(fw * 0.1), 56);
  const zoneGap = Math.max(8, Math.round(padding * 0.6));
  const inlineGap = Math.max(4, Math.round(padding * 0.35));

  const baseFonts: StampFonts = {
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

  const minW = Math.round(fw * 0.78);
  const maxW = fw - margin * 2;
  const targetW = maxW;

  let boxW = clamp(targetW, minW, maxW);
  let textAreaW = boxW - padding * 2 - (logoW > 0 ? logoW + logoGap : 0);

  let inline = layoutInlineRow(ctx, proof, Math.max(textAreaW, 0), baseFonts);

  const contentNeedW =
    (logoW > 0 ? logoW + logoGap : 0) + inline.width + padding * 2;
  boxW = clamp(Math.max(contentNeedW, minW), minW, maxW);
  textAreaW = boxW - padding * 2 - (logoW > 0 ? logoW + logoGap : 0);

  inline = layoutInlineRow(ctx, proof, Math.max(textAreaW, 0), baseFonts);

  const fonts = inline.fonts;
  const rowH = Math.max(logoH, inline.height);
  const boxH = padding * 2 + rowH;

  const boxX = margin;
  const boxY = fh - margin - boxH;

  ctx.font = `${baseFonts.detail}px ${PROOF_FONT.detail}`;
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
    zoneGap,
    lineHeight,
    box: { x: boxX, y: boxY, w: boxW, h: boxH },
    fonts,
    logo: { w: logoW, h: logoH, show: showLogo && logoW > 0, gap: logoGap },
    rowH,
    inlineRow: {
      segments: inline.segments,
      height: inline.height,
      fontScale: inline.fontScale,
    },
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
