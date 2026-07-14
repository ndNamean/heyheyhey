import { DEFAULT_CAMERA_OPTIONS, formatWeatherLine } from './cameraSettings';
import {
  formatMediaCaptureTime,
  parseProofMetadata,
} from './proofTime';
import type { ProofSnapshot } from './proofWatermarkDraw';
import type { CameraOptions, MediaRecord } from '../types';

export interface ReviewContext {
  storeCode?: string;
  itemTitle?: string;
  userName?: string;
  watermarked?: boolean;
}

function formatGpsLine(media: MediaRecord): string {
  if (media.lat || media.lng) {
    const acc = media.accuracy > 0 ? ` (±${Math.round(media.accuracy)}m)` : '';
    return `${media.lat.toFixed(5)}, ${media.lng.toFixed(5)}${acc}`;
  }
  return '';
}

function hasLegacyOverlayData(media: MediaRecord, meta: ReturnType<typeof parseProofMetadata>): boolean {
  const hasTimestamp = !!(meta.proofTimestamp || media.capturedAt);
  const hasLocation =
    !!(meta.proofLocation?.trim() || media.address?.trim() || formatGpsLine(media));
  const hasWeather = !!(meta.proofWeather && formatWeatherLine(meta.proofWeather));
  return hasTimestamp || hasLocation || hasWeather;
}

export function isWatermarkedMedia(
  media: MediaRecord,
  context?: ReviewContext,
): boolean {
  const meta = parseProofMetadata(media.proofMetadataJson);
  return (
    media.watermarked === true ||
    context?.watermarked === true ||
    (meta.cameraOptionsSnapshot as CameraOptions & { watermarkEmbedded?: boolean })
      ?.watermarkEmbedded === true ||
    meta.proofWatermarkEmbedded === true
  );
}

export function shouldRenderReviewOverlay(
  media: MediaRecord,
  report?: ReviewContext,
): boolean {
  if (isWatermarkedMedia(media, report)) return false;
  const meta = parseProofMetadata(media.proofMetadataJson);
  return hasLegacyOverlayData(media, meta);
}

export function buildReviewProofSnapshot(
  media: MediaRecord,
  context?: ReviewContext,
): ProofSnapshot {
  const meta = parseProofMetadata(media.proofMetadataJson);
  const cameraOptionsSnapshot = meta.cameraOptionsSnapshot ?? { ...DEFAULT_CAMERA_OPTIONS };

  const displayTime = formatMediaCaptureTime(media);

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
    proofTimezone: meta.proofTimezone?.trim() ?? '',
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
    photoCode: media.photoCode?.trim() || undefined,
  };
}
