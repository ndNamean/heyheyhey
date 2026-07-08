import tzlookup from 'tz-lookup';
import type { MediaRecord, ProofMetadata } from '../types';

export const PROOF_TIME_LOCALE = 'en-GB';

export type ParsedProofMeta = Partial<ProofMetadata> & {
  proofWatermarkEmbedded?: boolean;
};

export function parseProofMetadata(raw?: string): ParsedProofMeta {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as ParsedProofMeta;
  } catch {
    return {};
  }
}

export function resolveCaptureTimezone(
  gps: { lat: number; lng: number } | null,
): string {
  if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
    try {
      return tzlookup(gps.lat, gps.lng);
    } catch {
      // Fall back to device timezone when lookup fails (e.g. ocean coords).
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatProofTime(at: Date, timeZone: string): string {
  return at.toLocaleString(PROOF_TIME_LOCALE, {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function buildProofTimeFields(
  at: Date,
  gps: { lat: number; lng: number } | null,
): {
  capturedAt: string;
  displayTime: string;
  proofTimezone: string;
} {
  const proofTimezone = resolveCaptureTimezone(gps);
  return {
    capturedAt: at.toISOString(),
    displayTime: formatProofTime(at, proofTimezone),
    proofTimezone,
  };
}

export function formatMediaCaptureTime(
  media: Pick<MediaRecord, 'capturedAt' | 'proofMetadataJson' | 'lat' | 'lng'>,
): string {
  const meta = parseProofMetadata(media.proofMetadataJson);
  if (meta.proofTimestamp?.trim()) {
    return meta.proofTimestamp.trim();
  }

  if (!media.capturedAt) return '';

  const at = new Date(media.capturedAt);
  if (Number.isNaN(at.getTime())) {
    return media.capturedAt.slice(0, 19).replace('T', ' ');
  }

  const timeZone = meta.proofTimezone?.trim() || resolveCaptureTimezone(
    media.lat || media.lng ? { lat: media.lat, lng: media.lng } : null,
  );
  return formatProofTime(at, timeZone);
}
