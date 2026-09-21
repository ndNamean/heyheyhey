import { useLayoutEffect, useRef } from 'react';
import {
  createAmbientSampler,
  findAmbientMedia,
  type AmbientKind,
  type AmbientSampler,
} from './ambientSampler';

interface Props {
  active: boolean;
  kind: AmbientKind;
  reducedMotion: boolean;
  wrapperRef?: (el: HTMLDivElement | null) => void;
}

export default function CommunityDepthAmbient({
  active,
  kind,
  reducedMotion,
  wrapperRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const samplerRef = useRef<AmbientSampler | null>(null);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  useLayoutEffect(() => {
    samplerRef.current?.setReducedMotion(reducedRef.current);
  }, [reducedMotion]);

  useLayoutEffect(() => {
    const host = rootRef.current;
    if (!host || !active) return;

    const sampler = createAmbientSampler(host);
    samplerRef.current = sampler;
    sampler.setReducedMotion(reducedRef.current);

    let observer: MutationObserver | null = null;

    const tryBind = () => {
      const media = findAmbientMedia(host, kind);
      if (!media) return false;
      if (kind === 'image' && media instanceof HTMLImageElement) sampler.bindImage(media);
      else if (kind === 'video' && media instanceof HTMLVideoElement) sampler.bindVideo(media);
      return true;
    };

    if (!tryBind()) {
      const clip = host.nextElementSibling;
      if (clip instanceof HTMLElement) {
        observer = new MutationObserver(() => {
          if (tryBind()) observer?.disconnect();
        });
        observer.observe(clip, { childList: true, subtree: true, attributes: true });
      }
    }

    return () => {
      observer?.disconnect();
      sampler.dispose();
      if (samplerRef.current === sampler) samplerRef.current = null;
    };
  }, [active, kind]);

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        wrapperRef?.(el);
      }}
      className="community-depth-ambient"
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    />
  );
}
