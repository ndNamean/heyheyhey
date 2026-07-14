import { PROOF_FONT, configureMeasureFonts } from './proofFonts';
import { resolveWatermarkStyle } from './cameraSettings';
import { resolveGradientCss } from './watermarkGradients';
import {
  deriveFloatingItems,
  resolveEffectiveBoxItems,
  resolveUltimateConfig,
} from './ultimateWatermarkConfig';
import {
  resolveEffectiveTimecardItems,
  resolveTimecardConfig,
} from './timecardWatermarkConfig';
import { formatTimecardClockParts } from './proofTime';
import type {
  TimecardBackgroundMode,
  UltimateBoxItems,
  UltimateGradientPreset,
  UltimateLayoutMode,
} from '../types';
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

export interface TimecardLayoutData {
  backgroundMode: TimecardBackgroundMode;
  gradientPreset: UltimateGradientPreset;
  gradientCss: string;
  frostedGlassEnabled: boolean;
  logoOutside: boolean;
  logo: { x: number; y: number; w: number; h: number; show: boolean };
  card: { x: number; y: number; w: number; h: number; radius: number };
  timeText: string;
  dateText: string;
  dayText: string;
  showTime: boolean;
  showDate: boolean;
  showDay: boolean;
  showAccent: boolean;
  metaLines: string[];
  detailLines: string[];
  photoCodeLine: string;
  fonts: {
    time: number;
    date: number;
    day: number;
    meta: number;
    detail: number;
    photoCode: number;
  };
  primaryRowH: number;
  accentGap: number;
  sectionGap: number;
}

export interface StampLayoutResult {
  margin: number;
  paddingV: number;
  paddingH: number;
  zoneGap: number;
  lineHeight: number;
  box: { x: number; y: number; w: number; h: number };
  fonts: { user: number; store: number; task: number; timestamp: number; detail: number };
  logo: { w: number; h: number; show: boolean; gap: number };
  rowH: number;
  inlineRow: { segments: StampSegment[]; height: number; fontScale: number };
  floating: { maxWidth: number; lines: string[]; top: number };
  logoDock: {
    logoBox: { x: number; y: number; w: number; h: number };
    textColumn: { x: number; y: number; w: number; h: number };
    detailLines: string[];
    dockH: number;
    detailGap: number;
  } | null;
  ultimate: {
    layoutMode: UltimateLayoutMode;
    gradientEnabled: boolean;
    gradientPreset: UltimateGradientPreset;
    gradientCss: string;
    boxEnabled: boolean;
    box: { x: number; y: number; w: number; h: number };
    logoBox: { x: number; y: number; w: number; h: number } | null;
    textColumn: { x: number; y: number; w: number; h: number } | null;
    boxInline: StampSegment[];
    boxDetailLines: string[];
    floatInline: StampSegment[];
    floatDetailLines: string[];
    boxHasLogo: boolean;
    floatTop: number;
    detailGap: number;
  } | null;
  timecard: TimecardLayoutData | null;
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
  return buildInlineParts(proof, {
    logo: true,
    userName: true,
    storeCode: true,
    taskItem: true,
    timestamp: true,
    address: false,
    weather: false,
  });
}

function buildInlineParts(
  proof: ProofSnapshot,
  items: Pick<UltimateBoxItems, 'userName' | 'storeCode' | 'taskItem' | 'timestamp'>,
): Array<{ kind: 'user' | 'store' | 'task' | 'timestamp'; text: string }> {
  const parts: Array<{ kind: 'user' | 'store' | 'task' | 'timestamp'; text: string }> = [];
  const user = proof.userName.trim();
  const store = proof.storeCode.trim();
  const task = proof.itemTitle.trim();
  const timestamp = proof.displayTime.trim();
  if (items.userName && user) parts.push({ kind: 'user', text: user });
  if (items.storeCode && store) parts.push({ kind: 'store', text: store });
  if (items.taskItem && task) parts.push({ kind: 'task', text: task });
  if (items.timestamp && timestamp) parts.push({ kind: 'timestamp', text: timestamp });
  return parts;
}

function buildDetailLinesForItems(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  items: Pick<UltimateBoxItems, 'address' | 'weather'>,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  if (items.address && proof.locationLine.trim()) {
    lines.push(...capWrappedLines(wrapText(ctx, proof.locationLine, maxWidth), 4));
  }
  if (items.weather && proof.weatherLine.trim()) {
    lines.push(...wrapText(ctx, proof.weatherLine, maxWidth));
  }
  return lines;
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

function layoutInlineRowFromParts(
  ctx: CanvasRenderingContext2D,
  parts: Array<{ kind: 'user' | 'store' | 'task' | 'timestamp'; text: string }>,
  textAreaW: number,
  baseFonts: StampFonts,
): { segments: StampSegment[]; height: number; fontScale: number; fonts: StampFonts; width: number } {
  if (parts.length === 0) {
    return { segments: [], height: 0, fontScale: 1, fonts: baseFonts, width: 0 };
  }

  for (const scale of FONT_SCALES) {
    const fonts = scale === 1 ? baseFonts : scaleFonts(baseFonts, scale);
    const scaledParts = parts.map((p) => ({ ...p }));
    const segments = fitPartsToWidth(ctx, scaledParts, fonts, textAreaW);
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
  const scaledParts = parts.map((p) => ({ ...p }));
  const segments = fitPartsToWidth(ctx, scaledParts, fonts, textAreaW);
  return {
    segments,
    height: inlineRowHeight(fonts),
    fontScale: FONT_SCALES[FONT_SCALES.length - 1]!,
    fonts,
    width: measureSegmentsWidth(ctx, segments, fonts),
  };
}

function layoutInlineRow(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  textAreaW: number,
  baseFonts: StampFonts,
): { segments: StampSegment[]; height: number; fontScale: number; fonts: StampFonts; width: number } {
  return layoutInlineRowFromParts(ctx, buildPartsFromProof(proof), textAreaW, baseFonts);
}

export function computeStampLayout(input: StampLayoutInput): StampLayoutResult {
  configureMeasureFonts(input.measureCtx, input.frameWidth);
  const style = resolveWatermarkStyle(input.proof.cameraOptionsSnapshot);
  if (style === 'logoDock') {
    return computeLogoDockLayout(input);
  }
  if (style === 'blackBoxInline') {
    return computeProofStripLayout(input);
  }
  if (style === 'ultimate_custom') {
    return computeUltimateLayout(input);
  }
  if (style === 'timecard_stamp') {
    return computeTimecardLayout(input);
  }
  return computeStandardStampLayout(input);
}

function computeLogoDimensions(
  showLogo: boolean,
  logoImg: HTMLImageElement | null,
  logoMaxW: number,
): { logoW: number; logoH: number } {
  if (!showLogo) return { logoW: 0, logoH: 0 };
  if (logoImg) {
    const scale = logoMaxW / logoImg.width;
    return { logoW: logoMaxW, logoH: logoImg.height * scale };
  }
  return { logoW: logoMaxW, logoH: Math.round(logoMaxW * 0.55) };
}

function computeUltimateLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);
  const opts = proof.cameraOptionsSnapshot;
  const config = resolveUltimateConfig(opts);
  const boxItems = config.boxEnabled
    ? resolveEffectiveBoxItems(config, opts)
    : { logo: false, userName: false, storeCode: false, taskItem: false, timestamp: false, address: false, weather: false };
  const floatItems = deriveFloatingItems(boxItems);

  const margin = Math.round(fw * 0.035);
  const basePadding = Math.round(fw * 0.018);
  const paddingV = Math.round(basePadding * 0.9);
  const paddingH = basePadding;
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.3);
  const logoGap = Math.max(6, Math.round(paddingH * 0.5));
  const logoMaxW = Math.min(Math.round(fw * 0.1), 56);
  const zoneGap = Math.max(8, Math.round(paddingH * 0.6));
  const inlineGap = Math.max(4, Math.round(paddingH * 0.35));
  const detailGap = Math.max(2, Math.round(paddingH * 0.25));
  const maxW = fw - margin * 2;

  const baseFonts: StampFonts = {
    user: Math.round(baseFontSize * 1.22),
    store: Math.round(baseFontSize * 1.08),
    task: baseFontSize,
    timestamp: Math.round(baseFontSize * 0.95),
    detail: baseFontSize,
  };

  const showLogo =
    boxItems.logo && opts.logoEnabled && proof.proofLogoUrl.trim().length > 0;
  const { logoW, logoH } = computeLogoDimensions(showLogo, logoImg, logoMaxW);

  ctx.font = `${baseFonts.detail}px ${PROOF_FONT.detail}`;

  const gradientCss = config.boxGradientEnabled
    ? resolveGradientCss(config.boxGradientPreset)
    : '';

  const boxInlineParts = buildInlineParts(proof, boxItems);
  const floatInlineParts = buildInlineParts(proof, floatItems);

  if (config.layoutMode === 'logo_dock' && config.boxEnabled) {
    const boxInlineInnerParts = buildInlineParts(proof, {
      userName: boxItems.userName,
      storeCode: boxItems.storeCode,
      taskItem: boxItems.taskItem,
      timestamp: boxItems.timestamp,
    });

    const hasFloatInline = floatInlineParts.length > 0;
    const hasFloatDetail =
      (floatItems.address && proof.locationLine.trim().length > 0) ||
      (floatItems.weather && proof.weatherLine.trim().length > 0);

    const logoInlineReserve = showLogo ? logoW + logoGap : 0;
    let inlineBudget = Math.max(maxW - paddingH * 2 - logoInlineReserve, 0);

    if (hasFloatInline || hasFloatDetail) {
      const reservedTextColW = Math.round(maxW * 0.42);
      inlineBudget = Math.max(maxW - paddingH * 2 - logoInlineReserve - reservedTextColW - logoGap, 0);
    }

    let boxInline = layoutInlineRowFromParts(ctx, boxInlineInnerParts, inlineBudget, baseFonts);
    const fonts = boxInline.fonts;

    let logoBoxContentW =
      (showLogo ? logoW + (boxInline.width > 0 ? logoGap : 0) : 0) + boxInline.width;
    let logoBoxInnerW = Math.max(logoBoxContentW, showLogo ? logoW : 0);
    let logoBoxW =
      logoBoxInnerW > 0 || boxItems.address || boxItems.weather
        ? Math.min(logoBoxInnerW + paddingH * 2, maxW)
        : 0;

    if (!hasFloatInline && !hasFloatDetail) {
      inlineBudget = Math.max(logoBoxW - paddingH * 2 - logoInlineReserve, 0);
      boxInline = layoutInlineRowFromParts(ctx, boxInlineInnerParts, inlineBudget, baseFonts);
      logoBoxContentW =
        (showLogo ? logoW + (boxInline.width > 0 ? logoGap : 0) : 0) + boxInline.width;
      logoBoxInnerW = Math.max(logoBoxContentW, showLogo ? logoW : 0);
      logoBoxW = logoBoxInnerW > 0 ? Math.min(logoBoxInnerW + paddingH * 2, maxW) : 0;
    }

    const logoBoxDetailMaxW = Math.max(logoBoxW - paddingH * 2, 0);
    const boxDetailLines = buildDetailLinesForItems(ctx, proof, boxItems, logoBoxDetailMaxW);

    const boxInlineRowH = Math.max(showLogo ? logoH : 0, boxInline.height);
    const logoBoxInnerH =
      boxInlineRowH +
      (boxDetailLines.length > 0 ? detailGap + boxDetailLines.length * lineHeight : 0);
    const logoBoxH = logoBoxInnerH > 0 ? logoBoxInnerH + paddingV * 2 : 0;

    const textColumnX = margin + (logoBoxW > 0 ? logoBoxW + logoGap : 0);
    const textColumnMaxW = Math.max(fw - margin - textColumnX, 0);

    let floatInline = layoutInlineRowFromParts(ctx, floatInlineParts, textColumnMaxW, baseFonts);
    const floatDetailAtMax = buildDetailLinesForItems(ctx, proof, floatItems, textColumnMaxW);
    const textBlockH =
      floatInline.height +
      (floatDetailAtMax.length > 0 ? detailGap + floatDetailAtMax.length * lineHeight : 0);
    const dockH = Math.max(logoBoxH, textBlockH);
    const dockY = fh - margin - dockH;

    const logoBox =
      logoBoxW > 0
        ? {
            x: margin,
            y: dockY + (dockH - logoBoxH) / 2,
            w: logoBoxW,
            h: logoBoxH,
          }
        : null;

    const textColumn =
      textColumnMaxW > 0 && (floatInline.segments.length > 0 || floatDetailAtMax.length > 0)
        ? { x: textColumnX, y: dockY, w: textColumnMaxW, h: textBlockH }
        : null;

    const dockW =
      (logoBoxW > 0 ? logoBoxW + logoGap : 0) +
      (textColumn ? Math.max(floatInline.width, textColumnMaxW * 0.4) : 0);
    const box = {
      x: margin,
      y: dockY,
      w: Math.min(Math.max(dockW, logoBoxW), maxW),
      h: dockH,
    };

    let floatTop = dockY - zoneGap;
    if (floatTop < margin) floatTop = margin;

    const cssVars: Record<string, string> = {
      '--stamp-box-w': `${box.w}px`,
      '--stamp-pad-v': `${paddingV}px`,
      '--stamp-pad-h': `${paddingH}px`,
      '--stamp-inline-gap': `${inlineGap}px`,
      '--font-user': `${fonts.user}px`,
      '--font-store': `${fonts.store}px`,
      '--font-task': `${fonts.task}px`,
      '--font-ts': `${fonts.timestamp}px`,
      '--font-detail': `${fonts.detail}px`,
      '--logo-max-w': `${logoW}px`,
      '--logo-max-h': `${logoH}px`,
      '--stamp-line-height': `${lineHeight}px`,
      '--logo-dock-w': `${box.w}px`,
      '--text-col-w': `${textColumnMaxW}px`,
      '--dock-h': `${dockH}px`,
      '--ultimate-gradient': gradientCss,
    };

    return {
      margin,
      paddingV,
      paddingH,
      zoneGap,
      lineHeight,
      box,
      fonts,
      logo: { w: logoW, h: logoH, show: showLogo && logoW > 0, gap: logoGap },
      rowH: dockH,
      inlineRow: { segments: boxInline.segments, height: boxInline.height, fontScale: boxInline.fontScale },
      floating: { maxWidth: maxW, lines: [], top: floatTop },
      logoDock: null,
      ultimate: {
        layoutMode: 'logo_dock',
        gradientEnabled: config.boxGradientEnabled,
        gradientPreset: config.boxGradientPreset,
        gradientCss,
        boxEnabled: config.boxEnabled,
        box,
        logoBox,
        textColumn,
        boxInline: boxInline.segments,
        boxDetailLines,
        floatInline: floatInline.segments,
        floatDetailLines: floatDetailAtMax,
        boxHasLogo: showLogo,
        floatTop,
        detailGap,
      },
      timecard: null,
      cssVars,
    };
  }

  // strip mode (or logo_dock with box disabled falls through to floating-only strip)
  let boxDetailLines: string[] = [];
  const floatDetailLines = buildDetailLinesForItems(ctx, proof, floatItems, maxW);

  const boxTextMaxW = Math.max(maxW - paddingH * 2 - (showLogo && config.boxEnabled ? logoW + logoGap : 0), 0);
  let boxInline = config.boxEnabled
    ? layoutInlineRowFromParts(ctx, boxInlineParts, boxTextMaxW, baseFonts)
    : { segments: [], height: 0, fontScale: 1, fonts: baseFonts, width: 0 };
  let floatInline = layoutInlineRowFromParts(ctx, floatInlineParts, maxW, baseFonts);
  const fonts = boxInline.segments.length > 0 ? boxInline.fonts : floatInline.fonts;

  const contentNeedW = config.boxEnabled
    ? (showLogo ? logoW + logoGap : 0) + boxInline.width + paddingH * 2
    : 0;
  let boxW = config.boxEnabled
    ? clamp(Math.max(contentNeedW, showLogo ? logoW + paddingH * 2 : 48), 0, maxW)
    : 0;

  if (config.boxEnabled && boxW > 0) {
    const refinedTextW = Math.max(boxW - paddingH * 2 - (showLogo ? logoW + logoGap : 0), 0);
    boxInline = layoutInlineRowFromParts(ctx, boxInlineParts, refinedTextW, baseFonts);
    const refinedNeedW =
      (showLogo ? logoW + logoGap : 0) + boxInline.width + paddingH * 2;
    boxW = clamp(Math.max(refinedNeedW, showLogo ? logoW + paddingH * 2 : 48), 0, maxW);
    const boxDetailMaxW = Math.max(boxW - paddingH * 2, 0);
    boxDetailLines = buildDetailLinesForItems(ctx, proof, boxItems, boxDetailMaxW);
  }

  const boxRowH = Math.max(showLogo && config.boxEnabled ? logoH : 0, boxInline.height);
  const boxInnerH =
    boxRowH + (boxDetailLines.length > 0 ? detailGap + boxDetailLines.length * lineHeight : 0);
  const boxH = config.boxEnabled && (boxInnerH > 0 || showLogo)
    ? paddingV * 2 + boxInnerH
    : 0;

  const boxX = margin;
  const boxY = boxH > 0 ? fh - margin - boxH : fh - margin;

  const floatBlockH =
    floatDetailLines.length * lineHeight +
    (floatInline.segments.length > 0 ? floatInline.height + (floatDetailLines.length > 0 ? detailGap : 0) : 0);
  let floatTop = (boxH > 0 ? boxY : fh - margin) - zoneGap - floatBlockH;
  if (floatTop < margin) floatTop = margin;

  const box = { x: boxX, y: boxY, w: boxW, h: boxH };

  const cssVars: Record<string, string> = {
    '--stamp-box-w': `${boxW}px`,
    '--stamp-pad-v': `${paddingV}px`,
    '--stamp-pad-h': `${paddingH}px`,
    '--stamp-inline-gap': `${inlineGap}px`,
    '--font-user': `${fonts.user}px`,
    '--font-store': `${fonts.store}px`,
    '--font-task': `${fonts.task}px`,
    '--font-ts': `${fonts.timestamp}px`,
    '--font-detail': `${fonts.detail}px`,
    '--logo-max-w': `${logoW}px`,
    '--logo-max-h': `${logoH}px`,
    '--stamp-line-height': `${lineHeight}px`,
    '--ultimate-gradient': gradientCss,
  };

  return {
    margin,
    paddingV,
    paddingH,
    zoneGap,
    lineHeight,
    box,
    fonts,
    logo: { w: logoW, h: logoH, show: showLogo && logoW > 0, gap: logoGap },
    rowH: boxH,
    inlineRow: { segments: boxInline.segments, height: boxInline.height, fontScale: boxInline.fontScale },
    floating: { maxWidth: maxW, lines: floatDetailLines, top: floatTop },
    logoDock: null,
    ultimate: {
      layoutMode: 'strip',
      gradientEnabled: config.boxGradientEnabled,
      gradientPreset: config.boxGradientPreset,
      gradientCss,
      boxEnabled: config.boxEnabled && boxW > 0,
      box,
      logoBox: null,
      textColumn: null,
      boxInline: boxInline.segments,
      boxDetailLines,
      floatInline: floatInline.segments,
      floatDetailLines,
      boxHasLogo: showLogo && config.boxEnabled,
      floatTop,
      detailGap,
    },
    timecard: null,
    cssVars,
  };
}

function computeProofStripLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);

  const margin = Math.round(fw * 0.035);
  const basePadding = Math.round(fw * 0.018);
  const paddingV = Math.round(basePadding * 0.9);
  const paddingH = basePadding;
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.3);
  const logoGap = Math.max(6, Math.round(paddingH * 0.5));
  const logoMaxW = Math.min(Math.round(fw * 0.1), 56);
  const zoneGap = Math.max(8, Math.round(paddingH * 0.6));
  const inlineGap = Math.max(4, Math.round(paddingH * 0.35));

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

  let boxW = clamp(maxW, minW, maxW);
  let textAreaW = boxW - paddingH * 2 - (logoW > 0 ? logoW + logoGap : 0);

  let inline = layoutInlineRow(ctx, proof, Math.max(textAreaW, 0), baseFonts);

  const contentNeedW =
    (logoW > 0 ? logoW + logoGap : 0) + inline.width + paddingH * 2;
  boxW = clamp(Math.max(contentNeedW, minW), minW, maxW);
  textAreaW = boxW - paddingH * 2 - (logoW > 0 ? logoW + logoGap : 0);

  inline = layoutInlineRow(ctx, proof, Math.max(textAreaW, 0), baseFonts);

  const fonts = inline.fonts;
  const rowH = Math.max(logoH, inline.height);
  const boxH = paddingV * 2 + rowH;

  const boxX = margin;
  const boxY = fh - margin - boxH;

  const cssVars: Record<string, string> = {
    '--stamp-box-w': `${boxW}px`,
    '--stamp-box-min-w': `${minW}px`,
    '--stamp-pad-v': `${paddingV}px`,
    '--stamp-pad-h': `${paddingH}px`,
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
    paddingV,
    paddingH,
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
    floating: { maxWidth: fw - margin * 2, lines: [], top: margin },
    logoDock: null,
    ultimate: null,
    timecard: null,
    cssVars,
  };
}

function computeLogoDockLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);

  const margin = Math.round(fw * 0.035);
  const paddingV = Math.round(fw * 0.018);
  const paddingH = Math.round(fw * 0.018);
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.3);
  const logoGap = Math.max(6, Math.round(paddingH * 0.5));
  const logoMaxW = Math.min(Math.round(fw * 0.1), 56);
  const zoneGap = Math.max(8, Math.round(paddingH * 0.6));
  const inlineGap = Math.max(4, Math.round(paddingH * 0.35));
  const detailGap = Math.max(2, Math.round(paddingH * 0.25));

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

  const logoBoxW = showLogo && logoW > 0 ? logoW + paddingH * 2 : 0;
  const logoBoxH = showLogo && logoH > 0 ? logoH + paddingV * 2 : 0;
  const textColumnX = margin + (logoBoxW > 0 ? logoBoxW + logoGap : 0);
  const textColumnMaxW = Math.max(fw - margin - textColumnX, 0);

  let inline = layoutInlineRow(ctx, proof, textColumnMaxW, baseFonts);
  const fonts = inline.fonts;

  ctx.font = `${baseFonts.detail}px ${PROOF_FONT.detail}`;
  const detailLines: string[] = [];
  if (proof.locationLine.trim()) {
    detailLines.push(...capWrappedLines(wrapText(ctx, proof.locationLine, textColumnMaxW), 4));
  }
  if (proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine.trim()) {
    detailLines.push(...wrapText(ctx, proof.weatherLine, textColumnMaxW));
  }

  const textBlockH =
    inline.height +
    (detailLines.length > 0 ? detailGap + detailLines.length * lineHeight : 0);
  const dockH = Math.max(logoBoxH, textBlockH);
  const dockY = fh - margin - dockH;

  const logoBox = {
    x: margin,
    y: logoBoxH > 0 ? dockY + (dockH - logoBoxH) / 2 : dockY,
    w: logoBoxW,
    h: logoBoxH,
  };

  const textColumn = {
    x: textColumnX,
    y: dockY,
    w: textColumnMaxW,
    h: textBlockH,
  };

  const dockW = (logoBoxW > 0 ? logoBoxW + logoGap : 0) + Math.max(inline.width, textColumnMaxW * 0.5);
  const box = { x: margin, y: dockY, w: Math.min(dockW, fw - margin * 2), h: dockH };

  const cssVars: Record<string, string> = {
    '--stamp-box-w': `${box.w}px`,
    '--stamp-pad-v': `${paddingV}px`,
    '--stamp-pad-h': `${paddingH}px`,
    '--stamp-inline-gap': `${inlineGap}px`,
    '--font-user': `${fonts.user}px`,
    '--font-store': `${fonts.store}px`,
    '--font-task': `${fonts.task}px`,
    '--font-ts': `${fonts.timestamp}px`,
    '--font-detail': `${fonts.detail}px`,
    '--logo-max-w': `${logoW}px`,
    '--logo-max-h': `${logoH}px`,
    '--stamp-line-height': `${lineHeight}px`,
    '--logo-dock-w': `${box.w}px`,
    '--text-col-w': `${textColumnMaxW}px`,
    '--dock-h': `${dockH}px`,
  };

  return {
    margin,
    paddingV,
    paddingH,
    zoneGap,
    lineHeight,
    box,
    fonts,
    logo: { w: logoW, h: logoH, show: showLogo && logoW > 0, gap: logoGap },
    rowH: dockH,
    inlineRow: {
      segments: inline.segments,
      height: inline.height,
      fontScale: inline.fontScale,
    },
    floating: { maxWidth: fw - margin * 2, lines: [], top: margin },
    logoDock: {
      logoBox,
      textColumn,
      detailLines,
      dockH,
      detailGap,
    },
    ultimate: null,
    timecard: null,
    cssVars,
  };
}

function computeStandardStampLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);

  const margin = Math.round(fw * 0.035);
  const basePadding = Math.round(fw * 0.018);
  const isTransparent = resolveWatermarkStyle(proof.cameraOptionsSnapshot) === 'transparentFloating';
  const paddingV = isTransparent ? Math.round(basePadding * 0.85) : basePadding;
  const paddingH = basePadding;
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.3);
  const logoGap = Math.max(6, Math.round(paddingH * 0.5));
  const logoMaxW = Math.min(Math.round(fw * 0.1), 56);
  const zoneGap = Math.max(8, Math.round(paddingH * 0.6));
  const inlineGap = Math.max(4, Math.round(paddingH * 0.35));

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
  let textAreaW = boxW - paddingH * 2 - (logoW > 0 ? logoW + logoGap : 0);

  let inline = layoutInlineRow(ctx, proof, Math.max(textAreaW, 0), baseFonts);

  const contentNeedW =
    (logoW > 0 ? logoW + logoGap : 0) + inline.width + paddingH * 2;
  boxW = clamp(Math.max(contentNeedW, minW), minW, maxW);
  textAreaW = boxW - paddingH * 2 - (logoW > 0 ? logoW + logoGap : 0);

  inline = layoutInlineRow(ctx, proof, Math.max(textAreaW, 0), baseFonts);

  const fonts = inline.fonts;
  const rowH = Math.max(logoH, inline.height);
  const boxH = paddingV * 2 + rowH;

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
    '--stamp-pad-v': `${paddingV}px`,
    '--stamp-pad-h': `${paddingH}px`,
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
    paddingV,
    paddingH,
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
    logoDock: null,
    ultimate: null,
    timecard: null,
    cssVars,
  };
}

function resolveTimecardClock(proof: ProofSnapshot): { time: string; date: string; day: string } {
  const tz = proof.proofTimezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const at = proof.capturedAt ? new Date(proof.capturedAt) : new Date();
  if (!Number.isNaN(at.getTime())) {
    return formatTimecardClockParts(at, tz);
  }
  return { time: '', date: '', day: '' };
}

function formatTimecardWeatherLine(proof: ProofSnapshot): string {
  if (proof.proofWeather) {
    const temp = Math.round(proof.proofWeather.temperature);
    const condition = proof.proofWeather.condition?.trim() || '—';
    return `Weather: ${condition} ${temp}°C`;
  }
  const line = proof.weatherLine.trim();
  if (!line) return '';
  return line.startsWith('Weather') ? line : `Weather: ${line}`;
}

function computeTimecardLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);
  const opts = proof.cameraOptionsSnapshot;
  const config = resolveTimecardConfig(opts);
  const items = resolveEffectiveTimecardItems(config, opts);

  const margin = Math.round(fw * 0.035);
  const paddingV = Math.round(fw * 0.02);
  const paddingH = Math.round(fw * 0.022);
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.28);
  const logoGap = Math.max(8, Math.round(paddingH * 0.7));
  const logoMaxW = Math.min(Math.round(fw * 0.11), 64);
  const zoneGap = Math.max(8, Math.round(paddingH * 0.55));
  const sectionGap = Math.max(4, Math.round(paddingH * 0.35));
  const accentGap = Math.max(8, Math.round(paddingH * 0.55));
  const maxW = fw - margin * 2;

  const baseFonts: StampFonts = {
    user: Math.round(baseFontSize * 1.05),
    store: Math.round(baseFontSize * 1.0),
    task: Math.round(baseFontSize * 0.95),
    timestamp: Math.round(baseFontSize * 0.9),
    detail: baseFontSize,
  };

  const showLogo =
    config.logoOutside &&
    opts.logoEnabled &&
    proof.proofLogoUrl.trim().length > 0;
  const { logoW, logoH } = computeLogoDimensions(showLogo, logoImg, logoMaxW);

  const clock = resolveTimecardClock(proof);
  const showTime = items.time && !!clock.time;
  const showDate = items.date && !!clock.date;
  const showDay = items.day && !!clock.day;
  const showAccent = showTime && showDate;

  const metaCandidates: string[] = [];
  if (items.userName && proof.userName.trim()) metaCandidates.push(proof.userName.trim());
  if (items.storeCode && proof.storeCode.trim()) metaCandidates.push(proof.storeCode.trim());
  if (items.taskItem && proof.itemTitle.trim()) metaCandidates.push(proof.itemTitle.trim());
  if (items.timestamp && proof.displayTime.trim()) metaCandidates.push(proof.displayTime.trim());

  const detailCandidates: string[] = [];
  if (items.address && proof.locationLine.trim()) detailCandidates.push(proof.locationLine.trim());
  if (items.weather) {
    const weather = formatTimecardWeatherLine(proof);
    if (weather) detailCandidates.push(weather);
  }
  if (items.gpsAccuracy && proof.gps && Number.isFinite(proof.gps.accuracy)) {
    detailCandidates.push(`GPS ±${Math.round(proof.gps.accuracy)}m`);
  }

  const photoCodeRaw = proof.photoCode?.trim() || '';
  const photoCodeLine = items.photoCode ? `Photo Code: ${photoCodeRaw || '········'}` : '';

  const cardBudgetW = Math.max(maxW - (showLogo && logoW > 0 ? logoW + logoGap : 0), 80);
  const contentMaxW = Math.max(cardBudgetW - paddingH * 2, 40);

  let timeSize = Math.round(baseFontSize * 1.85);
  let dateSize = Math.round(baseFontSize * 1.05);
  let daySize = Math.round(baseFontSize * 0.92);
  let metaSize = Math.round(baseFontSize * 0.92);
  let detailSize = baseFontSize;
  let photoCodeSize = Math.round(baseFontSize * 0.82);

  const measurePrimaryW = (tSize: number, dSize: number) => {
    let w = 0;
    if (showTime) w += measureTextW(ctx, clock.time, tSize, PROOF_FONT.timestamp);
    if (showAccent) w += accentGap + Math.max(2, Math.round(tSize * 0.08)) + accentGap;
    if (showDate) w += measureTextW(ctx, clock.date, dSize, PROOF_FONT.timestamp);
    return w;
  };

  for (const scale of FONT_SCALES) {
    timeSize = Math.round(baseFontSize * 1.85 * scale);
    dateSize = Math.round(baseFontSize * 1.05 * scale);
    daySize = Math.round(baseFontSize * 0.92 * scale);
    metaSize = Math.round(baseFontSize * 0.92 * scale);
    detailSize = Math.round(baseFontSize * scale);
    photoCodeSize = Math.round(baseFontSize * 0.82 * scale);
    if (measurePrimaryW(timeSize, dateSize) <= contentMaxW) break;
  }

  const primaryRowH = Math.max(
    showTime ? Math.round(timeSize * 1.05) : 0,
    showDate || showDay
      ? Math.round(dateSize * 1.05) + (showDay ? Math.round(daySize * 1.15) : 0)
      : 0,
  );

  const metaLines: string[] = [];
  ctx.font = `${metaSize}px ${PROOF_FONT.detail}`;
  for (const line of metaCandidates) {
    metaLines.push(...capWrappedLines(wrapText(ctx, line, contentMaxW), 2));
  }

  ctx.font = `${detailSize}px ${PROOF_FONT.detail}`;
  const detailLines: string[] = [];
  for (const line of detailCandidates) {
    detailLines.push(
      ...capWrappedLines(wrapText(ctx, line, contentMaxW), line.startsWith('Weather') ? 2 : 3),
    );
  }

  ctx.font = `${photoCodeSize}px ${PROOF_FONT.detail}`;
  const photoLines = photoCodeLine
    ? capWrappedLines(wrapText(ctx, photoCodeLine, contentMaxW), 1)
    : [];

  let contentW = 0;
  if (showTime || showDate) contentW = Math.max(contentW, measurePrimaryW(timeSize, dateSize));
  if (showDay) {
    contentW = Math.max(contentW, measureTextW(ctx, clock.day, daySize, PROOF_FONT.timestamp));
  }
  ctx.font = `${metaSize}px ${PROOF_FONT.detail}`;
  for (const line of metaLines) contentW = Math.max(contentW, ctx.measureText(line).width);
  ctx.font = `${detailSize}px ${PROOF_FONT.detail}`;
  for (const line of detailLines) contentW = Math.max(contentW, ctx.measureText(line).width);
  ctx.font = `${photoCodeSize}px ${PROOF_FONT.detail}`;
  for (const line of photoLines) contentW = Math.max(contentW, ctx.measureText(line).width);

  const hasCardContent =
    showTime ||
    showDate ||
    showDay ||
    metaLines.length > 0 ||
    detailLines.length > 0 ||
    photoLines.length > 0;

  let innerH = 0;
  if (primaryRowH > 0) innerH += primaryRowH;
  if (metaLines.length > 0) {
    if (innerH > 0) innerH += sectionGap;
    innerH += metaLines.length * Math.round(metaSize * 1.28);
  }
  if (detailLines.length > 0) {
    if (innerH > 0) innerH += sectionGap;
    innerH += detailLines.length * Math.round(detailSize * 1.28);
  }
  if (photoLines.length > 0) {
    if (innerH > 0) innerH += sectionGap;
    innerH += photoLines.length * Math.round(photoCodeSize * 1.2);
  }

  const cardW = hasCardContent
    ? clamp(Math.ceil(contentW + paddingH * 2), Math.min(120, cardBudgetW), cardBudgetW)
    : 0;
  const cardH = hasCardContent ? Math.ceil(innerH + paddingV * 2) : 0;
  const radius = Math.max(10, Math.round(baseFontSize * 0.55));

  const clusterH = Math.max(showLogo ? logoH : 0, cardH);
  const clusterY = fh - margin - clusterH;
  const logoX = margin;
  const logoY = clusterY + (clusterH - (showLogo ? logoH : 0)) / 2;
  const cardX = margin + (showLogo && logoW > 0 ? logoW + logoGap : 0);
  const cardY = clusterY + (clusterH - cardH) / 2;

  const gradientCss =
    config.backgroundMode === 'gradient' ? resolveGradientCss(config.gradientPreset) : '';

  const cssVars: Record<string, string> = {
    '--stamp-box-w': `${cardW}px`,
    '--stamp-pad-v': `${paddingV}px`,
    '--stamp-pad-h': `${paddingH}px`,
    '--stamp-inline-gap': `${sectionGap}px`,
    '--font-user': `${baseFonts.user}px`,
    '--font-store': `${baseFonts.store}px`,
    '--font-task': `${baseFonts.task}px`,
    '--font-ts': `${baseFonts.timestamp}px`,
    '--font-detail': `${detailSize}px`,
    '--logo-max-w': `${logoW}px`,
    '--logo-max-h': `${logoH}px`,
    '--stamp-line-height': `${lineHeight}px`,
    '--timecard-time-size': `${timeSize}px`,
    '--timecard-date-size': `${dateSize}px`,
    '--timecard-day-size': `${daySize}px`,
    '--timecard-meta-size': `${metaSize}px`,
    '--timecard-photo-size': `${photoCodeSize}px`,
    '--timecard-radius': `${radius}px`,
    '--timecard-card-w': `${cardW}px`,
    '--timecard-gradient': gradientCss,
    '--timecard-accent-gap': `${accentGap}px`,
  };

  const box = {
    x: margin,
    y: clusterY,
    w: Math.min((showLogo && logoW > 0 ? logoW + logoGap : 0) + cardW, maxW),
    h: clusterH,
  };

  return {
    margin,
    paddingV,
    paddingH,
    zoneGap,
    lineHeight,
    box,
    fonts: { ...baseFonts, detail: detailSize, timestamp: dateSize },
    logo: { w: logoW, h: logoH, show: showLogo && logoW > 0, gap: logoGap },
    rowH: clusterH,
    inlineRow: { segments: [], height: 0, fontScale: 1 },
    floating: { maxWidth: maxW, lines: [], top: margin },
    logoDock: null,
    ultimate: null,
    timecard: {
      backgroundMode: config.backgroundMode,
      gradientPreset: config.gradientPreset,
      gradientCss,
      frostedGlassEnabled: config.frostedGlassEnabled || config.backgroundMode === 'frosted',
      logoOutside: true,
      logo: {
        x: logoX,
        y: logoY,
        w: logoW,
        h: logoH,
        show: showLogo && logoW > 0,
      },
      card: { x: cardX, y: cardY, w: cardW, h: cardH, radius },
      timeText: clock.time,
      dateText: clock.date,
      dayText: clock.day,
      showTime,
      showDate,
      showDay,
      showAccent,
      metaLines,
      detailLines,
      photoCodeLine: photoLines[0] ?? '',
      fonts: {
        time: timeSize,
        date: dateSize,
        day: daySize,
        meta: metaSize,
        detail: detailSize,
        photoCode: photoCodeSize,
      },
      primaryRowH,
      accentGap,
      sectionGap,
    },
    cssVars,
  };
}

export function createMeasureContext(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.getContext('2d')!;
}
