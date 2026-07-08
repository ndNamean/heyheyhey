import { CHARCOAL_STROKE, GOLD_FILL, PROOF_FONT } from './proofFonts';
import { computeStampLayout, createMeasureContext } from './proofStampLayout';
import type { StampLayoutResult, StampSegmentKind } from './proofStampLayout';
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
  ctx.strokeStyle = CHARCOAL_STROKE;
  ctx.fillStyle = fillColor;
  ctx.shadowColor = 'rgba(58, 58, 76, 0.75)';
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

function segmentStyle(kind: StampSegmentKind, fonts: StampLayoutResult['fonts']) {
  switch (kind) {
    case 'store':
      return { size: fonts.store, font: PROOF_FONT.store };
    case 'task':
      return { size: fonts.task, font: PROOF_FONT.task };
    case 'timestamp':
    case 'sep':
      return { size: fonts.timestamp, font: PROOF_FONT.timestamp };
  }
}

function drawFloatingText(
  ctx: CanvasRenderingContext2D,
  layout: StampLayoutResult,
  margin: number,
) {
  let cursorY = layout.floating.top;
  for (const line of layout.floating.lines) {
    const baseline = cursorY + layout.lineHeight * 0.75;
    drawGoldOutlinedText(ctx, line, margin, baseline, layout.fonts.detail, PROOF_FONT.detail);
    cursorY += layout.lineHeight;
  }
}

function drawStampBox(
  ctx: CanvasRenderingContext2D,
  logoImg: HTMLImageElement | null,
  layout: StampLayoutResult,
) {
  const { box, padding, rowGap, fonts, logo } = layout;
  const radius = Math.max(6, Math.round(fonts.task * 0.35));
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  fillRoundedRect(ctx, box.x, box.y, box.w, box.h, radius);

  const contentX = box.x + padding;
  let cursorY = box.y + padding;

  if (logo.show && logoImg) {
    ctx.shadowColor = 'rgba(58, 58, 76, 0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(logoImg, contentX, cursorY, logo.w, logo.h);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  const userX = contentX + (logo.show ? logo.w + logo.gap : 0);
  if (layout.row1.userLines.length) {
    const userBaseline = cursorY + fonts.user * 0.85;
    drawGoldOutlinedText(
      ctx,
      layout.row1.userLines[0]!,
      userX,
      userBaseline,
      fonts.user,
      PROOF_FONT.user,
    );
  }

  cursorY += layout.row1H;

  if (layout.row2.segments.length) {
    cursorY += rowGap;
    const rowBaseline = cursorY + Math.max(fonts.store, fonts.task, fonts.timestamp) * 0.85;
    let segX = contentX;
    for (const seg of layout.row2.segments) {
      const { size, font } = segmentStyle(seg.kind, fonts);
      drawGoldOutlinedText(ctx, seg.text, segX, rowBaseline, size, font);
      ctx.font = `${size}px ${font}`;
      segX += ctx.measureText(seg.text).width;
    }
    cursorY += layout.row2H;
  }

  if (layout.row3.timestampLine) {
    cursorY += rowGap;
    drawGoldOutlinedText(
      ctx,
      layout.row3.timestampLine,
      contentX,
      cursorY + fonts.timestamp * 0.85,
      fonts.timestamp,
      PROOF_FONT.timestamp,
    );
  }
}

export function drawProofOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  proof: ProofSnapshot,
  logoImg: HTMLImageElement | null,
) {
  const measureCtx = createMeasureContext();
  const layout = computeStampLayout({
    frameWidth: canvas.width,
    frameHeight: canvas.height,
    proof,
    logoImg,
    measureCtx,
  });

  drawFloatingText(ctx, layout, layout.margin);
  drawStampBox(ctx, logoImg, layout);
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
