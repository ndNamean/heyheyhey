// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityComment, CommunityPost, Profile } from '../../types';
import { buildExtendedPack, extraCommonEn } from '../../i18n/extra';

const commentUpdateMock = vi.fn((value: Record<string, unknown>) => ({
  link: (links: Record<string, unknown>) => ({ type: 'commentTx', value, links }),
}));
const commentStatusMock = vi.fn((value: Record<string, unknown>) => ({ type: 'commentStatus', value }));
const postUpdateMock = vi.fn((value: Record<string, unknown>) => ({ type: 'postTx', value }));
const transactMock = vi.fn(async () => undefined);

vi.mock('@instantdb/react', () => ({ id: () => 'comment-new' }));
vi.mock('../../db', () => ({
  db: {
    transact: (...args: unknown[]) => transactMock(...args),
    tx: {
      communityComments: new Proxy(
        {},
        {
          get: () => ({
            update: (value: Record<string, unknown>) => {
              if ('status' in value && !('postId' in value)) {
                return commentStatusMock(value);
              }
              return commentUpdateMock(value);
            },
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

const giphyConfiguredMock = vi.fn(() => true);
vi.mock('../../lib/giphyClient', async () => {
  const actual = await vi.importActual<typeof import('../../lib/giphyClient')>(
    '../../lib/giphyClient',
  );
  return {
    ...actual,
    isGiphyConfigured: () => giphyConfiguredMock(),
  };
});

const pack = buildExtendedPack('en');
vi.mock('../../i18n', () => ({
  useLang: () => ({
    lang: 'en',
    isRtl: false,
    setLang: () => {},
    t: {
      common: { ...extraCommonEn, close: 'Close' },
      community: pack.community,
      storeChat: pack.storeChat,
    },
  }),
}));

vi.mock('../profileAvatar/IdentityWithAvatar', () => ({
  default: ({ children }: { children: unknown }) => <span>{children}</span>,
}));

vi.mock('../floating-assistant/GiphyMediaPreview', () => ({
  GiphyMediaPreview: ({
    item,
    onClear,
  }: {
    item: { title: string };
    onClear?: () => void;
  }) => (
    <div>
      <span>{item.title}</span>
      <button type="button" onClick={onClear}>
        Remove GIF
      </button>
    </div>
  ),
}));

vi.mock('../floating-assistant/ChatAttachmentPreview', () => ({
  ChatAttachmentPreview: ({
    item,
    onClear,
  }: {
    item: { fileName: string };
    onClear?: () => void;
  }) => (
    <div>
      <span>{item.fileName}</span>
      <button type="button" onClick={onClear}>
        Remove photo
      </button>
    </div>
  ),
}));

vi.mock('../../lib/chatAttachmentUpload', () => ({
  uploadChatAttachment: vi.fn(async () => ({
    fileId: 'file-1',
    url: 'https://example.com/c.jpg',
    path: 'stores/community/post-a/c.jpg',
    mimeType: 'image/jpeg',
    bytes: 12,
    fileName: 'c.jpg',
    kind: 'image',
  })),
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
            id: 'gif-abc',
            kind: 'gif',
            title: 'Party parrot',
            width: 200,
            height: 150,
            url: 'https://media.giphy.com/media/gif-abc/200.gif',
            previewUrl: 'https://media.giphy.com/media/gif-abc/100.gif',
            username: '',
            itemUrl: '',
          })
        }
      >
        Use GIF
      </button>
    ) : null,
}));

import CommunityComments from './CommunityComments';
import { uploadChatAttachment } from '../../lib/chatAttachmentUpload';

const uploadMock = vi.mocked(uploadChatAttachment);

function profile(extra: Partial<Profile> = {}): Profile {
  return {
    id: 'prof-1',
    userId: 'u1',
    email: 'u1@example.com',
    displayName: 'Ada',
    role: 'staff',
    approvalStatus: 'approved',
    approvedAt: '',
    approvedByEmail: '',
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

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
    uniqueReactorCount: 0,
    uniqueCommenterCount: 0,
    commentCount: 1,
    lastActivityAt: '2026-09-07T00:00:00.000Z',
    moodBackgroundColor: '',
    moodBlob1Color: '',
    moodBlob2Color: '',
    ...extra,
  };
}

function comment(
  extra: Partial<CommunityComment> & Pick<CommunityComment, 'id'>,
): CommunityComment {
  return {
    postId: 'post-a',
    parentId: '',
    authorUserId: extra.authorUserId || extra.id,
    authorProfileId: 'p',
    authorNameSnapshot: extra.authorNameSnapshot || extra.id,
    authorRoleSnapshot: '',
    body: extra.body ?? `hello ${extra.id}`,
    createdAt: extra.createdAt || '2026-09-08T00:00:00.000Z',
    status: 'active',
    deletedAt: '',
    ...extra,
  };
}

describe('CommunityComments GIF content', () => {
  beforeEach(() => {
    transactMock.mockClear();
    commentUpdateMock.mockClear();
    commentStatusMock.mockClear();
    postUpdateMock.mockClear();
    giphyConfiguredMock.mockReturnValue(true);
    uploadMock.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sends all empty GIF keys with a text comment', async () => {
    render(<CommunityComments post={post()} comments={[]} profile={profile()} />);
    fireEvent.change(screen.getByPlaceholderText('Write a comment…'), {
      target: { value: 'typed 🔥 emoji' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(commentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'typed 🔥 emoji',
        parentId: '',
        giphyId: '',
        giphyKind: '',
        giphyTitle: '',
        giphyWidth: '',
        giphyHeight: '',
        giphyUrl: '',
        giphyPreviewUrl: '',
        attachmentKind: '',
        attachmentPath: '',
        attachmentFileId: '',
        attachmentUrl: '',
      }),
    );
  });

  it('sends a GIF-only comment with empty body and stored GIPHY fields', async () => {
    render(<CommunityComments post={post()} comments={[]} profile={profile()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add GIF' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use GIF' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(commentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '',
        giphyId: 'gif-abc',
        giphyKind: 'gif',
        giphyTitle: 'Party parrot',
        giphyUrl: 'https://media.giphy.com/media/gif-abc/200.gif',
        giphyPreviewUrl: 'https://media.giphy.com/media/gif-abc/100.gif',
        parentId: '',
      }),
    );
  });

  it('sends text plus GIF together and a one-level GIF reply under the parent', async () => {
    render(
      <CommunityComments
        post={post()}
        comments={[comment({ id: 'c-top', authorNameSnapshot: 'Minh', body: 'hi' })]}
        profile={profile()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByPlaceholderText('Write a reply…'), {
      target: { value: 'look' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add GIF' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use GIF' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(commentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'look',
        parentId: 'c-top',
        giphyId: 'gif-abc',
      }),
    );
  });

  it('renders GIF content and body, and hides GIF when GIPHY is not configured', () => {
    const { rerender } = render(
      <CommunityComments
        post={post()}
        comments={[
          comment({
            id: 'c-gif',
            authorNameSnapshot: 'Minh',
            body: 'nice',
            giphyId: 'abc',
            giphyKind: 'gif',
            giphyTitle: 'Party parrot',
            giphyUrl: 'https://media.giphy.com/media/abc/200.gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/abc/100.gif',
          }),
          comment({
            id: 'legacy',
            authorNameSnapshot: 'Old',
            body: 'plain text only',
          }),
        ]}
        profile={profile()}
      />,
    );
    expect(screen.getByRole('img', { name: 'Party parrot' })).toBeTruthy();
    expect(screen.getByText('nice')).toBeTruthy();
    expect(screen.getByText('plain text only')).toBeTruthy();

    giphyConfiguredMock.mockReturnValue(false);
    rerender(<CommunityComments post={post()} comments={[]} profile={profile()} />);
    expect(screen.queryByRole('button', { name: 'Add GIF' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides GIF content with the comment on delete', async () => {
    render(
      <CommunityComments
        post={post()}
        comments={[
          comment({
            id: 'c-gif',
            authorUserId: 'u1',
            authorNameSnapshot: 'Ada',
            body: '',
            giphyId: 'abc',
            giphyKind: 'gif',
            giphyTitle: 'Party parrot',
            giphyUrl: 'https://media.giphy.com/media/abc/200.gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/abc/100.gif',
          }),
        ]}
        profile={profile()}
      />,
    );
    expect(screen.getByRole('img', { name: 'Party parrot' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }));
    });
    expect(commentStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'deleted' }),
    );
  });

  it('keeps comment reaction chips scoped per comment and omits them on hidden rows', () => {
    render(
      <CommunityComments
        post={post()}
        comments={[
          comment({ id: 'c1', authorNameSnapshot: 'Minh', body: 'one' }),
          comment({ id: 'c2', authorNameSnapshot: 'Lan', body: 'two' }),
          comment({
            id: 'c-hidden',
            authorNameSnapshot: 'Oldie',
            body: 'gone',
            status: 'hidden',
          }),
          comment({
            id: 'c-reply',
            parentId: 'c1',
            authorNameSnapshot: 'Reply',
            body: 'nested',
          }),
        ]}
        profile={profile({ role: 'areaManager' })}
        reactions={[
          {
            id: 'r-c1',
            postId: 'post-a',
            userId: 'u9',
            commentId: 'c1',
            reactionType: 'unicode',
            unicode: '😂',
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            createdAt: '2026-09-17T00:00:00.000Z',
            clientMutationId: 'r-c1',
          },
          {
            id: 'r-c2',
            postId: 'post-a',
            userId: 'u8',
            commentId: 'c2',
            reactionType: 'unicode',
            unicode: '🙏',
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            createdAt: '2026-09-17T00:00:00.000Z',
            clientMutationId: 'r-c2',
          },
          {
            id: 'r-hidden',
            postId: 'post-a',
            userId: 'u7',
            commentId: 'c-hidden',
            reactionType: 'unicode',
            unicode: '🔥',
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            createdAt: '2026-09-17T00:00:00.000Z',
            clientMutationId: 'r-hidden',
          },
          {
            id: 'r-reply',
            postId: 'post-a',
            userId: 'u6',
            commentId: 'c-reply',
            reactionType: 'unicode',
            unicode: '👍',
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            createdAt: '2026-09-17T00:00:00.000Z',
            clientMutationId: 'r-reply',
          },
          {
            id: 'r-post',
            postId: 'post-a',
            userId: 'u5',
            commentId: '',
            reactionType: 'unicode',
            unicode: '😮',
            giphyId: '',
            giphyKind: '',
            giphyTitle: '',
            createdAt: '2026-09-17T00:00:00.000Z',
            clientMutationId: 'r-post',
          },
        ]}
      />,
    );
    const minh = screen.getByText('Minh').closest('.community-comment') as HTMLElement;
    const lan = screen.getByText('Lan').closest('.community-comment') as HTMLElement;
    expect(minh.textContent).toContain('😂');
    expect(minh.textContent).not.toContain('🙏');
    expect(lan.textContent).toContain('🙏');
    expect(lan.textContent).not.toContain('😂');
    expect(screen.getByText('nested').closest('.community-comment')?.textContent).toContain('👍');
    expect(screen.getByText('Oldie').closest('.community-comment--muted')?.querySelector('.community-reactions')).toBeNull();
    expect(screen.queryByLabelText(/🔥/)).toBeNull();
    expect(screen.queryByLabelText(/😮/)).toBeNull();
    expect(document.querySelectorAll('.community-comment--reply .community-reactions--comment')).toHaveLength(
      1,
    );
  });

  it('uploads a jpeg and persists photo fields without GIF keys', async () => {
    render(<CommunityComments post={post()} comments={[]} profile={profile()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['abc'], 'fish.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(uploadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'community',
        postId: 'post-a',
        mimeType: 'image/jpeg',
        enabled: true,
      }),
    );
    expect(commentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '',
        giphyId: '',
        attachmentKind: 'image',
        attachmentUrl: 'https://example.com/c.jpg',
        attachmentPath: 'stores/community/post-a/c.jpg',
        attachmentFileId: 'file-1',
      }),
    );
  });
});
