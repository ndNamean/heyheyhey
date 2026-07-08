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

type FloatTier = 'ident' | 'user' | 'detail';

interface FloatingLine {
  text: string;
  tier: FloatTier;
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

function tierFontSize(base: number, tier: FloatTier): number {
  if (tier === 'user') return Math.round(base * 1.22);
  if (tier === 'ident') return Math.round(base * 1.08);
  return base;
}

function tierLineHeight(baseLineHeight: number, tier: FloatTier): number {
  if (tier === 'user') return Math.round(baseLineHeight * 1.15);
  if (tier === 'ident') return Math.round(baseLineHeight * 1.05);
  return baseLineHeight;
}

function buildFloatingProofLines(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  maxWidth: number,
  baseFontSize: number,
): FloatingLine[] {
  const result: FloatingLine[] = [];

  const addField = (text: string, tier: FloatTier) => {
    const size = tierFontSize(baseFontSize, tier);
    ctx.font = `${size}px Arial`;
    for (const line of wrapText(ctx, text, maxWidth)) {
      result.push({ text: line, tier });
    }
  };

  if (proof.storeCode.trim()) addField(proof.storeCode, 'ident');
  if (proof.itemTitle.trim()) addField(proof.itemTitle, 'ident');
  if (proof.userName.trim()) addField(proof.userName, 'user');

  ctx.font = `${baseFontSize}px Arial`;
  for (const line of capWrappedLines(wrapText(ctx, proof.locationLine, maxWidth), 4)) {
    result.push({ text: line, tier: 'detail' });
  }

  if (proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine.trim()) {
    ctx.font = `${baseFontSize}px Arial`;
    for (const line of wrapText(ctx, proof.weatherLine, maxWidth)) {
      result.push({ text: line, tier: 'detail' });
    }
  }

  return result;
}

function floatingBlockHeight(lines: FloatingLine[], baseLineHeight: number): number {
  return lines.reduce((sum, line) => sum + tierLineHeight(baseLineHeight, line.tier), 0);
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

function computeStampMetrics(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
  padding: number,
  fontSize: number,
  lineHeight: number,
  logoMaxW: number,
  logoGap: number,
  canvasH: number,
): StampMetrics {
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

  ctx.font = `${fontSize}px Arial`;
  const tsW = ctx.measureText(proof.displayTime).width;
  const innerW = (logoDrawW > 0 ? logoDrawW + logoGap : 0) + tsW;
  const innerH = Math.max(logoDrawH, lineHeight);
  const boxW = padding * 2 + innerW;
  const boxH = padding * 2 + innerH;
  const boxX = padding;
  const boxY = canvasH - padding - boxH;

  return { boxX, boxY, boxW, boxH, logoDrawW, logoDrawH };
}

function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
) {
  ctx.font = `${fontSize}px Arial`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, fontSize * 0.12);
  ctx.strokeStyle = NAVY_STROKE;
  ctx.fillStyle = '#FFFFFF';
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
  lines: FloatingLine[],
  x: number,
  y: number,
  baseFontSize: number,
  baseLineHeight: number,
) {
  let cursorY = y;

  for (const line of lines) {
    const size = tierFontSize(baseFontSize, line.tier);
    const lh = tierLineHeight(baseLineHeight, line.tier);
    const baseline = cursorY + lh * 0.75;
    drawOutlinedText(ctx, line.text, x, baseline, size);
    cursorY += lh;
  }
}

function drawStampBox(
  ctx: CanvasRenderingContext2D,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
  metrics: StampMetrics,
  padding: number,
  fontSize: number,
  lineHeight: number,
  logoGap: number,
) {
  const radius = Math.max(6, Math.round(fontSize * 0.35));
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  fillRoundedRect(ctx, metrics.boxX, metrics.boxY, metrics.boxW, metrics.boxH, radius);

  let contentX = metrics.boxX + padding;
  const midY = metrics.boxY + metrics.boxH / 2;

  if (logoImg && metrics.logoDrawW > 0) {
    const logoY = midY - metrics.logoDrawH / 2;
    ctx.shadowColor = 'rgba(58, 58, 76, 0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(logoImg, contentX, logoY, metrics.logoDrawW, metrics.logoDrawH);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    contentX += metrics.logoDrawW + logoGap;
  }

  ctx.font = `${fontSize}px Arial`;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'transparent';
  ctx.fillText(proof.displayTime, contentX, midY + fontSize * 0.35);
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

  ctx.font = `${fontSize}px Arial`;

  const stampMetrics = computeStampMetrics(
    ctx,
    proof,
    logoImg,
    padding,
    fontSize,
    lineHeight,
    logoMaxW,
    logoGap,
    canvas.height,
  );

  const floatMaxWidth = canvas.width - padding * 2;
  const floatLines = buildFloatingProofLines(ctx, proof, floatMaxWidth, fontSize);
  const floatBlockH = floatingBlockHeight(floatLines, lineHeight);
  let floatTop = stampMetrics.boxY - zoneGap - floatBlockH;
  if (floatTop < padding) floatTop = padding;

  drawFloatingText(ctx, floatLines, padding, floatTop, fontSize, lineHeight);
  drawStampBox(ctx, proof, logoImg, stampMetrics, padding, fontSize, lineHeight, logoGap);
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
