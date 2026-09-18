import { describe, expect, it } from 'vitest';
import {
  canAttachVideoSource,
  isWindowScrollSettled,
  pickDominantFeedVideo,
  resolvePlaybackToken,
  shouldWantPlay,
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

  it('uses 250ms window-scroll settle', () => {
    expect(isWindowScrollSettled(0, 1000)).toBe(true);
    expect(isWindowScrollSettled(1000, 1200)).toBe(false);
    expect(isWindowScrollSettled(1000, 1250)).toBe(true);
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
