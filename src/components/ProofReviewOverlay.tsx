import type { ProofSnapshot } from '../lib/proofWatermarkDraw';

interface Props {
  proof: ProofSnapshot;
  className?: string;
}

export default function ProofReviewOverlay({ proof, className = '' }: Props) {
  const showLogo =
    proof.cameraOptionsSnapshot.logoEnabled && proof.proofLogoUrl.trim().length > 0;

  return (
    <div className={`proof-overlay-root${className ? ` ${className}` : ''}`} aria-hidden="true">
      <div className="proof-floating-lines">
        {proof.locationLine && (
          <div className="proof-ts-location proof-ts-detail">{proof.locationLine}</div>
        )}
        {proof.cameraOptionsSnapshot.weatherEnabled && proof.weatherLine && (
          <div className="proof-ts-weather proof-ts-detail">{proof.weatherLine}</div>
        )}
      </div>
      <div className="proof-stamp-box">
        <div className="proof-stamp-row-logo-time">
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
        {proof.userName && (
          <div className="proof-ts-user proof-font-user">{proof.userName}</div>
        )}
        {proof.storeCode && (
          <div className="proof-ts-store proof-font-store">{proof.storeCode}</div>
        )}
        {proof.itemTitle && (
          <div className="proof-ts-item proof-font-task">{proof.itemTitle}</div>
        )}
      </div>
    </div>
  );
}
