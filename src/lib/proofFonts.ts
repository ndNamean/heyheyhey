const GOLD_FILL = '#FDC216';
const MINT_STROKE = '#33CD95';

export const PROOF_FONT = {
  user: "'Rubik Dirt', cursive",
  store: "'Rubik 80s Fade', cursive",
  task: "'Big Shoulders Inline Text', sans-serif",
  timestamp: "Arial, sans-serif",
  detail: "Arial, sans-serif",
} as const;

export async function ensureProofFontsLoaded(baseFontSize: number): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;

  const userSize = Math.round(baseFontSize * 1.22);
  const storeSize = Math.round(baseFontSize * 1.08);
  const taskSize = Math.round(baseFontSize * 1.0);

  const loads = [
    document.fonts.load(`${userSize}px ${PROOF_FONT.user}`),
    document.fonts.load(`${storeSize}px ${PROOF_FONT.store}`),
    document.fonts.load(`${taskSize}px ${PROOF_FONT.task}`),
    document.fonts.load(`${baseFontSize}px ${PROOF_FONT.timestamp}`),
  ];

  try {
    await Promise.race([
      Promise.allSettled(loads).then(() => document.fonts.ready),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    /* fallback fonts used */
  }
}

export { GOLD_FILL, MINT_STROKE };
