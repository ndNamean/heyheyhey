// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityPost, CommunityReaction } from '../../types';
import { buildExtendedPack, extraCommonEn } from '../../i18n/extra';

const reactionUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: (links: Record<string, unknown>) => ({ type: 'reactionTx', value, links }),
}));
const reactionDeleteMock = vi.fn((id: string) => ({ type: 'reactionDelete', id }));
const postUpdateMock = vi.fn((value: Record<string, unknown>) => ({ type: 'postTx', value }));
const transactMock = vi.fn(async () => undefined);

vi.mock('@instantdb/react', () => ({ id: () => 'rxn-new' }));
vi.mock('../../db', () => ({
  db: {
    transact: (...args: unknown[]) => transactMock(...args),
    tx: {
      communityReactions: new Proxy(
        {},
        {
          get: (_target, prop: string) => ({
            update: reactionUpdateMock,
            delete: () => reactionDeleteMock(prop),
          }),
        },
      ),
      communityPosts: new Proxy(
        {},
        {
          get: () => ({
            update: postUpdateMock,
          }),
        },
      ),
    },
  },
}));
vi.mock('../../lib/utils', () => ({ nowIso: () => '2026-09-17T00:00:00.000Z' }));
vi.mock('../../lib/giphyClient', async () => {
  const actual = await vi.importActual<typeof import('../../lib/giphyClient')>(
    '../../lib/giphyClient',
  );
  return {
    ...actual,
    isGiphyConfigured: () => true,
  };
});

const pack = buildExtendedPack('en');
vi.mock('../../i18n', () => ({
  useLang: () => ({
    lang: 'en',
    isRtl: false,
    setLang: () => {},
    t: {
      common: extraCommonEn,
      storeChat: pack.storeChat,
    },
  }),
}));

vi.mock('../floating-assistant/GiphyPicker', () => ({
  GiphyPicker: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (item: {
      id: string;
      kind: 'gif';
      title: string;
      width: number;
      height: number;
      url: string;
      previewUrl: string;
      username: string;
      itemUrl: string;
    }) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onSelect({
            id: 'gif-rxn',
            kind: 'gif',
            title: 'React GIF',
            width: 100,
            height: 100,
            url: 'https://media.giphy.com/media/gif-rxn/200.gif',
            previewUrl: 'https://media.giphy.com/media/gif-rxn/100.gif',
            username: '',
            itemUrl: '',
          })
        }
      >
        Use GIF
      </button>
    ) : null,
}));

vi.mock('./CommunityReactionWho', () => ({
  default: ({ children }: { children: unknown }) => <span>{children}</span>,
}));

import CommunityReactions from './CommunityReactions';
import CommunityCommentReactions from './CommunityCommentReactions';

function post(extra: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: 'post-a',
    authorUserId: 'author-1',
    authorProfileId: 'p',
    authorNameSnapshot: 'Giathy',
    authorRoleSnapshot: '',
    body: 'Hello',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    status: 'active',
    deletedAt: '',
    famousVoteCount: 0,
    uniqueReactorCount: 2,
    uniqueCommenterCount: 1,
    commentCount: 1,
    lastActivityAt: '2026-09-07T00:00:00.000Z',
    moodBackgroundColor: '',
    moodBlob1Color: '',
    moodBlob2Color: '',
    ...extra,
  };
}

function reaction(
  extra: Partial<CommunityReaction> & Pick<CommunityReaction, 'id'>,
): CommunityReaction {
  return {
    postId: 'post-a',
    userId: extra.userId || extra.id,
    commentId: '',
    reactionType: 'unicode',
    unicode: '❤️',
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    createdAt: extra.createdAt || '2026-09-17T00:00:00.000Z',
    clientMutationId: extra.id,
    ...extra,
  };
}

describe('CommunityReactions scopes', () => {
  beforeEach(() => {
    transactMock.mockClear();
    transactMock.mockResolvedValue(undefined);
    reactionUpdateMock.mockClear();
    reactionDeleteMock.mockClear();
    postUpdateMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('writes empty commentId and uniqueReactorCount for post reactions', async () => {
    render(<CommunityReactions post={post()} reactions={[]} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add 👍 reaction' }));
    });
    expect(reactionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: 'post-a',
        userId: 'u1',
        commentId: '',
        unicode: '👍',
      }),
    );
    expect(postUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ uniqueReactorCount: 3 }),
    );
  });

  it('writes postId + commentId and skips uniqueReactorCount for comment reactions', async () => {
    render(
      <CommunityCommentReactions
        post={post()}
        commentId="c1"
        reactions={[reaction({ id: 'other', commentId: 'c2', unicode: '😂', userId: 'u9' })]}
        userId="u1"
      />,
    );
    expect(screen.queryByLabelText(/😂/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add 😂 reaction' }));
    });
    expect(reactionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: 'post-a',
        userId: 'u1',
        commentId: 'c1',
        unicode: '😂',
      }),
    );
    expect(postUpdateMock).not.toHaveBeenCalled();
  });

  it('toggles off a comment GIF reaction without touching the post counter', async () => {
    render(
      <CommunityCommentReactions
        post={post()}
        commentId="c-reply"
        reactions={[
          reaction({
            id: 'mine-gif',
            userId: 'u1',
            commentId: 'c-reply',
            reactionType: 'giphy',
            unicode: '',
            giphyId: 'gif-rxn',
            giphyTitle: 'React GIF',
            giphyUrl: 'https://media.giphy.com/media/gif-rxn/200.gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/gif-rxn/100.gif',
          }),
        ]}
        userId="u1"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /React GIF/ }));
    });
    expect(reactionDeleteMock).toHaveBeenCalledWith('mine-gif');
    expect(postUpdateMock).not.toHaveBeenCalled();
  });

  it('does not duplicate a comment reaction on overlapping clicks', async () => {
    let release: ((value?: unknown) => void) | undefined;
    transactMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(
      <CommunityCommentReactions post={post()} commentId="c1" reactions={[]} userId="u1" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 👍 reaction' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 👍 reaction' }));
    expect(reactionUpdateMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
    });
  });

  it('adds a GIF reaction on a comment from the picker', async () => {
    render(
      <CommunityCommentReactions post={post()} commentId="c1" reactions={[]} userId="u1" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search GIPHY reactions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use GIF' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(reactionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 'c1',
        reactionType: 'giphy',
        giphyId: 'gif-rxn',
        unicode: '',
      }),
    );
    expect(postUpdateMock).not.toHaveBeenCalled();
  });
});
