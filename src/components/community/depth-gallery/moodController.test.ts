import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_GALLERY_MOODS,
  HEY_PELO_FALLBACK_MOOD,
  pickMoodForPostId,
} from './communityGalleryMoods';
import {
  interpolateMoods,
  lerpColor,
  lerpMood,
  resolveGalleryMood,
} from './moodController';
import { computeDepthBlend } from './galleryLayers';

describe('authored catalog', () => {
  it('ports the five galleryData.js palettes exactly', () => {
    expect(COMMUNITY_GALLERY_MOODS).toHaveLength(5);
    expect(COMMUNITY_GALLERY_MOODS[0]).toEqual({
      backgroundColor: '#fffaf0',
      blob1Color: '#ffdf94',
      blob2Color: '#fce7c4',
    });
    expect(COMMUNITY_GALLERY_MOODS[1]).toEqual({
      backgroundColor: '#fffaf0',
      blob1Color: '#d29a41',
      blob2Color: '#bb96af',
    });
    expect(COMMUNITY_GALLERY_MOODS[2]).toEqual({
      backgroundColor: '#5f81ab',
      blob1Color: '#f88b8d',
      blob2Color: '#cfbbdd',
    });
    expect(COMMUNITY_GALLERY_MOODS[3]).toEqual({
      backgroundColor: '#5b9bc2',
      blob1Color: '#ffaa00',
      blob2Color: '#00e1ff',
    });
    expect(COMMUNITY_GALLERY_MOODS[4]).toEqual({
      backgroundColor: '#7d936e',
      blob1Color: '#fdd895',
      blob2Color: '#a5b599',
    });
    expect(HEY_PELO_FALLBACK_MOOD).toEqual(COMMUNITY_GALLERY_MOODS[0]);
  });
});

describe('lerpColor', () => {
  it('interpolates at 0 / 0.25 / 0.5 / 0.75 / 1', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(lerpColor('#000000', '#ffffff', 0.25)).toBe('#404040');
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(lerpColor('#000000', '#ffffff', 0.75)).toBe('#bfbfbf');
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('lerps all three mood channels with the same depthBlend', () => {
    const current = COMMUNITY_GALLERY_MOODS[0];
    const next = COMMUNITY_GALLERY_MOODS[2];
    for (const blend of [0, 0.25, 0.5, 0.75, 1]) {
      const mood = lerpMood(current, next, blend);
      expect(mood.backgroundColor).toBe(lerpColor(current.backgroundColor, next.backgroundColor, blend));
      expect(mood.blob1Color).toBe(lerpColor(current.blob1Color, next.blob1Color, blend));
      expect(mood.blob2Color).toBe(lerpColor(current.blob2Color, next.blob2Color, blend));
    }
  });

  it('uses the shared depthBlend from camera Z', () => {
    const moods = [...COMMUNITY_GALLERY_MOODS];
    const blend = computeDepthBlend(2.5, 5);
    expect(blend.depthBlend).toBeCloseTo(0.5, 8);
    const interpolated = interpolateMoods(moods, blend);
    const expected = lerpMood(moods[blend.currentPlaneIndex], moods[blend.nextPlaneIndex], blend.depthBlend);
    expect(interpolated).toEqual(expected);
  });
});

describe('catalog fallback', () => {
  it('uses authored hexes when all three mood fields are present', () => {
    const authored = resolveGalleryMood({
      postId: 'post-1',
      moodBackgroundColor: '#5f81ab',
      moodBlob1Color: '#f88b8d',
      moodBlob2Color: '#cfbbdd',
    });
    expect(authored).toEqual(COMMUNITY_GALLERY_MOODS[2]);
  });

  it('falls back to the catalog by postId hash when mood fields are empty', () => {
    const postId = 'post-empty-moods';
    const resolved = resolveGalleryMood({
      postId,
      moodBackgroundColor: '',
      moodBlob1Color: '',
      moodBlob2Color: '',
    });
    expect(resolved).toEqual(pickMoodForPostId(postId));
    expect(COMMUNITY_GALLERY_MOODS).toContainEqual(resolved);
    expect(resolveGalleryMood({ postId })).toEqual(resolved);
  });

  it('picks a stable catalog entry for the same postId', () => {
    expect(pickMoodForPostId('abc')).toEqual(pickMoodForPostId('abc'));
  });

  it('uses Hey Pelo gold companions when fields and postId are empty', () => {
    expect(
      resolveGalleryMood({
        postId: '',
        moodBackgroundColor: '',
        moodBlob1Color: '',
        moodBlob2Color: '',
      }),
    ).toEqual(HEY_PELO_FALLBACK_MOOD);
  });
});
