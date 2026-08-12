import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GiphyMediaItem } from './giphyClient';
import {
  GiphyClientError,
  createCancellableSearch,
  createDebouncedAsync,
  normalizeGiphyItem,
  tabToMediaKind,
} from './giphyClient';
import {
  buildGroupChatMediaPayload,
  buildStoreChatMediaPayload,
  canSendStoreChatMedia,
  emptyStoreChatAttachmentFields,
  emptyStoreChatGiphyFields,
  giphyItemToFields,
  normalizeStoreChatMessageType,
  storeChatMediaLabel,
} from './storeChatMediaPayload';

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

const sampleAttachment = {
  kind: 'image' as const,
  path: 'stores/s1/chat/m1/photo.jpg',
  fileId: 'file-1',
  url: 'https://example.com/photo.jpg',
  mimeType: 'image/jpeg',
  fileName: 'photo.jpg',
  bytes: 2048,
  width: 800,
  height: 600,
};

describe('storeChatMediaPayload', () => {
  it('builds text-only payload with empty giphy defaults', () => {
    const payload = buildStoreChatMediaPayload({
      body: 'hello @Ada',
      mentionedUserIds: ['u1'],
      mentionAll: false,
      replyToMessageId: '',
    });
    expect(payload.messageType).toBe('text');
    expect(payload.body).toBe('hello @Ada');
    expect(payload.mentionedUserIdsJson).toBe(JSON.stringify(['u1']));
    expect(payload.mentionAll).toBe(false);
    expect(payload.giphyId).toBe('');
    expect(payload.giphyUrl).toBe('');
    expect(payload.attachmentPath).toBe('');
    expect(payload.attachmentKind).toBe('');
    expect(payload.attachmentFileId).toBe('');
    expect(payload.forwardedFromMessageId).toBe('');
    expect(payload.clientMutationId).toBe('');
    expect(payload.sourceType).toBe('');
    expect(payload.logbookEntryId).toBe('');
    expect(payload.reportId).toBe('');
    expect(payload.chatDeliveryKey).toBe('');
  });

  it('buildGroupChatMediaPayload omits logbook keys but keeps forward fields', () => {
    const payload = buildGroupChatMediaPayload({
      body: 'hi',
      forwardedFromMessageId: 'm1',
      forwardedFromUserId: 'u9',
    });
    expect(payload.messageType).toBe('text');
    expect(payload.forwardedFromMessageId).toBe('m1');
    expect(payload.forwardedFromUserId).toBe('u9');
    expect(payload.attachmentPath).toBe('');
    expect('sourceType' in payload).toBe(false);
    expect('logbookEntryId' in payload).toBe(false);
  });

  it('builds giphy_media when only media is selected', () => {
    const payload = buildStoreChatMediaPayload({
      body: '  ',
      giphy: sampleGif,
    });
    expect(payload.messageType).toBe('giphy_media');
    expect(payload.giphyId).toBe('abc123');
    expect(payload.giphyKind).toBe('gif');
    expect(payload.giphyTitle).toBe('Hello GIF');
    expect(payload.giphyWidth).toBe('200');
    expect(payload.giphyHeight).toBe('150');
    expect(payload.giphyUrl).toBe(sampleGif.url);
    expect(payload.giphyPreviewUrl).toBe(sampleGif.previewUrl);
    expect(payload.attachmentPath).toBe('');
  });

  it('builds text_giphy for text + media', () => {
    const payload = buildStoreChatMediaPayload({
      body: 'look',
      giphy: { ...sampleGif, kind: 'sticker' },
    });
    expect(payload.messageType).toBe('text_giphy');
    expect(payload.giphyKind).toBe('sticker');
    expect(payload.attachmentPath).toBe('');
  });

  it('composes reply + mention + giphy together', () => {
    const payload = buildStoreChatMediaPayload({
      body: '@all check this',
      giphy: sampleGif,
      replyToMessageId: 'parent-1',
      mentionedUserIds: ['u2', 'u2', ''],
      mentionAll: true,
      clientMutationId: 'cm-1',
      forwardedFromMessageId: 'fwd-msg',
      forwardedFromUserId: 'fwd-user',
    });
    expect(payload.messageType).toBe('text_giphy');
    expect(payload.replyToMessageId).toBe('parent-1');
    expect(payload.mentionAll).toBe(true);
    expect(payload.mentionedUserIdsJson).toBe(JSON.stringify(['u2']));
    expect(payload.clientMutationId).toBe('cm-1');
    expect(payload.forwardedFromMessageId).toBe('fwd-msg');
    expect(payload.forwardedFromUserId).toBe('fwd-user');
    expect(payload.giphyId).toBe('abc123');
    expect(payload.attachmentPath).toBe('');
  });

  it('builds attachment and text_attachment payloads; XOR clears giphy', () => {
    const mediaOnly = buildStoreChatMediaPayload({
      body: '  ',
      attachment: sampleAttachment,
      giphy: sampleGif,
    });
    expect(mediaOnly.messageType).toBe('attachment');
    expect(mediaOnly.giphyId).toBe('');
    expect(mediaOnly.attachmentKind).toBe('image');
    expect(mediaOnly.attachmentPath).toBe(sampleAttachment.path);
    expect(mediaOnly.attachmentFileId).toBe('file-1');
    expect(mediaOnly.attachmentBytes).toBe('2048');
    expect(mediaOnly.attachmentWidth).toBe('800');
    expect(mediaOnly.attachmentHeight).toBe('600');

    const withCaption = buildGroupChatMediaPayload({
      body: 'caption',
      attachment: { ...sampleAttachment, kind: 'file', mimeType: 'application/pdf' },
    });
    expect(withCaption.messageType).toBe('text_attachment');
    expect(withCaption.attachmentKind).toBe('file');
  });

  it('normalizes message types and send gate', () => {
    expect(normalizeStoreChatMessageType('', false)).toBe('text');
    expect(normalizeStoreChatMessageType('hi', false)).toBe('text');
    expect(normalizeStoreChatMessageType('', true)).toBe('giphy_media');
    expect(normalizeStoreChatMessageType('hi', true)).toBe('text_giphy');
    expect(normalizeStoreChatMessageType('', false, true)).toBe('attachment');
    expect(normalizeStoreChatMessageType('hi', false, true)).toBe('text_attachment');
    expect(canSendStoreChatMedia('', null)).toBe(false);
    expect(canSendStoreChatMedia('x', null)).toBe(true);
    expect(canSendStoreChatMedia('', sampleGif)).toBe(true);
    expect(canSendStoreChatMedia('', null, sampleAttachment)).toBe(true);
  });

  it('maps giphy item fields and labels', () => {
    expect(giphyItemToFields(sampleGif)).toEqual({
      giphyId: 'abc123',
      giphyKind: 'gif',
      giphyTitle: 'Hello GIF',
      giphyWidth: '200',
      giphyHeight: '150',
      giphyUrl: sampleGif.url,
      giphyPreviewUrl: sampleGif.previewUrl,
    });
    expect(emptyStoreChatGiphyFields().giphyId).toBe('');
    expect(emptyStoreChatAttachmentFields().attachmentPath).toBe('');
    expect(storeChatMediaLabel('giphy_media', 'sticker')).toBe('Sticker');
    expect(storeChatMediaLabel('text_giphy', 'gif')).toBe('GIF + text');
    expect(storeChatMediaLabel('text')).toBe('Message');
    expect(storeChatMediaLabel('attachment', '', 'image')).toBe('Photo');
    expect(storeChatMediaLabel('text_attachment', '', 'file')).toBe('File');
  });
});

describe('giphyClient helpers', () => {
  it('maps tabs to media kinds and normalizes raw items', () => {
    expect(tabToMediaKind('gifs')).toBe('gif');
    expect(tabToMediaKind('stickers')).toBe('sticker');
    expect(tabToMediaKind('memes')).toBe('meme');
    expect(tabToMediaKind('emoji')).toBe('emoji');

    const item = normalizeGiphyItem(
      {
        id: 'x1',
        title: 'T',
        url: 'https://giphy.com/gifs/x1',
        username: 'u',
        images: {
          fixed_height: {
            url: 'https://media.giphy.com/media/x1/200.gif',
            width: '200',
            height: '120',
          },
          fixed_height_small: {
            url: 'https://media.giphy.com/media/x1/100.gif',
            width: '100',
            height: '60',
          },
        },
      },
      'gif',
    );
    expect(item).toMatchObject({
      id: 'x1',
      kind: 'gif',
      width: 200,
      height: 120,
      url: 'https://media.giphy.com/media/x1/200.gif',
      previewUrl: 'https://media.giphy.com/media/x1/100.gif',
    });
    expect(normalizeGiphyItem({ title: 'no-id' }, 'gif')).toBeNull();
  });
});

describe('createDebouncedAsync cancel / debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces rapid schedules and only runs the latest', async () => {
    const calls: string[] = [];
    const debounced = createDebouncedAsync(async (_signal, q: string) => {
      calls.push(q);
      return q;
    }, 100);

    const p1 = debounced.schedule('a');
    const p1rejected = expect(p1).rejects.toMatchObject({ code: 'aborted' });
    const p2 = debounced.schedule('b');
    const p2rejected = expect(p2).rejects.toMatchObject({ code: 'aborted' });
    const p3 = debounced.schedule('c');

    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([p1rejected, p2rejected]);
    await expect(p3).resolves.toBe('c');
    expect(calls).toEqual(['c']);
  });

  it('cancel aborts pending timer and in-flight work', async () => {
    let started = 0;
    const debounced = createDebouncedAsync(async (signal) => {
      started += 1;
      return new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => resolve('done'), 50);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new GiphyClientError('Search aborted', { code: 'aborted' }));
        });
      });
    }, 20);

    const pending = debounced.schedule();
    const pendingRejected = expect(pending).rejects.toMatchObject({ code: 'aborted' });
    debounced.cancel();
    await pendingRejected;
    expect(started).toBe(0);

    const inflight = debounced.schedule();
    const inflightRejected = expect(inflight).rejects.toMatchObject({ code: 'aborted' });
    await vi.advanceTimersByTimeAsync(20);
    expect(started).toBe(1);
    debounced.cancel();
    await inflightRejected;
  });
});

describe('createCancellableSearch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('aborts the previous fetch when a new search starts', async () => {
    vi.stubEnv('VITE_GIPHY_API_KEY', 'test-key');
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const ctl = createCancellableSearch();
    const first = ctl.search({ tab: 'gifs', query: 'one' });
    const second = ctl.search({ tab: 'gifs', query: 'two' });

    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    ctl.cancel();
    await expect(second).rejects.toMatchObject({ code: 'aborted' });
  });
});
