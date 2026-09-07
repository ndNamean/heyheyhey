/**
 * Mood interpolation for the Community depth gallery.
 * All three palette channels share the same depthBlend as the image layers.
 */

import {
  HEY_PELO_FALLBACK_MOOD,
  pickMoodForPostId,
  type GalleryMood,
} from './communityGalleryMoods';
import type { DepthBlendData } from './galleryLayers';

export type Rgb255 = { r: number; g: number; b: number };

export type PostMoodFields = {
  postId?: string | null;
  moodBackgroundColor?: string | null;
  moodBlob1Color?: string | null;
  moodBlob2Color?: string | null;
};

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function expandHex3(raw: string): string {
  return `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
}

/** Parse #rgb / #rrggbb to 0–255 RGB. Invalid input returns null. */
export function parseMoodHex(hex: string | null | undefined): Rgb255 | null {
  if (hex == null) return null;
  const trimmed = hex.trim();
  if (!trimmed) return null;

  const six = HEX6.exec(trimmed);
  const digits = six?.[1] ?? HEX3.exec(trimmed)?.[1];
  if (!digits) return null;
  const full = digits.length === 3 ? expandHex3(digits) : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgb255ToHex({ r, g, b }: Rgb255): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function normalizeMoodHex(hex: string | null | undefined): string | null {
  const rgb = parseMoodHex(hex);
  return rgb ? rgb255ToHex(rgb) : null;
}

export function lerpColor(fromHex: string, toHex: string, t: number): string {
  const from = parseMoodHex(fromHex) ?? parseMoodHex(HEY_PELO_FALLBACK_MOOD.backgroundColor)!;
  const to = parseMoodHex(toHex) ?? from;
  const blend = clamp01(t);
  return rgb255ToHex({
    r: lerpNumber(from.r, to.r, blend),
    g: lerpNumber(from.g, to.g, blend),
    b: lerpNumber(from.b, to.b, blend),
  });
}

export function lerpMood(current: GalleryMood, next: GalleryMood, depthBlend: number): GalleryMood {
  const blend = clamp01(depthBlend);
  return {
    backgroundColor: lerpColor(current.backgroundColor, next.backgroundColor, blend),
    blob1Color: lerpColor(current.blob1Color, next.blob1Color, blend),
    blob2Color: lerpColor(current.blob2Color, next.blob2Color, blend),
  };
}

function readAuthoredMood(fields: PostMoodFields): GalleryMood | null {
  const backgroundColor = normalizeMoodHex(fields.moodBackgroundColor);
  const blob1Color = normalizeMoodHex(fields.moodBlob1Color);
  const blob2Color = normalizeMoodHex(fields.moodBlob2Color);
  if (!backgroundColor || !blob1Color || !blob2Color) return null;
  return { backgroundColor, blob1Color, blob2Color };
}

/**
 * Authored hexes win. Empty/invalid fields fall back to the catalog by postId hash,
 * then to the Hey Pelo gold companions.
 */
export function resolveGalleryMood(fields: PostMoodFields): GalleryMood {
  const authored = readAuthoredMood(fields);
  if (authored) return authored;
  const postId = fields.postId?.trim() ?? '';
  if (postId) return pickMoodForPostId(postId);
  return HEY_PELO_FALLBACK_MOOD;
}

export function resolveMoodsForPosts(posts: PostMoodFields[]): GalleryMood[] {
  return posts.map(resolveGalleryMood);
}

export function interpolateMoods(moods: GalleryMood[], blend: DepthBlendData): GalleryMood {
  if (moods.length === 0 || blend.currentPlaneIndex < 0) {
    return HEY_PELO_FALLBACK_MOOD;
  }
  const current = moods[blend.currentPlaneIndex] ?? HEY_PELO_FALLBACK_MOOD;
  const next = moods[blend.nextPlaneIndex] ?? current;
  return lerpMood(current, next, blend.depthBlend);
}
