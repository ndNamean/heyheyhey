import type { ReactNode, Ref } from 'react';
import { useImageZoom } from './useImageZoom';
import './mediaInteraction.css';

type Props = {
  children: ReactNode;
  alt: string;
  ariaLabel?: string;
  className?: string;
  resetKey?: string;
  /** Default true for checkbox-label. Chat passes false so swipe/long-press still see pointerdown. */
  stopPointerDownPropagation?: boolean;
};

export default function ZoomableImage({
  children,
  alt,
  ariaLabel,
  className = '',
  resetKey,
  stopPointerDownPropagation = true,
}: Props) {
  const zoom = useImageZoom({ resetKey });
  const label = ariaLabel || `Zoom image: ${alt}`;

  return (
    <button
      ref={zoom.viewportRef as Ref<HTMLButtonElement>}
      type="button"
      className={`media-zoom${className ? ` ${className}` : ''}`}
      aria-label={label}
      data-zoom-state={zoom.state}
      data-reduced-motion={zoom.reducedMotion ? 'true' : 'false'}
      data-will-change={zoom.willChange ? 'true' : 'false'}
      data-fine-hover={zoom.fineHover ? 'true' : 'false'}
      onPointerEnter={zoom.bind.onPointerEnter}
      onPointerMove={zoom.bind.onPointerMove}
      onPointerLeave={zoom.bind.onPointerLeave}
      onPointerDown={(event) => {
        if (stopPointerDownPropagation) event.stopPropagation();
        zoom.bind.onPointerDown(event);
      }}
      onPointerUp={zoom.bind.onPointerUp}
      onClick={zoom.bind.onClick}
      onKeyDown={zoom.bind.onKeyDown}
    >
      <span className="media-zoom__content">{children}</span>
    </button>
  );
}
