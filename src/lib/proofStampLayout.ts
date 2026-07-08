import { PROOF_FONT } from './proofFonts';
import type { ProofSnapshot } from './proofWatermarkDraw';

export interface StampLayoutInput {
  frameWidth: number;
  frameHeight: number;
  proof: ProofSnapshot;
  logoImg: HTMLImageElement | null;
  measureCtx: CanvasRenderingContext2D;
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
  row2: { userLines: string[]; storeLines: string[]; stacked: boolean };
  row3: { taskLines: string[] };
  floating: { maxWidth: number; lines: string[]; top: number };
  cssVars: Record<string, string>;
}

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

function layoutRow2(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  innerW: number,
  userSize: number,
  storeSize: number,
  identityGap: number,
): { userLines: string[]; storeLines: string[]; stacked: boolean; height: number } {
  const userText = proof.userName.trim();
  const storeText = proof.storeCode.trim();
  if (!userText && !storeText) {
    return { userLines: [], storeLines: [], stacked: false, height: 0 };
  }
  if (!userText) {
    const storeLines = wrapText(ctx, storeText, innerW);
    ctx.font = `${storeSize}px ${PROOF_FONT.store}`;
    return {
      userLines: [],
      storeLines,
      stacked: false,
      height: storeLines.length * Math.round(storeSize * 1.2),
    };
  }
  if (!storeText) {
    const userLines = wrapText(ctx, userText, innerW);
    ctx.font = `${userSize}px ${PROOF_FONT.user}`;
    return {
      userLines,
      storeLines: [],
      stacked: false,
      height: userLines.length * Math.round(userSize * 1.2),
    };
  }

  const userMaxW = Math.round(innerW * 0.58);
  const storeMaxW = innerW - userMaxW - identityGap;
  ctx.font = `${userSize}px ${PROOF_FONT.user}`;
  const userLines = wrapText(ctx, userText, userMaxW);
  ctx.font = `${storeSize}px ${PROOF_FONT.store}`;
  const userW = Math.max(...userLines.map((l) => measureTextW(ctx, l, userSize, PROOF_FONT.user)), 0);
  const storeOneLineW = measureTextW(ctx, storeText, storeSize, PROOF_FONT.store);

  if (userLines.length === 1 && storeOneLineW <= Math.max(innerW - userW - identityGap, storeMaxW)) {
    return {
      userLines,
      storeLines: [storeText],
      stacked: false,
      height: Math.max(Math.round(userSize * 1.2), Math.round(storeSize * 1.2)),
    };
  }

  const stackedUser = capWrappedLines(userLines, 2);
  ctx.font = `${storeSize}px ${PROOF_FONT.store}`;
  const storeLines = capWrappedLines(wrapText(ctx, storeText, innerW), 1);
  const h =
    stackedUser.length * Math.round(userSize * 1.2) +
    (storeLines.length > 0 ? Math.round(storeSize * 1.15) : 0);
  return { userLines: stackedUser, storeLines, stacked: true, height: h };
}

export function computeStampLayout(input: StampLayoutInput): StampLayoutResult {
  const { frameWidth, frameHeight, proof, logoImg, measureCtx: ctx } = input;
  const fw = Math.max(frameWidth, 240);
  const fh = Math.max(frameHeight, 240);

  const margin = Math.round(fw * 0.035);
  const padding = Math.round(fw * 0.028);
  const baseFontSize = Math.max(14, Math.round(fw * 0.035));
  const lineHeight = Math.round(baseFontSize * 1.3);
  const logoGap = Math.max(8, Math.round(padding * 0.5));
  const logoMaxW = Math.min(Math.round(fw * 0.14), 70);
  const rowGap = Math.max(3, Math.round(padding * 0.35));
  const zoneGap = Math.max(8, Math.round(padding * 0.6));
  const identityGap = Math.max(6, Math.round(padding * 0.45));

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

  const targetW = Math.round(fw * 0.54);
  const minW = Math.round(fw * 0.44);
  const maxW = Math.round(fw * 0.68);

  let boxW = clamp(targetW, minW, maxW);
  let innerW = boxW - padding * 2;

  const tsW = measureTextW(ctx, proof.displayTime, fonts.timestamp, PROOF_FONT.timestamp);
  const row1H = Math.max(logoH, Math.round(fonts.timestamp * 1.2));

  let row2 = layoutRow2(ctx, proof, innerW, fonts.user, fonts.store, identityGap);
  let row3Lines = proof.itemTitle.trim()
    ? capWrappedLines(
        wrapText(ctx, proof.itemTitle, innerW),
        2,
      )
    : [];
  ctx.font = `${fonts.task}px ${PROOF_FONT.task}`;
  let row3H = row3Lines.length * Math.round(fonts.task * 1.2);

  const contentNeedW = Math.max(
    tsW + (logoW > 0 ? logoW + logoGap : 0),
    innerW * 0.85,
  );
  boxW = clamp(Math.max(contentNeedW + padding * 2, minW), minW, maxW);
  innerW = boxW - padding * 2;

  row2 = layoutRow2(ctx, proof, innerW, fonts.user, fonts.store, identityGap);
  row3Lines = proof.itemTitle.trim()
    ? capWrappedLines(wrapText(ctx, proof.itemTitle, innerW), 2)
    : [];
  row3H = row3Lines.length * Math.round(fonts.task * 1.2);

  let boxH = padding * 2 + row1H;
  if (row2.height > 0) boxH += rowGap + row2.height;
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
    row2H: row2.height,
    row3H,
    row2: { userLines: row2.userLines, storeLines: row2.storeLines, stacked: row2.stacked },
    row3: { taskLines: row3Lines },
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
