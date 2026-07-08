import { useMemo } from 'react';
import { useLang } from '../i18n';
import { formatWeatherLine } from '../lib/cameraSettings';
import { isVideoMedia } from '../lib/mediaMime';
import type { MediaRecord, ProofWeather } from '../types';

interface Props {
  media: MediaRecord;
}

interface ParsedProofMeta {
  proofTimestamp?: string;
  proofLocation?: string;
  proofWeather?: ProofWeather | null;
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
    const acc = media.accuracy ? ` (±${Math.round(media.accuracy)}m)` : '';
    return `${media.lat.toFixed(5)}, ${media.lng.toFixed(5)}${acc}`;
  }
  return '';
}

export default function ProofMediaDetails({ media }: Props) {
  const { t } = useLang();

  const details = useMemo(() => {
    const meta = parseProofMetadata(media.proofMetadataJson);
    const timestamp = meta.proofTimestamp || media.capturedAt?.slice(0, 19) || '';
    const location =
      meta.proofLocation?.trim() ||
      media.address?.trim() ||
      formatGpsLine(media) ||
      '';
    const weather =
      meta.proofWeather && formatWeatherLine(meta.proofWeather)
        ? formatWeatherLine(meta.proofWeather)
        : '';
    const gpsOnly =
      !meta.proofLocation?.trim() && !media.address?.trim() && formatGpsLine(media)
        ? formatGpsLine(media)
        : '';
    const accuracy =
      media.accuracy > 0 ? `±${Math.round(media.accuracy)}m` : '';

    return { timestamp, location, weather, gpsOnly, accuracy };
  }, [media]);

  if (!isVideoMedia(media.mimeType, media.fileName)) return null;

  return (
    <div className="proof-media-details">
      {media.photoCode && (
        <div className="proof-media-details-row">
          <span className="proof-media-details-label">{t.common.photoCode}</span>
          <span className="proof-photo-code">{media.photoCode}</span>
        </div>
      )}
      {details.timestamp && (
        <div className="proof-media-details-row">
          <span className="proof-media-details-label">{t.proofDetails.timestamp}</span>
          <span>{details.timestamp}</span>
        </div>
      )}
      {details.location && (
        <div className="proof-media-details-row">
          <span className="proof-media-details-label">{t.proofDetails.proofLocation}</span>
          <span>{details.location}</span>
        </div>
      )}
      {details.gpsOnly && details.location !== details.gpsOnly && (
        <div className="proof-media-details-row">
          <span className="proof-media-details-label">{t.proofDetails.gpsCoords}</span>
          <span>{details.gpsOnly}</span>
        </div>
      )}
      {details.accuracy && details.location && !details.location.includes('±') && (
        <div className="proof-media-details-row">
          <span className="proof-media-details-label">{t.proofDetails.gpsAccuracy}</span>
          <span>{details.accuracy}</span>
        </div>
      )}
      {details.weather && (
        <div className="proof-media-details-row">
          <span className="proof-media-details-label">{t.proofDetails.proofWeather}</span>
          <span>{details.weather}</span>
        </div>
      )}
      {media.captureMode && (
        <div className="proof-media-details-row">
          <span className="proof-media-details-label">{t.proofDetails.captureMode}</span>
          <span>{media.captureMode}</span>
        </div>
      )}
      {media.watermarked && (
        <div className="proof-media-details-row">
          <span className="badge good">{t.proofDetails.watermarkedYes}</span>
        </div>
      )}
    </div>
  );
}
