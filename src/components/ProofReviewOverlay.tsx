import { useMemo, type CSSProperties } from 'react';
import type { ProofSnapshot } from '../lib/proofWatermarkDraw';
import {
  computeStampLayout,
  createMeasureContext,
  type StampSegment,
} from '../lib/proofStampLayout';

const FALLBACK_FRAME_WIDTH = 360;
const FALLBACK_FRAME_HEIGHT = 640;

interface Props {
  proof: ProofSnapshot;
  className?: string;
  frameWidth?: number;
  frameHeight?: number;
}

function segmentClassName(seg: StampSegment): string {
  switch (seg.kind) {
    case 'user':
      return 'proof-font-user';
    case 'store':
      return 'proof-font-store';
    case 'task':
      return 'proof-font-task';
    case 'timestamp':
      return 'proof-ts-time';
    case 'sep':
      return 'proof-stamp-sep';
  }
}

export default function ProofReviewOverlay({
  proof,
  className = '',
  frameWidth,
  frameHeight,
}: Props) {
  const fw = frameWidth && frameWidth > 0 ? frameWidth : FALLBACK_FRAME_WIDTH;
  const fh = frameHeight && frameHeight > 0 ? frameHeight : FALLBACK_FRAME_HEIGHT;

  const layout = useMemo(() => {
    const measureCtx = createMeasureContext();
    return computeStampLayout({
      frameWidth: fw,
      frameHeight: fh,
      proof,
      logoImg: null,
      measureCtx,
    });
  }, [fw, fh, proof]);

  const showLogo =
    proof.cameraOptionsSnapshot.logoEnabled && proof.proofLogoUrl.trim().length > 0;

  const rootStyle = layout.cssVars as CSSProperties;
  const hasContent = showLogo || layout.inlineRow.segments.length > 0;

  return (
    <div
      className={`proof-overlay-root${className ? ` ${className}` : ''}`}
      style={rootStyle}
      aria-hidden="true"
    >
      <div className="proof-floating-lines">
        {proof.locationLine && (
          <div className="proof-ts-location proof-ts-detail">{proof.locationLine}</div>
        )}
        {proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine && (
          <div className="proof-ts-weather proof-ts-detail">{proof.weatherLine}</div>
        )}
      </div>
      {hasContent && (
        <div className="proof-stamp-box">
          <div className="proof-stamp-row proof-stamp-row-inline">
            {showLogo && (
              <img
                className="proof-ts-logo"
                src={proof.proofLogoUrl}
                alt=""
                aria-hidden="true"
              />
            )}
            {layout.inlineRow.segments.map((seg, i) => (
              <span key={`${seg.kind}-${i}`} className={segmentClassName(seg)}>
                {seg.text}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
