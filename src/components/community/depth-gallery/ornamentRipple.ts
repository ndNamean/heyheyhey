/** One-shot vanish ripple — read-only on idle/vanish state. */

export const RIPPLE_VANISH_THRESHOLD = 0.99;
export const RIPPLE_PRE_VANISH_MIN = 0.5;

export type OrnamentRippleFireInput = {
  still: boolean;
  reducedMotion: boolean;
  vanishAmount: number;
  preVanishOpacity: number;
  alreadyFired: boolean;
};

export type OrnamentRippleResetInput = {
  still: boolean;
  reducedMotion: boolean;
};

export function ornamentRippleReactionKey(postId: string, reactionId: string): string {
  return `${postId}:reaction:${reactionId}`;
}

export function ornamentRippleCommentKey(postId: string, commentId: string): string {
  return `${postId}:comment:${commentId}`;
}

export function ornamentRippleAuthorKey(postId: string): string {
  return `${postId}:author`;
}

export function ornamentRippleShouldFire(input: OrnamentRippleFireInput): boolean {
  if (input.reducedMotion || !input.still || input.alreadyFired) return false;
  if (!(input.vanishAmount >= RIPPLE_VANISH_THRESHOLD)) return false;
  if (!(input.preVanishOpacity >= RIPPLE_PRE_VANISH_MIN)) return false;
  return true;
}

export function ornamentRippleShouldReset(input: OrnamentRippleResetInput): boolean {
  return !input.still || input.reducedMotion;
}
