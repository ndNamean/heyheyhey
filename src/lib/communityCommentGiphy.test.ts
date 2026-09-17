import { describe, expect, it } from 'vitest';
import type { GiphyMediaItem } from './giphyClient';
import {
  buildCommunityCommentGiphyPayload,
  canSendCommunityComment,
  commentGiphyDisplayUrl,
  commentHasGiphyContent,
  commentToGiphyMediaItem,
  communityCommentGiphyPermsOk,
  emptyCommunityCommentGiphyFields,
} from './communityCommentGiphy';

const sampleGif: GiphyMediaItem = {
  id: 'abc123',
  kind: 'gif',
  title: 'Hello GIF',
  width: 200,
  height: 150,
  url: 'https://media.giphy.com/media/abc123/200.gif',
  previewUrl: 'https://media.giphy.com/media/abc123/100.gif',
  username: 'tester',
  itemUrl: 'https://giphy.com/gifs/abc123',
};

describe('communityCommentGiphy', () => {
  it('sends empty GIF keys for text-only comments', () => {
    const empty = emptyCommunityCommentGiphyFields();
    expect(empty).toEqual({
      giphyId: '',
      giphyKind: '',
      giphyTitle: '',
      giphyWidth: '',
      giphyHeight: '',
      giphyUrl: '',
      giphyPreviewUrl: '',
    });
    expect(buildCommunityCommentGiphyPayload(null)).toEqual(empty);
    expect(communityCommentGiphyPermsOk('hello', empty)).toBe(true);
    expect(communityCommentGiphyPermsOk('', empty)).toBe(false);
  });

  it('maps a picker item onto comment GIF fields', () => {
    const payload = buildCommunityCommentGiphyPayload(sampleGif);
    expect(payload).toEqual({
      giphyId: 'abc123',
      giphyKind: 'gif',
      giphyTitle: 'Hello GIF',
      giphyWidth: '200',
      giphyHeight: '150',
      giphyUrl: sampleGif.url,
      giphyPreviewUrl: sampleGif.previewUrl,
    });
    expect(communityCommentGiphyPermsOk('', payload)).toBe(true);
    expect(communityCommentGiphyPermsOk('nice 🔥', payload)).toBe(true);
  });

  it('rejects GIF-only when url or kind is missing', () => {
    const payload = buildCommunityCommentGiphyPayload(sampleGif);
    expect(communityCommentGiphyPermsOk('', { ...payload, giphyUrl: '' })).toBe(false);
    expect(communityCommentGiphyPermsOk('', { ...payload, giphyKind: 'photo' })).toBe(false);
    expect(communityCommentGiphyPermsOk('', { ...payload, giphyKind: 'sticker' })).toBe(true);
  });

  it('allows text, GIF, or both, and reconstructs a picker item from stored fields', () => {
    expect(canSendCommunityComment('  emoji 🔥  ', null)).toBe(true);
    expect(canSendCommunityComment('', sampleGif)).toBe(true);
    expect(canSendCommunityComment('caption', sampleGif)).toBe(true);
    expect(canSendCommunityComment('   ', null)).toBe(false);
    expect(canSendCommunityComment('', { ...sampleGif, url: '' })).toBe(false);

    const stored = buildCommunityCommentGiphyPayload(sampleGif);
    const item = commentToGiphyMediaItem(stored);
    expect(item).toMatchObject({
      id: 'abc123',
      kind: 'gif',
      url: sampleGif.url,
      previewUrl: sampleGif.previewUrl,
    });
    expect(commentHasGiphyContent(stored)).toBe(true);
    expect(commentGiphyDisplayUrl(stored)).toBe(sampleGif.previewUrl);
    expect(commentToGiphyMediaItem(emptyCommunityCommentGiphyFields())).toBeNull();
    expect(commentHasGiphyContent({ giphyId: '', giphyUrl: '' })).toBe(false);
  });

  it('treats legacy body-only rows (omitted GIF keys) as text comments', () => {
    expect(commentHasGiphyContent({})).toBe(false);
    expect(commentGiphyDisplayUrl({})).toBe('');
    expect(commentToGiphyMediaItem({})).toBeNull();
  });
});
