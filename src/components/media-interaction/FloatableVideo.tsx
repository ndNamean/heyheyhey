import type { ReactNode, Ref } from 'react';
import { useVideoFloat } from './useVideoFloat';
import './mediaInteraction.css';

type Props = {
  children: ReactNode;
  enableFloat?: boolean;
  className?: string;
  resetKey?: string;
};

export default function FloatableVideo({
  children,
  enableFloat = true,
  className = '',
  resetKey,
}: Props) {
  const float = useVideoFloat({ enabled: enableFloat, resetKey });

  return (
    <div
      ref={float.rootRef as Ref<HTMLDivElement>}
      className={`media-float${className ? ` ${className}` : ''}`}
      data-float-state={float.state}
      data-float-enabled={enableFloat ? 'true' : 'false'}
      data-reduced-motion={float.reducedMotion ? 'true' : 'false'}
      data-will-change={float.willChange ? 'true' : 'false'}
      data-float-frozen={float.frozen ? 'true' : 'false'}
      data-playback-owner={float.playbackOwner}
      data-fine-hover={float.fineHover ? 'true' : 'false'}
      onPointerEnter={float.bind.onPointerEnter}
      onPointerMove={float.bind.onPointerMove}
      onPointerLeave={float.bind.onPointerLeave}
      onKeyDown={float.bind.onKeyDown}
    >
      <div className="media-float__glow" aria-hidden="true" />
      <div className="media-float__lift">{children}</div>
    </div>
  );
}
