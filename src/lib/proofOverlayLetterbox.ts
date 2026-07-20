export interface LetterboxLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
  videoW: number;
  videoH: number;
}

/**
 * Contain-fit of a media rectangle inside a viewfinder (object-fit: contain).
 * videoW/videoH should already be the effective (post-rotation) dimensions
 * when used with manual media rotation.
 */
export function computeLetterboxLayout(
  viewfinderW: number,
  viewfinderH: number,
  videoW: number,
  videoH: number,
): LetterboxLayout | null {
  if (viewfinderW <= 0 || viewfinderH <= 0 || videoW <= 0 || videoH <= 0) return null;
  const scale = Math.min(viewfinderW / videoW, viewfinderH / videoH);
  const displayW = videoW * scale;
  const displayH = videoH * scale;
  return {
    scale,
    offsetX: (viewfinderW - displayW) / 2,
    offsetY: (viewfinderH - displayH) / 2,
    videoW,
    videoH,
  };
}
