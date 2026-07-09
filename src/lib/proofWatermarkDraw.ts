import { resolveWatermarkStyle } from './cameraSettings';
import { CHARCOAL_STROKE, GOLD_FILL, PROOF_FONT } from './proofFonts';
import { computeStampLayout, createMeasureContext } from './proofStampLayout';
import type { StampLayoutResult, StampSegmentKind } from './proofStampLayout';
import type { CameraOptions, ProofWeather, WatermarkStyle } from '../types';

export interface ProofSnapshot {
  capturedAt: string;
  displayTime: string;
  proofTimezone: string;
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

type TextDrawVariant = 'boxed' | 'floating';

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
  variant: TextDrawVariant = 'boxed',
) {
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, fontSize * 0.12);
  ctx.strokeStyle = CHARCOAL_STROKE;
  ctx.fillStyle = fillColor;
  const baseBlur = Math.max(4, fontSize * 0.35);
  if (variant === 'floating') {
    ctx.shadowColor = 'rgba(58, 58, 76, 0.85)';
    ctx.shadowBlur = baseBlur * 1.15;
  } else {
    ctx.shadowColor = 'rgba(58, 58, 76, 0.75)';
    ctx.shadowBlur = baseBlur;
  }
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
    case 'user':
      return { size: fonts.user, font: PROOF_FONT.user };
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
  variant: TextDrawVariant,
) {
  let cursorY = layout.floating.top;
  for (const line of layout.floating.lines) {
    const baseline = cursorY + layout.lineHeight * 0.75;
    drawGoldOutlinedText(ctx, line, margin, baseline, layout.fonts.detail, PROOF_FONT.detail, GOLD_FILL, variant);
    cursorY += layout.lineHeight;
  }
}

function drawStampBackground(ctx: CanvasRenderingContext2D, layout: StampLayoutResult) {
  const { box, fonts } = layout;
  const radius = Math.max(6, Math.round(fonts.task * 0.35));
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  fillRoundedRect(ctx, box.x, box.y, box.w, box.h, radius);
}

function drawStampContent(
  ctx: CanvasRenderingContext2D,
  logoImg: HTMLImageElement | null,
  layout: StampLayoutResult,
  variant: TextDrawVariant,
) {
  const { box, paddingH, fonts, logo } = layout;
  const contentX = box.x + paddingH;

  if (logo.show && logoImg) {
    const logoY = box.y + (box.h - logo.h) / 2;
    ctx.shadowColor = 'rgba(58, 58, 76, 0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.drawImage(logoImg, contentX, logoY, logo.w, logo.h);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  if (layout.inlineRow.segments.length) {
    const maxFontSize = Math.max(fonts.user, fonts.store, fonts.task, fonts.timestamp);
    const baseline = box.y + box.h / 2 + maxFontSize * 0.35;
    let segX = contentX + (logo.show ? logo.w + logo.gap : 0);
    for (const seg of layout.inlineRow.segments) {
      const { size, font } = segmentStyle(seg.kind, fonts);
      drawGoldOutlinedText(ctx, seg.text, segX, baseline, size, font, GOLD_FILL, variant);
      ctx.font = `${size}px ${font}`;
      segX += ctx.measureText(seg.text).width;
    }
  }
}

function drawLogoDock(
  ctx: CanvasRenderingContext2D,
  logoImg: HTMLImageElement | null,
  layout: StampLayoutResult,
) {
  const dock = layout.logoDock;
  if (!dock) return;

  const variant: TextDrawVariant = 'floating';
  const { logoBox, textColumn, detailLines, detailGap } = dock;
  const { fonts, logo } = layout;

  if (logo.show && logoBox.w > 0 && logoBox.h > 0) {
    const radius = Math.max(6, Math.round(fonts.task * 0.35));
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    fillRoundedRect(ctx, logoBox.x, logoBox.y, logoBox.w, logoBox.h, radius);

    if (logoImg) {
      const logoX = logoBox.x + (logoBox.w - logo.w) / 2;
      const logoY = logoBox.y + (logoBox.h - logo.h) / 2;
      ctx.shadowColor = 'rgba(58, 58, 76, 0.6)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 3;
      ctx.drawImage(logoImg, logoX, logoY, logo.w, logo.h);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  if (layout.inlineRow.segments.length) {
    const maxFontSize = Math.max(fonts.user, fonts.store, fonts.task, fonts.timestamp);
    const baseline = textColumn.y + maxFontSize * 0.85;
    let segX = textColumn.x;
    for (const seg of layout.inlineRow.segments) {
      const { size, font } = segmentStyle(seg.kind, fonts);
      drawGoldOutlinedText(ctx, seg.text, segX, baseline, size, font, GOLD_FILL, variant);
      ctx.font = `${size}px ${font}`;
      segX += ctx.measureText(seg.text).width;
    }
  }

  let cursorY = textColumn.y + layout.inlineRow.height + detailGap;
  for (const line of detailLines) {
    const baseline = cursorY + layout.lineHeight * 0.75;
    drawGoldOutlinedText(
      ctx,
      line,
      textColumn.x,
      baseline,
      fonts.detail,
      PROOF_FONT.detail,
      GOLD_FILL,
      variant,
    );
    cursorY += layout.lineHeight;
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

  const watermarkStyle: WatermarkStyle = resolveWatermarkStyle(proof.cameraOptionsSnapshot);

  if (watermarkStyle === 'logoDock') {
    drawLogoDock(ctx, logoImg, layout);
    return;
  }

  if (watermarkStyle === 'blackBoxInline') {
    drawStampBackground(ctx, layout);
    drawStampContent(ctx, logoImg, layout, 'boxed');
    return;
  }

  const textVariant: TextDrawVariant = watermarkStyle === 'transparentFloating' ? 'floating' : 'boxed';

  drawFloatingText(ctx, layout, layout.margin, textVariant);
  if (watermarkStyle === 'blackBox') {
    drawStampBackground(ctx, layout);
  }
  drawStampContent(ctx, logoImg, layout, textVariant);
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
