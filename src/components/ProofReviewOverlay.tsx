import { useMemo, type CSSProperties } from 'react';
import type { ProofSnapshot } from '../lib/proofWatermarkDraw';
import { computeStampLayout, createMeasureContext } from '../lib/proofStampLayout';

const FALLBACK_FRAME_WIDTH = 360;
const FALLBACK_FRAME_HEIGHT = 640;

interface Props {
  proof: ProofSnapshot;
  className?: string;
  frameWidth?: number;
  frameHeight?: number;
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
      <div className="proof-stamp-box">
        <div className="proof-stamp-row proof-stamp-row-logo-time">
          {showLogo && (
            <img
              className="proof-ts-logo"
              src={proof.proofLogoUrl}
              alt=""
              aria-hidden="true"
            />
          )}
          <div className="proof-ts-time">{proof.displayTime}</div>
        </div>
        {(proof.userName || proof.storeCode) && (
          <div
            className={`proof-stamp-row proof-stamp-row-identity${
              layout.row2.stacked ? ' proof-stamp-row-identity-stacked' : ''
            }`}
          >
            {proof.userName && (
              <span className="proof-font-user">{proof.userName}</span>
            )}
            {proof.storeCode && (
              <span className="proof-font-store">{proof.storeCode}</span>
            )}
          </div>
        )}
        {proof.itemTitle && (
          <div className="proof-stamp-row proof-stamp-row-task proof-font-task">
            {proof.itemTitle}
          </div>
        )}
      </div>
    </div>
  );
}
