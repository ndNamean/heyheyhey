import { DEFAULT_CAMERA_OPTIONS, formatWeatherLine } from './cameraSettings';
import type { ProofSnapshot } from './proofWatermarkDraw';
import type { CameraOptions, MediaRecord, ProofWeather } from '../types';

export interface ReviewContext {
  storeCode?: string;
  itemTitle?: string;
  userName?: string;
  watermarked?: boolean;
}

interface ParsedProofMeta {
  proofTimestamp?: string;
  proofLocation?: string;
  proofWeather?: ProofWeather | null;
  proofLogoUrl?: string;
  cameraOptionsSnapshot?: CameraOptions;
  proofWatermarkEmbedded?: boolean;
}

function parseProofMetadata(raw?: string): ParsedProofMeta {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as ParsedProofMeta;
  } catch {
    return {};
  }
}

function formatGpsLine(media: MediaRecord): string {
  if (media.lat || media.lng) {
    const acc = media.accuracy > 0 ? ` (±${Math.round(media.accuracy)}m)` : '';
    return `${media.lat.toFixed(5)}, ${media.lng.toFixed(5)}${acc}`;
  }
  return '';
}

function hasLegacyOverlayData(media: MediaRecord, meta: ParsedProofMeta): boolean {
  const hasTimestamp = !!(meta.proofTimestamp || media.capturedAt);
  const hasLocation =
    !!(meta.proofLocation?.trim() || media.address?.trim() || formatGpsLine(media));
  const hasWeather = !!(meta.proofWeather && formatWeatherLine(meta.proofWeather));
  return hasTimestamp || hasLocation || hasWeather;
}

export function shouldRenderReviewOverlay(
  media: MediaRecord,
  report?: { watermarked?: boolean },
): boolean {
  const meta = parseProofMetadata(media.proofMetadataJson);
  const isAlreadyWatermarked =
    media.watermarked === true ||
    report?.watermarked === true ||
    (meta.cameraOptionsSnapshot as CameraOptions & { watermarkEmbedded?: boolean })
      ?.watermarkEmbedded === true ||
    meta.proofWatermarkEmbedded === true;

  if (isAlreadyWatermarked) return false;

  return hasLegacyOverlayData(media, meta);
}

export function buildReviewProofSnapshot(
  media: MediaRecord,
  context?: ReviewContext,
): ProofSnapshot {
  const meta = parseProofMetadata(media.proofMetadataJson);
  const cameraOptionsSnapshot = meta.cameraOptionsSnapshot ?? { ...DEFAULT_CAMERA_OPTIONS };

  const displayTime =
    meta.proofTimestamp?.trim() ||
    (media.capturedAt ? media.capturedAt.slice(0, 19).replace('T', ' ') : '');

  const locationLine =
    meta.proofLocation?.trim() ||
    media.address?.trim() ||
    formatGpsLine(media) ||
    '';

  const weatherLine =
    meta.proofWeather && formatWeatherLine(meta.proofWeather)
      ? formatWeatherLine(meta.proofWeather)
      : '';

  const gps =
    media.lat || media.lng
      ? { lat: media.lat, lng: media.lng, accuracy: media.accuracy ?? 0 }
      : null;

  return {
    capturedAt: media.capturedAt ?? '',
    displayTime,
    storeCode: context?.storeCode?.trim() ?? '',
    itemTitle: context?.itemTitle?.trim() ?? '',
    userName: context?.userName?.trim() ?? '',
    locationLine,
    gps,
    address: media.address?.trim() ?? '',
    weatherLine,
    proofWeather: meta.proofWeather ?? null,
    proofLogoUrl: meta.proofLogoUrl?.trim() ?? '',
    cameraOptionsSnapshot,
  };
}
