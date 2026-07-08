import { GOLD_FILL, PROOF_FONT } from './proofFonts';
import type { CameraOptions, ProofWeather } from '../types';

export interface ProofSnapshot {
  capturedAt: string;
  displayTime: string;
  storeCode: string;
  itemTitle: string;
  userName: string;
  locationLine: string;
  gps: { lat: number; lng: number; accuracy: number } | null;
  address: string;
  weatherLine: string;
  proofWeather: ProofWeather | null;
  proofLogoUrl: string;
  cameraOptionsSnapshot: CameraOptions;
}

const NAVY_STROKE = '#1A2B5E';

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

function buildFloatingProofLines(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  maxWidth: number,
  baseFontSize: number,
): string[] {
  const result: string[] = [];
  ctx.font = `${baseFontSize}px ${PROOF_FONT.detail}`;

  if (proof.locationLine.trim()) {
    result.push(...capWrappedLines(wrapText(ctx, proof.locationLine, maxWidth), 4));
  }
  if (proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine.trim()) {
    result.push(...wrapText(ctx, proof.weatherLine, maxWidth));
  }
  return result;
}

interface StampMetrics {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  logoDrawW: number;
  logoDrawH: number;
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function measureStampBox(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
  padding: number,
  baseFontSize: number,
  lineHeight: number,
  logoMaxW: number,
  logoGap: number,
  innerMaxW: number,
): { boxW: number; boxH: number; logoDrawW: number; logoDrawH: number } {
  const showLogo =
    proof.cameraOptionsSnapshot.logoEnabled &&
    proof.proofLogoUrl.trim().length > 0 &&
    logoImg;

  let logoDrawW = 0;
  let logoDrawH = 0;
  if (showLogo && logoImg) {
    const scale = logoMaxW / logoImg.width;
    logoDrawW = logoMaxW;
    logoDrawH = logoImg.height * scale;
  }

  const userSize = Math.round(baseFontSize * 1.22);
  const storeSize = Math.round(baseFontSize * 1.08);
  const taskSize = baseFontSize;
  const tsSize = Math.round(baseFontSize * 0.95);

  const rows: { font: string; size: number; lines: string[] }[] = [];

  ctx.font = `${tsSize}px ${PROOF_FONT.timestamp}`;
  const tsLines = wrapText(ctx, proof.displayTime, innerMaxW - (logoDrawW > 0 ? logoDrawW + logoGap : 0));
  rows.push({ font: PROOF_FONT.timestamp, size: tsSize, lines: tsLines.length ? tsLines : [proof.displayTime] });

  if (proof.userName.trim()) {
    ctx.font = `${userSize}px ${PROOF_FONT.user}`;
    rows.push({ font: PROOF_FONT.user, size: userSize, lines: wrapText(ctx, proof.userName, innerMaxW) });
  }
  if (proof.storeCode.trim()) {
    ctx.font = `${storeSize}px ${PROOF_FONT.store}`;
    rows.push({ font: PROOF_FONT.store, size: storeSize, lines: wrapText(ctx, proof.storeCode, innerMaxW) });
  }
  if (proof.itemTitle.trim()) {
    ctx.font = `${taskSize}px ${PROOF_FONT.task}`;
    rows.push({ font: PROOF_FONT.task, size: taskSize, lines: wrapText(ctx, proof.itemTitle, innerMaxW) });
  }

  let textBlockH = 0;
  for (const row of rows.slice(1)) {
    textBlockH += row.lines.length * Math.round(row.size * 1.25);
  }
  const logoRowH = Math.max(logoDrawH, Math.round(tsSize * 1.25));
  const rowGap = Math.max(4, Math.round(padding * 0.35));
  const boxH = padding * 2 + logoRowH + (textBlockH > 0 ? rowGap + textBlockH : 0);

  ctx.font = `${tsSize}px ${PROOF_FONT.timestamp}`;
  let maxInnerW = 0;
  for (const row of rows) {
    ctx.font = `${row.size}px ${row.font}`;
    for (const line of row.lines) {
      maxInnerW = Math.max(maxInnerW, ctx.measureText(line).width);
    }
  }
  const logoRowW = (logoDrawW > 0 ? logoDrawW + logoGap : 0) + Math.max(
    ...rows[0]!.lines.map((l) => {
      ctx.font = `${tsSize}px ${PROOF_FONT.timestamp}`;
      return ctx.measureText(l).width;
    }),
    0,
  );
  const boxW = padding * 2 + Math.max(maxInnerW, logoRowW);

  return { boxW, boxH, logoDrawW, logoDrawH };
}

function drawGoldOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontFamily: string,
  fillColor: string = GOLD_FILL,
) {
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, fontSize * 0.12);
  ctx.strokeStyle = NAVY_STROKE;
  ctx.fillStyle = fillColor;
  ctx.shadowColor = 'rgba(15, 26, 58, 0.75)';
  ctx.shadowBlur = Math.max(4, fontSize * 0.35);
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;

  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawFloatingText(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  baseFontSize: number,
  baseLineHeight: number,
) {
  let cursorY = y;
  for (const line of lines) {
    const baseline = cursorY + baseLineHeight * 0.75;
    drawGoldOutlinedText(ctx, line, x, baseline, baseFontSize, PROOF_FONT.detail);
    cursorY += baseLineHeight;
  }
}

function drawStampBox(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
  metrics: StampMetrics,
  padding: number,
  baseFontSize: number,
  lineHeight: number,
  logoGap: number,
  innerMaxW: number,
) {
  const radius = Math.max(6, Math.round(baseFontSize * 0.35));
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  fillRoundedRect(ctx, metrics.boxX, metrics.boxY, metrics.boxW, metrics.boxH, radius);

  const userSize = Math.round(baseFontSize * 1.22);
  const storeSize = Math.round(baseFontSize * 1.08);
  const taskSize = baseFontSize;
  const tsSize = Math.round(baseFontSize * 0.95);
  const rowGap = Math.max(4, Math.round(padding * 0.35));

  let cursorY = metrics.boxY + padding;
  const contentX = metrics.boxX + padding;

  const showLogo =
    proof.cameraOptionsSnapshot.logoEnabled &&
    proof.proofLogoUrl.trim().length > 0 &&
    logoImg &&
    metrics.logoDrawW > 0;

  const tsBaseline = cursorY + tsSize * 0.85;
  if (showLogo && logoImg) {
    const logoY = cursorY;
    ctx.shadowColor = 'rgba(58, 58, 76, 0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(logoImg, contentX, logoY, metrics.logoDrawW, metrics.logoDrawH);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    drawGoldOutlinedText(
      ctx,
      proof.displayTime,
      contentX + metrics.logoDrawW + logoGap,
      tsBaseline,
      tsSize,
      PROOF_FONT.timestamp,
      GOLD_FILL,
    );
  } else {
    drawGoldOutlinedText(
      ctx,
      proof.displayTime,
      contentX,
      tsBaseline,
      tsSize,
      PROOF_FONT.timestamp,
      GOLD_FILL,
    );
  }

  cursorY += Math.max(metrics.logoDrawH, Math.round(tsSize * 1.25)) + rowGap;

  if (proof.userName.trim()) {
    ctx.font = `${userSize}px ${PROOF_FONT.user}`;
    for (const line of wrapText(ctx, proof.userName, innerMaxW)) {
      drawGoldOutlinedText(ctx, line, contentX, cursorY + userSize * 0.85, userSize, PROOF_FONT.user);
      cursorY += Math.round(userSize * 1.25);
    }
  }
  if (proof.storeCode.trim()) {
    ctx.font = `${storeSize}px ${PROOF_FONT.store}`;
    for (const line of wrapText(ctx, proof.storeCode, innerMaxW)) {
      drawGoldOutlinedText(ctx, line, contentX, cursorY + storeSize * 0.85, storeSize, PROOF_FONT.store);
      cursorY += Math.round(storeSize * 1.25);
    }
  }
  if (proof.itemTitle.trim()) {
    ctx.font = `${taskSize}px ${PROOF_FONT.task}`;
    for (const line of wrapText(ctx, proof.itemTitle, innerMaxW)) {
      drawGoldOutlinedText(ctx, line, contentX, cursorY + taskSize * 0.85, taskSize, PROOF_FONT.task);
      cursorY += Math.round(taskSize * 1.25);
    }
  }
}

export function drawProofOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
) {
  const padding    = Math.round(canvas.width * 0.035);
  const fontSize   = Math.max(14, Math.round(canvas.width * 0.035));
  const lineHeight = Math.round(fontSize * 1.3);
  const logoGap    = Math.max(8, Math.round(padding * 0.5));
  const logoMaxW   = Math.min(Math.round(canvas.width * 0.14), 70);
  const zoneGap    = Math.max(8, Math.round(padding * 0.6));
  const innerMaxW  = Math.min(Math.round(canvas.width * 0.72), canvas.width - padding * 2);

  const { boxW, boxH, logoDrawW, logoDrawH } = measureStampBox(
    ctx,
    proof,
    logoImg,
    padding,
    fontSize,
    lineHeight,
    logoMaxW,
    logoGap,
    innerMaxW,
  );

  const stampMetrics: StampMetrics = {
    boxX: padding,
    boxY: canvas.height - padding - boxH,
    boxW,
    boxH,
    logoDrawW,
    logoDrawH,
  };

  const floatMaxWidth = canvas.width - padding * 2;
  const floatLines = buildFloatingProofLines(ctx, proof, floatMaxWidth, fontSize);
  const floatBlockH = floatLines.length * lineHeight;
  let floatTop = stampMetrics.boxY - zoneGap - floatBlockH;
  if (floatTop < padding) floatTop = padding;

  drawFloatingText(ctx, floatLines, padding, floatTop, fontSize, lineHeight);
  drawStampBox(ctx, proof, logoImg, stampMetrics, padding, fontSize, lineHeight, logoGap, innerMaxW);
}

export function loadImageForCanvas(url: string): Promise<HTMLImageElement | null> {
  return (async () => {
    try {
      const resp = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      return new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        };
        img.src = objectUrl;
      });
    } catch {
      return null;
    }
  })();
}
