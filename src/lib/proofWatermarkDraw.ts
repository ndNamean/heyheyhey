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
): string[] {
  const result: string[] = [];
  for (const field of [proof.storeCode, proof.itemTitle, proof.userName]) {
    result.push(...wrapText(ctx, field, maxWidth));
  }
  result.push(...capWrappedLines(wrapText(ctx, proof.locationLine, maxWidth), 4));
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

function drawFloatingText(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
) {
  ctx.font = `${fontSize}px Arial`;
  ctx.fillStyle = '#FDC216';
  ctx.strokeStyle = 'rgba(255,245,180,0.7)';
  ctx.lineWidth = Math.max(1, fontSize * 0.08);
  ctx.shadowColor = 'rgba(0,0,0,0.92)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 5;
  ctx.lineJoin = 'round';

  lines.forEach((line, i) => {
    const ly = y + lineHeight * (i + 0.75);
    ctx.strokeText(line, x, ly);
    ctx.fillText(line, x, ly);
  });

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
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
    ctx.drawImage(logoImg, contentX, logoY, metrics.logoDrawW, metrics.logoDrawH);
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
  const floatLines = buildFloatingProofLines(ctx, proof, floatMaxWidth);
  const floatBlockH = floatLines.length * lineHeight;
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
