/**
 * Authored Community depth-gallery palettes (Phase 10).
 * Exact hex triples from the local Codrops galleryData.js benchmark.
 * V1 assigns by stable postId hash — no per-frame pixel extraction.
 */

export type GalleryMood = {
  backgroundColor: string;
  blob1Color: string;
  blob2Color: string;
};

/** Cream / gold / peach — also the Hey Pelo gold companion fallback. */
export const HEY_PELO_FALLBACK_MOOD: GalleryMood = {
  backgroundColor: '#fffaf0',
  blob1Color: '#ffdf94',
  blob2Color: '#fce7c4',
};

export const COMMUNITY_GALLERY_MOODS: readonly GalleryMood[] = [
  HEY_PELO_FALLBACK_MOOD,
  {
    backgroundColor: '#fffaf0',
    blob1Color: '#d29a41',
    blob2Color: '#bb96af',
  },
  {
    backgroundColor: '#5f81ab',
    blob1Color: '#f88b8d',
    blob2Color: '#cfbbdd',
  },
  {
    backgroundColor: '#5b9bc2',
    blob1Color: '#ffaa00',
    blob2Color: '#00e1ff',
  },
  {
    backgroundColor: '#7d936e',
    blob1Color: '#fdd895',
    blob2Color: '#a5b599',
  },
] as const;

export const COMMUNITY_GALLERY_MOOD_COUNT = COMMUNITY_GALLERY_MOODS.length;

/** FNV-1a 32-bit — stable across sessions for the same postId. */
export function hashPostId(postId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < postId.length; i++) {
    hash ^= postId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function moodIndexForPostId(postId: string): number {
  return hashPostId(postId) % COMMUNITY_GALLERY_MOOD_COUNT;
}

export function pickMoodForPostId(postId: string): GalleryMood {
  const trimmed = postId.trim();
  if (!trimmed) return HEY_PELO_FALLBACK_MOOD;
  return COMMUNITY_GALLERY_MOODS[moodIndexForPostId(trimmed)];
}
