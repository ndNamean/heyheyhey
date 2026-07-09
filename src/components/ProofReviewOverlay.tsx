import { useMemo, type CSSProperties } from 'react';
import { resolveWatermarkStyle } from '../lib/cameraSettings';
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

  const watermarkStyle = resolveWatermarkStyle(proof.cameraOptionsSnapshot);
  const isLogoDock = watermarkStyle === 'logoDock';
  const isProofStrip = watermarkStyle === 'blackBoxInline';
  const showFloatingLines = !isLogoDock && !isProofStrip;
  const detailLines = layout.logoDock?.detailLines ?? [];
  const rootStyle = layout.cssVars as CSSProperties;
  const hasContent = isLogoDock
    ? showLogo || layout.inlineRow.segments.length > 0 || detailLines.length > 0
    : showLogo || layout.inlineRow.segments.length > 0;

  const inlineSegments = layout.inlineRow.segments.map((seg, i) => (
    <span key={`${seg.kind}-${i}`} className={segmentClassName(seg)}>
      {seg.text}
    </span>
  ));

  return (
    <div
      className={`proof-overlay-root${className ? ` ${className}` : ''}`}
      style={rootStyle}
      aria-hidden="true"
    >
      {showFloatingLines && (
        <div className="proof-floating-lines">
          {proof.locationLine && (
            <div className="proof-ts-location proof-ts-detail">{proof.locationLine}</div>
          )}
          {proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine && (
            <div className="proof-ts-weather proof-ts-detail">{proof.weatherLine}</div>
          )}
        </div>
      )}
      {hasContent &&
        (isLogoDock ? (
          <div className="proof-logo-dock">
            {showLogo && (
              <div className="proof-logo-dock-box">
                <img
                  className="proof-ts-logo"
                  src={proof.proofLogoUrl}
                  alt=""
                  aria-hidden="true"
                />
              </div>
            )}
            <div className="proof-logo-dock-text">
              {layout.inlineRow.segments.length > 0 && (
                <div className="proof-stamp-row proof-stamp-row-inline">{inlineSegments}</div>
              )}
              {detailLines.map((line, i) => (
                <div key={`dock-detail-${i}`} className="proof-ts-detail">
                  {line}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            className={`proof-stamp-box${
              watermarkStyle === 'transparentFloating' ? ' proof-stamp--transparent-floating' : ''
            }${isProofStrip ? ' proof-stamp--proof-strip' : ''}`}
          >
            <div className="proof-stamp-row proof-stamp-row-inline">
              {showLogo && (
                <img
                  className="proof-ts-logo"
                  src={proof.proofLogoUrl}
                  alt=""
                  aria-hidden="true"
                />
              )}
              {inlineSegments}
            </div>
          </div>
        ))}
    </div>
  );
}
