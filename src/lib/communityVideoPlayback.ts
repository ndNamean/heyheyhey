export const FEED_VIDEO_SETTLE_MS = 120;
export const FEED_VIDEO_MIN_INTERSECTION = 0.6;
/** Gallery playback settle only — do not use for ornament/idle zoom. */
export const GALLERY_PLAYBACK_DWELL_MS = 100;
export const FRAME_TAP_MOVE_THRESHOLD_PX = 10;

export type CommunityVideoSurface = 'gallery' | 'detail' | 'famous' | 'feed';

export type CommunityVideoPlaybackToken = {
  postId: string;
  surface: CommunityVideoSurface;
};

export type FeedVideoCandidate = {
  postId: string;
  surface: 'feed' | 'famous';
  ratio: number;
};

export type GalleryPlaybackState = {
  currentPostId: string;
  nextPostId: string | null;
  settled: boolean;
};

export function surfacePriority(surface: CommunityVideoSurface): number {
  if (surface === 'gallery') return 3;
  if (surface === 'detail') return 2;
  return 1;
}

export function pickDominantFeedVideo(
  candidates: FeedVideoCandidate[],
  minRatio = FEED_VIDEO_MIN_INTERSECTION,
): FeedVideoCandidate | null {
  let best: FeedVideoCandidate | null = null;
  for (const candidate of candidates) {
    if (!(candidate.ratio >= minRatio)) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    if (candidate.ratio > best.ratio) {
      best = candidate;
      continue;
    }
    if (
      candidate.ratio === best.ratio &&
      candidate.surface === 'famous' &&
      best.surface !== 'famous'
    ) {
      best = candidate;
    }
  }
  return best;
}

export function isWindowScrollSettled(
  lastScrollAt: number,
  now: number,
  dwellMs = FEED_VIDEO_SETTLE_MS,
): boolean {
  if (!Number.isFinite(lastScrollAt) || lastScrollAt <= 0) return true;
  return now - lastScrollAt >= dwellMs;
}

export function canAttachVideoSource(args: {
  postId: string;
  surface: CommunityVideoSurface;
  gallery: Pick<GalleryPlaybackState, 'currentPostId' | 'nextPostId'> | null;
  selectedPostId: string | null;
  feedDominant: FeedVideoCandidate | null;
  claim?: CommunityVideoPlaybackToken | null;
}): boolean {
  if (args.surface === 'gallery') {
    if (!args.gallery) return false;
    return (
      args.postId === args.gallery.currentPostId || args.postId === args.gallery.nextPostId
    );
  }
  if (args.surface === 'detail') {
    if (args.gallery) return false;
    return args.selectedPostId === args.postId;
  }
  if (args.gallery || args.selectedPostId) return false;
  return (
    args.feedDominant?.postId === args.postId && args.feedDominant.surface === args.surface
  );
}

export function resolvePlaybackToken(args: {
  gallery: GalleryPlaybackState | null;
  selectedPostId: string | null;
  feedSettled: boolean;
  feedDominant: FeedVideoCandidate | null;
  claim?: CommunityVideoPlaybackToken | null;
}): CommunityVideoPlaybackToken | null {
  if (args.gallery) {
    if (args.gallery.settled && args.gallery.currentPostId) {
      return { postId: args.gallery.currentPostId, surface: 'gallery' };
    }
    return null;
  }
  const claim = args.claim;
  if (claim?.surface === 'detail' && args.selectedPostId === claim.postId) {
    return claim;
  }
  if (
    claim &&
    (claim.surface === 'feed' || claim.surface === 'famous') &&
    !args.selectedPostId &&
    args.feedSettled &&
    args.feedDominant?.postId === claim.postId &&
    args.feedDominant.surface === claim.surface
  ) {
    return claim;
  }
  if (args.selectedPostId) {
    return { postId: args.selectedPostId, surface: 'detail' };
  }
  if (args.feedSettled && args.feedDominant) {
    return { postId: args.feedDominant.postId, surface: args.feedDominant.surface };
  }
  return null;
}

export function shouldWantPlay(args: {
  token: CommunityVideoPlaybackToken | null;
  postId: string;
  surface: CommunityVideoSurface;
  userPaused: boolean;
  reducedMotion: boolean;
  saveData: boolean;
  documentHidden: boolean;
  composerOpen: boolean;
  /** Explicit Play/Replay on this instance — bypasses reduced-motion / save-data autoplay blocks. */
  claimed?: boolean;
}): boolean {
  if (!args.token) return false;
  if (args.token.postId !== args.postId || args.token.surface !== args.surface) return false;
  if (args.userPaused || args.documentHidden || args.composerOpen) return false;
  if (args.claimed) return true;
  if (args.reducedMotion || args.saveData) return false;
  return true;
}

export function userPauseKey(postId: string, surface: CommunityVideoSurface): string {
  return `${surface}:${postId}`;
}

export type CommunityVideoSoundPolicy = {
  userMuted: boolean;
  autoplayMutedFallback: boolean;
};

export type AutoplaySoundAttempt = 'unmuted' | 'muted';

export function isPlaybackOutputMuted(policy: CommunityVideoSoundPolicy): boolean {
  return Boolean(policy.userMuted || policy.autoplayMutedFallback);
}

export function soundPolicyAfterTokenChange(userMuted: boolean): CommunityVideoSoundPolicy {
  return { userMuted: Boolean(userMuted), autoplayMutedFallback: false };
}

export function soundPolicyAfterUserMuteChange(userMuted: boolean): CommunityVideoSoundPolicy {
  return { userMuted: Boolean(userMuted), autoplayMutedFallback: false };
}

export function firstAutoplaySoundAttempt(
  userMuted: boolean,
  autoplayMutedFallback = false,
): AutoplaySoundAttempt {
  return userMuted || autoplayMutedFallback ? 'muted' : 'unmuted';
}

export function shouldAttemptMutedAutoplayFallback(args: {
  userMuted: boolean;
  unmutedRejected: boolean;
  mutedFallbackTried: boolean;
}): boolean {
  return !args.userMuted && args.unmutedRejected && !args.mutedFallbackTried;
}

export function shouldAbandonPlayAttempt(
  currentGeneration: number,
  attemptGeneration: number,
): boolean {
  return currentGeneration !== attemptGeneration;
}

export function shouldShowTransportPlay(args: {
  playRejected: boolean;
  error: boolean;
  userPaused: boolean;
  autoplayRestricted: boolean;
  holdsToken: boolean;
  wantPlay: boolean;
}): boolean {
  if (args.playRejected || args.error || args.userPaused) return true;
  if (args.autoplayRestricted && args.holdsToken && !args.wantPlay) return true;
  return false;
}

export function isLowMovementFrameTap(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  thresholdPx = FRAME_TAP_MOVE_THRESHOLD_PX,
): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  return dx * dx + dy * dy <= thresholdPx * thresholdPx;
}
