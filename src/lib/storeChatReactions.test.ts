import { describe, expect, it } from 'vitest';
import type { StoreChatReaction } from '../types';
import {
  QUICK_UNICODE_REACTIONS,
  buildGiphyReactionIdentityKey,
  buildGiphyReactionMutationId,
  buildReactionIdentityKey,
  buildUnicodeReactionIdentityKey,
  buildUnicodeReactionMutationId,
  dedupeReactionRecipients,
  dedupeUserIds,
  findOwnGiphyReaction,
  findOwnUnicodeReaction,
  groupGiphyReactions,
  groupUnicodeReactions,
  isQuickUnicodeReaction,
  mapReactionsByMessageId,
  resolveGiphyReactionToggle,
  resolveUnicodeReactionToggle,
} from './storeChatReactions';

function reaction(partial: Partial<StoreChatReaction> & Pick<StoreChatReaction, 'id' | 'messageId' | 'userId' | 'unicode'>): StoreChatReaction {
  return {
    storeId: 's1',
    reactionType: 'unicode',
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    giphyUrl: '',
    giphyPreviewUrl: '',
    createdAt: '2026-08-04T00:00:00.000Z',
    clientMutationId: 'm',
    ...partial,
  };
}

describe('reaction identity keys', () => {
  it('builds stable unicode identity keys with NFC normalization', () => {
    const a = buildUnicodeReactionIdentityKey('m1', 'u1', '❤️');
    const b = buildReactionIdentityKey({
      messageId: 'm1',
      userId: 'u1',
      reactionType: 'unicode',
      unicode: '❤️',
    });
    expect(a).toBe(b);
    expect(a).toBe('unicode:m1:u1:❤️');
  });

  it('separates giphy identity from unicode', () => {
    expect(
      buildReactionIdentityKey({
        messageId: 'm1',
        userId: 'u1',
        reactionType: 'giphy',
        giphyId: 'g1',
      }),
    ).toBe('giphy:m1:u1:g1');
  });
});

describe('resolveUnicodeReactionToggle', () => {
  it('adds when absent and removes when present (idempotent identity)', () => {
    const add = resolveUnicodeReactionToggle([], {
      messageId: 'm1',
      userId: 'me',
      unicode: '👍',
    });
    expect(add.action).toBe('add');
    if (add.action !== 'add') return;
    expect(add.identityKey).toBe(buildUnicodeReactionIdentityKey('m1', 'me', '👍'));
    expect(add.clientMutationId).toBe(buildUnicodeReactionMutationId('m1', 'me', '👍', 'add'));
    expect(add.payload).toMatchObject({
      reactionType: 'unicode',
      unicode: '👍',
      giphyId: '',
    });

    const existing = [
      reaction({
        id: 'r1',
        messageId: 'm1',
        userId: 'me',
        unicode: '👍',
        clientMutationId: add.clientMutationId,
      }),
    ];
    const remove = resolveUnicodeReactionToggle(existing, {
      messageId: 'm1',
      userId: 'me',
      unicode: '👍',
    });
    expect(remove).toEqual({
      action: 'remove',
      identityKey: buildUnicodeReactionIdentityKey('m1', 'me', '👍'),
      reactionId: 'r1',
      clientMutationId: buildUnicodeReactionMutationId('m1', 'me', '👍', 'remove'),
    });
  });

  it('does not remove another user reaction with the same emoji', () => {
    const existing = [reaction({ id: 'r-other', messageId: 'm1', userId: 'other', unicode: '😂' })];
    const decision = resolveUnicodeReactionToggle(existing, {
      messageId: 'm1',
      userId: 'me',
      unicode: '😂',
    });
    expect(decision.action).toBe('add');
  });

  it('rejects empty params', () => {
    expect(() =>
      resolveUnicodeReactionToggle([], { messageId: '', userId: 'me', unicode: '👍' }),
    ).toThrow(/Invalid/);
  });
});

describe('grouping + mapping', () => {
  it('maps room reactions by message id and groups unicode chips', () => {
    const reactions = [
      reaction({ id: 'r1', messageId: 'm1', userId: 'u1', unicode: '👍', createdAt: '2026-08-04T00:01:00.000Z' }),
      reaction({ id: 'r2', messageId: 'm1', userId: 'me', unicode: '👍', createdAt: '2026-08-04T00:02:00.000Z' }),
      reaction({ id: 'r3', messageId: 'm1', userId: 'u2', unicode: '❤️', createdAt: '2026-08-04T00:00:30.000Z' }),
      reaction({ id: 'r4', messageId: 'm2', userId: 'u1', unicode: '🙏', createdAt: '2026-08-04T00:03:00.000Z' }),
      reaction({
        id: 'r5',
        messageId: 'm1',
        userId: 'u3',
        unicode: '',
        reactionType: 'giphy',
        giphyId: 'g1',
      }),
    ];

    const byMessage = mapReactionsByMessageId(reactions);
    expect([...byMessage.keys()].sort()).toEqual(['m1', 'm2']);
    expect(byMessage.get('m1')?.map((r) => r.id)).toEqual(['r5', 'r3', 'r1', 'r2']);

    const groups = groupUnicodeReactions(byMessage.get('m1') ?? [], 'me');
    expect(groups.map((g) => g.unicode)).toEqual(['❤️', '👍']);
    expect(groups[0]).toMatchObject({ count: 1, reactedByMe: false, myReactionId: null });
    expect(groups[1]).toMatchObject({
      count: 2,
      reactedByMe: true,
      myReactionId: 'r2',
      userIds: ['u1', 'me'],
    });
  });

  it('findOwnUnicodeReaction matches identity', () => {
    const list = [reaction({ id: 'r1', messageId: 'm1', userId: 'me', unicode: '😮' })];
    expect(findOwnUnicodeReaction(list, 'm1', 'me', '😮')?.id).toBe('r1');
    expect(findOwnUnicodeReaction(list, 'm1', 'me', '😢')).toBeUndefined();
  });
});

describe('dedupe helpers', () => {
  it('dedupes user ids and merges recipient groups', () => {
    expect(dedupeUserIds(['a', 'a', '', 'b', 'a'])).toEqual(['a', 'b']);
    expect(dedupeReactionRecipients(['a', 'b'], null, ['b', 'c'], undefined)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('quick tray set', () => {
  it('exposes the Phase 2 quick unicode set', () => {
    expect(QUICK_UNICODE_REACTIONS).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏']);
    expect(isQuickUnicodeReaction('👍')).toBe(true);
    expect(isQuickUnicodeReaction('🔥')).toBe(false);
  });
});

describe('resolveGiphyReactionToggle', () => {
  const sampleItem = {
    id: 'gif-1',
    kind: 'gif' as const,
    title: 'Party',
    width: 200,
    height: 150,
    url: 'https://media.giphy.com/media/gif-1/200.gif',
    previewUrl: 'https://media.giphy.com/media/gif-1/100.gif',
    username: 'x',
    itemUrl: 'https://giphy.com/gifs/gif-1',
  };

  it('adds from picker item and removes when present (idempotent identity)', () => {
    const add = resolveGiphyReactionToggle([], {
      messageId: 'm1',
      userId: 'me',
      giphyId: 'gif-1',
      item: sampleItem,
    });
    expect(add.action).toBe('add');
    if (add.action !== 'add') return;
    expect(add.identityKey).toBe(buildGiphyReactionIdentityKey('m1', 'me', 'gif-1'));
    expect(add.clientMutationId).toBe(buildGiphyReactionMutationId('m1', 'me', 'gif-1', 'add'));
    expect(add.payload).toMatchObject({
      reactionType: 'giphy',
      unicode: '',
      giphyId: 'gif-1',
      giphyUrl: sampleItem.url,
      giphyPreviewUrl: sampleItem.previewUrl,
    });

    const existing = [
      reaction({
        id: 'r-g',
        messageId: 'm1',
        userId: 'me',
        unicode: '',
        reactionType: 'giphy',
        giphyId: 'gif-1',
        giphyKind: 'gif',
        giphyTitle: 'Party',
        giphyUrl: sampleItem.url,
        giphyPreviewUrl: sampleItem.previewUrl,
        clientMutationId: add.clientMutationId,
      }),
    ];
    const remove = resolveGiphyReactionToggle(existing, {
      messageId: 'm1',
      userId: 'me',
      giphyId: 'gif-1',
    });
    expect(remove).toMatchObject({
      action: 'remove',
      reactionId: 'r-g',
      clientMutationId: buildGiphyReactionMutationId('m1', 'me', 'gif-1', 'remove'),
    });
  });

  it('joins an existing giphy group from chip click without picker item', () => {
    const existing = [
      reaction({
        id: 'r-peer',
        messageId: 'm1',
        userId: 'u1',
        unicode: '',
        reactionType: 'giphy',
        giphyId: 'gif-1',
        giphyKind: 'sticker',
        giphyTitle: 'Wave',
        giphyUrl: sampleItem.url,
        giphyPreviewUrl: sampleItem.previewUrl,
      }),
    ];
    const add = resolveGiphyReactionToggle(existing, {
      messageId: 'm1',
      userId: 'me',
      giphyId: 'gif-1',
    });
    expect(add.action).toBe('add');
    if (add.action !== 'add') return;
    expect(add.payload.giphyKind).toBe('sticker');
    expect(add.payload.giphyUrl).toBe(sampleItem.url);
  });

  it('groups giphy reactions separately from unicode', () => {
    const reactions = [
      reaction({
        id: 'r1',
        messageId: 'm1',
        userId: 'u1',
        unicode: '',
        reactionType: 'giphy',
        giphyId: 'gif-1',
        giphyKind: 'gif',
        giphyTitle: 'A',
        giphyUrl: sampleItem.url,
        giphyPreviewUrl: sampleItem.previewUrl,
        createdAt: '2026-08-04T00:01:00.000Z',
      }),
      reaction({
        id: 'r2',
        messageId: 'm1',
        userId: 'me',
        unicode: '',
        reactionType: 'giphy',
        giphyId: 'gif-1',
        giphyKind: 'gif',
        giphyTitle: 'A',
        giphyUrl: sampleItem.url,
        giphyPreviewUrl: sampleItem.previewUrl,
        createdAt: '2026-08-04T00:02:00.000Z',
      }),
      reaction({ id: 'r3', messageId: 'm1', userId: 'u2', unicode: '👍' }),
    ];
    const groups = groupGiphyReactions(reactions, 'me');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      giphyId: 'gif-1',
      count: 2,
      reactedByMe: true,
      myReactionId: 'r2',
      userIds: ['u1', 'me'],
    });
    expect(findOwnGiphyReaction(reactions, 'm1', 'me', 'gif-1')?.id).toBe('r2');
    expect(groupUnicodeReactions(reactions, 'me')).toHaveLength(1);
  });
});
