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
  logoImg?: HTMLImageElement | null;
  layoutKey?: number;
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

function renderSegments(segments: StampSegment[]) {
  return segments.map((seg, i) => (
    <span key={`${seg.kind}-${i}`} className={segmentClassName(seg)}>
      {seg.text}
    </span>
  ));
}

export default function ProofReviewOverlay({
  proof,
  className = '',
  frameWidth,
  frameHeight,
  logoImg = null,
  layoutKey = 0,
}: Props) {
  const fw = frameWidth && frameWidth > 0 ? frameWidth : FALLBACK_FRAME_WIDTH;
  const fh = frameHeight && frameHeight > 0 ? frameHeight : FALLBACK_FRAME_HEIGHT;

  const layout = useMemo(() => {
    const measureCtx = createMeasureContext();
    return computeStampLayout({
      frameWidth: fw,
      frameHeight: fh,
      proof,
      logoImg,
      measureCtx,
    });
  }, [fw, fh, proof, logoImg, layoutKey]);

  const showLogo =
    proof.cameraOptionsSnapshot.logoEnabled && proof.proofLogoUrl.trim().length > 0;

  const watermarkStyle = resolveWatermarkStyle(proof.cameraOptionsSnapshot);
  const isLogoDock = watermarkStyle === 'logoDock';
  const isProofStrip = watermarkStyle === 'blackBoxInline';
  const isUltimate = watermarkStyle === 'ultimate_custom';
  const isTimecard = watermarkStyle === 'timecard_stamp';
  const showFloatingLines = !isLogoDock && !isProofStrip && !isUltimate && !isTimecard;
  const detailLines = layout.logoDock?.detailLines ?? [];
  const ultimate = layout.ultimate;
  const timecard = layout.timecard;
  const rootStyle = {
    ...(layout.cssVars as CSSProperties),
    '--stamp-margin': `${layout.margin}px`,
  } as CSSProperties;
  const hasContent = isTimecard
    ? !!timecard &&
      (timecard.logo.show ||
        timecard.card.w > 0 ||
        timecard.showTime ||
        timecard.metaLines.length > 0 ||
        timecard.detailLines.length > 0 ||
        !!timecard.photoCodeLine)
    : isUltimate
    ? !!ultimate &&
      (ultimate.boxEnabled ||
        ultimate.boxInline.length > 0 ||
        ultimate.boxDetailLines.length > 0 ||
        ultimate.floatInline.length > 0 ||
        ultimate.floatDetailLines.length > 0 ||
        (ultimate.boxHasLogo && showLogo))
    : isLogoDock
      ? showLogo || layout.inlineRow.segments.length > 0 || detailLines.length > 0
      : showLogo || layout.inlineRow.segments.length > 0;

  const inlineSegments = renderSegments(layout.inlineRow.segments);

  const ultimateGradientStyle =
    ultimate?.gradientEnabled && ultimate.gradientCss
      ? ({ '--ultimate-gradient': ultimate.gradientCss } as CSSProperties)
      : undefined;

  if (isTimecard && timecard) {
    const cardClass =
      timecard.backgroundMode === 'gradient'
        ? 'proof-timecard-card proof-timecard-card--gradient'
        : timecard.backgroundMode === 'solid'
          ? 'proof-timecard-card proof-timecard-card--solid'
          : 'proof-timecard-card proof-timecard-card--frosted';

    return (
      <div
        className={`proof-overlay-root${className ? ` ${className}` : ''}`}
        style={rootStyle}
        aria-hidden="true"
      >
        <div className="proof-timecard">
          {timecard.logo.show && showLogo && (
            <img
              className="proof-timecard-logo"
              src={proof.proofLogoUrl}
              alt=""
              aria-hidden="true"
            />
          )}
          {timecard.card.w > 0 && (
            <div className={cardClass}>
              {(timecard.showTime || timecard.showDate || timecard.showDay) && (
                <div className="proof-timecard-primary">
                  {timecard.showTime && (
                    <span className="proof-timecard-time">{timecard.timeText}</span>
                  )}
                  {timecard.showAccent && <span className="proof-timecard-accent" />}
                  {(timecard.showDate || timecard.showDay) && (
                    <div className="proof-timecard-date-block">
                      {timecard.showDate && (
                        <span className="proof-timecard-date">{timecard.dateText}</span>
                      )}
                      {timecard.showDay && (
                        <span className="proof-timecard-day">{timecard.dayText}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {timecard.metaLines.map((line, i) => (
                <div key={`tc-meta-${i}`} className="proof-timecard-meta">
                  {line}
                </div>
              ))}
              {timecard.detailLines.map((line, i) => (
                <div key={`tc-detail-${i}`} className="proof-timecard-detail">
                  {line}
                </div>
              ))}
              {timecard.photoCodeLine && (
                <div className="proof-timecard-photo-code">{timecard.photoCodeLine}</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isUltimate && ultimate) {
    const floatSegments = renderSegments(ultimate.floatInline);
    const boxSegments = renderSegments(ultimate.boxInline);

    return (
      <div
        className={`proof-overlay-root${className ? ` ${className}` : ''}`}
        style={rootStyle}
        aria-hidden="true"
      >
        {ultimate.layoutMode === 'strip' &&
          (ultimate.floatDetailLines.length > 0 || ultimate.floatInline.length > 0) && (
            <div className="proof-floating-lines proof-ultimate-float">
              {ultimate.floatDetailLines.map((line, i) => (
                <div key={`uf-${i}`} className="proof-ts-detail">
                  {line}
                </div>
              ))}
              {ultimate.floatInline.length > 0 && (
                <div className="proof-stamp-row proof-stamp-row-inline">{floatSegments}</div>
              )}
            </div>
          )}

        {hasContent &&
          (ultimate.layoutMode === 'logo_dock' && ultimate.boxEnabled ? (
            <div className="proof-logo-dock">
              {ultimate.logoBox && (ultimate.boxHasLogo || ultimate.boxInline.length > 0 || ultimate.boxDetailLines.length > 0) && (
                <div
                  className="proof-logo-dock-box proof-stamp--ultimate-box"
                  style={ultimateGradientStyle}
                >
                  {(ultimate.boxHasLogo || ultimate.boxInline.length > 0) && (
                    <div className="proof-stamp-row proof-stamp-row-inline">
                      {ultimate.boxHasLogo && showLogo && (
                        <img
                          className="proof-ts-logo"
                          src={proof.proofLogoUrl}
                          alt=""
                          aria-hidden="true"
                        />
                      )}
                      {boxSegments}
                    </div>
                  )}
                  {ultimate.boxDetailLines.map((line, i) => (
                    <div key={`ub-${i}`} className="proof-ts-detail">
                      {line}
                    </div>
                  ))}
                </div>
              )}
              <div className="proof-logo-dock-text">
                {ultimate.floatInline.length > 0 && (
                  <div className="proof-stamp-row proof-stamp-row-inline">{floatSegments}</div>
                )}
                {ultimate.floatDetailLines.map((line, i) => (
                  <div key={`ufd-${i}`} className="proof-ts-detail">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ) : ultimate.boxEnabled && ultimate.box.w > 0 ? (
            <div
              className="proof-stamp-box proof-stamp--ultimate proof-stamp--proof-strip"
              style={ultimateGradientStyle}
            >
              <div className="proof-stamp-row proof-stamp-row-inline">
                {ultimate.boxHasLogo && showLogo && (
                  <img
                    className="proof-ts-logo"
                    src={proof.proofLogoUrl}
                    alt=""
                    aria-hidden="true"
                  />
                )}
                {boxSegments}
              </div>
              {ultimate.boxDetailLines.map((line, i) => (
                <div key={`ub-${i}`} className="proof-ts-detail">
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <div className="proof-ultimate-float-only proof-floating-lines">
              {ultimate.floatDetailLines.map((line, i) => (
                <div key={`uf-${i}`} className="proof-ts-detail">
                  {line}
                </div>
              ))}
              {ultimate.floatInline.length > 0 && (
                <div className="proof-stamp-row proof-stamp-row-inline">{floatSegments}</div>
              )}
            </div>
          ))}
      </div>
    );
  }

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
