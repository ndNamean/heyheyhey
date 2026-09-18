import { describe, expect, it } from 'vitest';
import {
  FEED_VIDEO_SETTLE_MS,
  GALLERY_PLAYBACK_DWELL_MS,
  canAttachVideoSource,
  firstAutoplaySoundAttempt,
  isLowMovementFrameTap,
  isPlaybackOutputMuted,
  isWindowScrollSettled,
  pickDominantFeedVideo,
  resolvePlaybackToken,
  shouldAbandonPlayAttempt,
  shouldAttemptMutedAutoplayFallback,
  shouldShowTransportPlay,
  shouldWantPlay,
  soundPolicyAfterTokenChange,
  soundPolicyAfterUserMuteChange,
} from './communityVideoPlayback';
import { isCommunityVideoPost } from './communityVideo';

describe('communityVideo helpers', () => {
  it('detects video posts by kind and url', () => {
    expect(
      isCommunityVideoPost({
        attachmentKind: 'video',
        attachmentPath: 'stores/community/p/a.mp4',
        attachmentFile: { url: 'https://example.com/a.mp4' },
      }),
    ).toBe(true);
    expect(
      isCommunityVideoPost({
        attachmentKind: 'image',
        attachmentPath: 'stores/community/p/a.jpg',
        attachmentFile: { url: 'https://example.com/a.jpg' },
      }),
    ).toBe(false);
  });
});

describe('communityVideoPlayback', () => {
  it('picks the largest feed candidate at or above 0.6', () => {
    expect(
      pickDominantFeedVideo([
        { postId: 'a', surface: 'feed', ratio: 0.4 },
        { postId: 'b', surface: 'feed', ratio: 0.7 },
        { postId: 'c', surface: 'famous', ratio: 0.65 },
      ]),
    ).toEqual({ postId: 'b', surface: 'feed', ratio: 0.7 });
    expect(pickDominantFeedVideo([{ postId: 'a', surface: 'feed', ratio: 0.59 }])).toBeNull();
  });

  it('uses 120ms window-scroll settle', () => {
    expect(FEED_VIDEO_SETTLE_MS).toBe(120);
    expect(isWindowScrollSettled(0, 1000)).toBe(true);
    expect(isWindowScrollSettled(1000, 1119)).toBe(false);
    expect(isWindowScrollSettled(1000, 1120)).toBe(true);
  });

  it('keeps gallery playback dwell shorter than ornament idle', () => {
    expect(GALLERY_PLAYBACK_DWELL_MS).toBe(100);
  });

  it('treats user mute and autoplay-muted fallback as distinct', () => {
    expect(isPlaybackOutputMuted({ userMuted: false, autoplayMutedFallback: false })).toBe(false);
    expect(isPlaybackOutputMuted({ userMuted: true, autoplayMutedFallback: false })).toBe(true);
    expect(isPlaybackOutputMuted({ userMuted: false, autoplayMutedFallback: true })).toBe(true);
    expect(soundPolicyAfterTokenChange(true)).toEqual({
      userMuted: true,
      autoplayMutedFallback: false,
    });
    expect(soundPolicyAfterUserMuteChange(false)).toEqual({
      userMuted: false,
      autoplayMutedFallback: false,
    });
    expect(firstAutoplaySoundAttempt(false)).toBe('unmuted');
    expect(firstAutoplaySoundAttempt(true)).toBe('muted');
    expect(firstAutoplaySoundAttempt(false, true)).toBe('muted');
    expect(
      shouldAttemptMutedAutoplayFallback({
        userMuted: false,
        unmutedRejected: true,
        mutedFallbackTried: false,
      }),
    ).toBe(true);
    expect(
      shouldAttemptMutedAutoplayFallback({
        userMuted: false,
        unmutedRejected: true,
        mutedFallbackTried: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptMutedAutoplayFallback({
        userMuted: true,
        unmutedRejected: true,
        mutedFallbackTried: false,
      }),
    ).toBe(false);
  });

  it('does not show first-view Play merely because wantPlay is false', () => {
    expect(
      shouldShowTransportPlay({
        playRejected: false,
        error: false,
        userPaused: false,
        autoplayRestricted: false,
        holdsToken: false,
        wantPlay: false,
      }),
    ).toBe(false);
    expect(
      shouldShowTransportPlay({
        playRejected: true,
        error: false,
        userPaused: false,
        autoplayRestricted: false,
        holdsToken: false,
        wantPlay: false,
      }),
    ).toBe(true);
    expect(
      shouldShowTransportPlay({
        playRejected: false,
        error: false,
        userPaused: true,
        autoplayRestricted: false,
        holdsToken: true,
        wantPlay: false,
      }),
    ).toBe(true);
    expect(
      shouldShowTransportPlay({
        playRejected: false,
        error: true,
        userPaused: false,
        autoplayRestricted: false,
        holdsToken: true,
        wantPlay: true,
      }),
    ).toBe(true);
    expect(
      shouldShowTransportPlay({
        playRejected: false,
        error: false,
        userPaused: false,
        autoplayRestricted: true,
        holdsToken: true,
        wantPlay: false,
      }),
    ).toBe(true);
    expect(
      shouldShowTransportPlay({
        playRejected: false,
        error: false,
        userPaused: false,
        autoplayRestricted: true,
        holdsToken: false,
        wantPlay: false,
      }),
    ).toBe(false);
  });

  it('abandons stale play generations and ignores large pointer movement as taps', () => {
    expect(shouldAbandonPlayAttempt(2, 1)).toBe(true);
    expect(shouldAbandonPlayAttempt(1, 1)).toBe(false);
    expect(isLowMovementFrameTap(0, 0, 6, 6)).toBe(true);
    expect(isLowMovementFrameTap(0, 0, 40, 0)).toBe(false);
  });

  it('lets gallery settled current win over detail and feed', () => {
    expect(
      resolvePlaybackToken({
        gallery: { currentPostId: 'g', nextPostId: 'n', settled: true },
        selectedPostId: 'd',
        feedSettled: true,
        feedDominant: { postId: 'f', surface: 'feed', ratio: 0.9 },
      }),
    ).toEqual({ postId: 'g', surface: 'gallery' });
    expect(
      resolvePlaybackToken({
        gallery: { currentPostId: 'g', nextPostId: 'n', settled: false },
        selectedPostId: 'd',
        feedSettled: true,
        feedDominant: { postId: 'f', surface: 'feed', ratio: 0.9 },
      }),
    ).toBeNull();
    expect(
      resolvePlaybackToken({
        gallery: null,
        selectedPostId: 'd',
        feedSettled: true,
        feedDominant: { postId: 'f', surface: 'feed', ratio: 0.9 },
      }),
    ).toEqual({ postId: 'd', surface: 'detail' });
  });

  it('attaches gallery current+next and feed dominant only', () => {
    expect(
      canAttachVideoSource({
        postId: 'n',
        surface: 'gallery',
        gallery: { currentPostId: 'g', nextPostId: 'n' },
        selectedPostId: null,
        feedDominant: null,
      }),
    ).toBe(true);
    expect(
      canAttachVideoSource({
        postId: 'f',
        surface: 'feed',
        gallery: { currentPostId: 'g', nextPostId: 'n' },
        selectedPostId: null,
        feedDominant: { postId: 'f', surface: 'feed', ratio: 0.9 },
      }),
    ).toBe(false);
  });

  it('keeps manual pause from autoplaying and suppresses reduced-motion autoplay', () => {
    const token = { postId: 'p', surface: 'feed' as const };
    expect(
      shouldWantPlay({
        token,
        postId: 'p',
        surface: 'feed',
        userPaused: true,
        reducedMotion: false,
        saveData: false,
        documentHidden: false,
        composerOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldWantPlay({
        token,
        postId: 'p',
        surface: 'feed',
        userPaused: false,
        reducedMotion: true,
        saveData: false,
        documentHidden: false,
        composerOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldWantPlay({
        token,
        postId: 'p',
        surface: 'feed',
        userPaused: false,
        reducedMotion: false,
        saveData: false,
        documentHidden: false,
        composerOpen: false,
      }),
    ).toBe(true);
  });

  it('lets an explicit claim bypass reduced-motion and save-data autoplay blocks', () => {
    const token = { postId: 'p', surface: 'feed' as const };
    expect(
      shouldWantPlay({
        token,
        postId: 'p',
        surface: 'feed',
        userPaused: false,
        reducedMotion: true,
        saveData: true,
        documentHidden: false,
        composerOpen: false,
        claimed: true,
      }),
    ).toBe(true);
  });

  it('does not keep a feed claim playing after another video is dominant', () => {
    expect(
      resolvePlaybackToken({
        gallery: null,
        selectedPostId: null,
        feedSettled: true,
        feedDominant: { postId: 'b', surface: 'feed', ratio: 0.9 },
        claim: { postId: 'a', surface: 'feed' },
      }),
    ).toEqual({ postId: 'b', surface: 'feed' });
  });
});
