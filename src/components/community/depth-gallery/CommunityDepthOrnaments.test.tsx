// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import CommunityDepthOrnaments from './CommunityDepthOrnaments';

vi.mock('../../profileAvatar/ProfileAvatar', () => ({
  default: ({ profile }: { profile: { displayName?: string } }) => (
    <div className="avatar-circle">{profile.displayName || 'avatar'}</div>
  ),
}));

function post(extra: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: 'post-a',
    authorUserId: 'author-1',
    authorProfileId: 'p',
    authorNameSnapshot: 'Giathy',
    authorRoleSnapshot: '',
    body: 'Sunset from the terrace',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    status: 'active',
    deletedAt: '',
    attachmentKind: 'image',
    attachmentPath: 'stores/community/post-a/a.jpg',
    attachmentFileId: 'f',
    attachmentUrl: 'https://example.com/post-a.jpg',
    attachmentMimeType: 'image/jpeg',
    attachmentFileName: 'a.jpg',
    attachmentBytes: '1',
    attachmentWidth: '10',
    attachmentHeight: '10',
    famousVoteCount: 0,
    uniqueReactorCount: 0,
    uniqueCommenterCount: 0,
    commentCount: 0,
    lastActivityAt: '2026-09-07T00:00:00.000Z',
    moodBackgroundColor: '#fffaf0',
    moodBlob1Color: '#ffdf94',
    moodBlob2Color: '#fce7c4',
    ...extra,
  };
}

function reaction(extra: Partial<CommunityReaction> & Pick<CommunityReaction, 'id'>): CommunityReaction {
  return {
    postId: 'post-a',
    userId: extra.userId || extra.id,
    commentId: '',
    reactionType: 'unicode',
    unicode: '❤️',
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    createdAt: extra.createdAt || '2026-09-01T00:00:00.000Z',
    clientMutationId: extra.id,
    ...extra,
  };
}

function comment(extra: Partial<CommunityComment> & Pick<CommunityComment, 'id'>): CommunityComment {
  return {
    postId: 'post-a',
    parentId: '',
    authorUserId: extra.authorUserId || extra.id,
    authorProfileId: 'p',
    authorNameSnapshot: extra.authorNameSnapshot || extra.id,
    authorRoleSnapshot: '',
    body: extra.body || `hello ${extra.id}`,
    createdAt: extra.createdAt || '2026-09-08T00:00:00.000Z',
    status: 'active',
    deletedAt: '',
    ...extra,
  };
}

describe('CommunityDepthOrnaments', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders display-only reaction circles and author/comment rects without feed pills', () => {
    const { container } = render(
      <CommunityDepthOrnaments
        post={post()}
        reactions={[
          reaction({ id: 'r1', unicode: '🔥', createdAt: '2026-09-01T00:00:00.000Z' }),
          reaction({ id: 'skip', commentId: 'c-thread', createdAt: '2026-08-01T00:00:00.000Z' }),
        ]}
        comments={[
          comment({
            id: 'c-new',
            authorNameSnapshot: 'Minh',
            body: 'Love this light',
            createdAt: '2026-09-08T00:00:00.000Z',
          }),
          comment({
            id: 'c-reply',
            parentId: 'c-new',
            authorNameSnapshot: 'Hidden reply',
            createdAt: '2026-09-09T00:00:00.000Z',
          }),
        ]}
        reactorProfiles={new Map()}
      />,
    );

    expect(container.querySelectorAll('.community-depth-react')).toHaveLength(1);
    expect(container.querySelector('.community-depth-react-emoji')?.textContent).toBe('🔥');
    expect(container.querySelector('.community-reaction-chip-wrap')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('.community-depth-author-name')?.textContent).toBe('Giathy');
    expect(container.querySelector('.community-depth-author-body')?.textContent).toBe(
      'Sunset from the terrace',
    );
    expect(container.querySelector('.community-depth-comment-name')?.textContent).toBe('Minh');
    expect(container.querySelector('.community-depth-comment--giphy')).toBeNull();
    expect(container.querySelector('.community-depth-comment--reply')?.textContent).toContain(
      'Hidden reply',
    );
    expect(container.querySelectorAll('.community-depth-comment--reply')).toHaveLength(1);

    const chip = container.querySelector('.community-depth-react') as HTMLElement;
    expect(chip.style.getPropertyValue('--rest-left')).not.toBe('');
    expect(chip.style.getPropertyValue('--rest-top')).not.toBe('');
    expect(chip.style.getPropertyValue('--inner-left')).not.toBe('');
    expect(chip.style.getPropertyValue('--inner-top')).not.toBe('');
    const restLeft = Number(chip.style.getPropertyValue('--rest-left'));
    const restTop = Number(chip.style.getPropertyValue('--rest-top'));
    const innerLeft = Number(chip.style.getPropertyValue('--inner-left'));
    const innerTop = Number(chip.style.getPropertyValue('--inner-top'));
    expect(innerLeft !== restLeft || innerTop !== restTop).toBe(true);
  });

  it('shows a GIF-content thumb on GIF-only comment pills, not on the post reaction arc', () => {
    const { container } = render(
      <CommunityDepthOrnaments
        post={post()}
        reactions={[
          reaction({
            id: 'r-gif',
            reactionType: 'giphy',
            unicode: '',
            giphyId: 'rxn',
            giphyUrl: 'https://media.giphy.com/media/rxn/200.gif',
          }),
        ]}
        comments={[
          comment({
            id: 'c-gif',
            authorNameSnapshot: 'Minh',
            body: '',
            giphyId: 'body-gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/body-gif/100.gif',
            giphyUrl: 'https://media.giphy.com/media/body-gif/200.gif',
          }),
        ]}
        reactorProfiles={new Map()}
      />,
    );
    expect(container.querySelector('.community-depth-react-giphy')?.getAttribute('src')).toContain(
      'rxn/200.gif',
    );
    const thumb = container.querySelector('.community-depth-comment-giphy') as HTMLImageElement | null;
    expect(thumb?.src).toContain('body-gif/100.gif');
    expect(container.querySelector('.community-depth-comment--giphy')).toBeTruthy();
    expect(container.querySelector('.community-depth-comment-body')).toBeNull();
  });

  it('shows the attached GIF thumb next to text on text+GIF comment pills', () => {
    const { container } = render(
      <CommunityDepthOrnaments
        post={post()}
        reactions={[]}
        comments={[
          comment({
            id: 'c-text-gif',
            authorNameSnapshot: 'Minh',
            body: '🐟',
            giphyId: 'body-gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/body-gif/100.gif',
            giphyUrl: 'https://media.giphy.com/media/body-gif/200.gif',
          }),
        ]}
        reactorProfiles={new Map()}
      />,
    );
    expect(container.querySelector('.community-depth-comment-body')?.textContent).toBe('🐟');
    expect(container.querySelector('.community-depth-comment--giphy')).toBeTruthy();
    expect(container.querySelector('.community-depth-comment-giphy')?.getAttribute('src')).toContain(
      'body-gif/100.gif',
    );
  });

  it('shows an attached photo thumb on the same large comment pill as GIF content', () => {
    const { container } = render(
      <CommunityDepthOrnaments
        post={post()}
        reactions={[]}
        comments={[
          comment({
            id: 'c-photo',
            authorNameSnapshot: 'Minh',
            body: 'catch',
            attachmentKind: 'image',
            attachmentUrl: 'https://example.com/c.jpg',
            attachmentPath: 'stores/community/post-a/c.jpg',
          }),
        ]}
        reactorProfiles={new Map()}
      />,
    );
    expect(container.querySelector('.community-depth-comment--photo')).toBeTruthy();
    expect(container.querySelector('.community-depth-comment-giphy')?.getAttribute('src')).toContain(
      'c.jpg',
    );
    expect(container.querySelector('.community-depth-comment-body')?.textContent).toBe('catch');
  });

  it('renders up to 3 reaction badges on the comment pill without a count or click target', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css).toContain('.community-depth-gallery .community-depth-comment-badges');
    expect(css).toContain('flex-basis: 100%');
    expect(css).toContain('white-space: nowrap');

    const { container } = render(
      <CommunityDepthOrnaments
        post={post()}
        reactions={[
          reaction({ id: 'post-arc', unicode: '😮' }),
          reaction({ id: 'b1', commentId: 'c-gif', unicode: '❤️', userId: 'u1' }),
          reaction({ id: 'b2', commentId: 'c-gif', unicode: '❤️', userId: 'u2' }),
          reaction({
            id: 'b3',
            commentId: 'c-gif',
            reactionType: 'giphy',
            unicode: '',
            giphyId: 'badge-gif',
            giphyUrl: 'https://media.giphy.com/media/badge-gif/200.gif',
          }),
        ]}
        comments={[
          comment({
            id: 'c-gif',
            authorNameSnapshot: 'Minh',
            body: '',
            giphyId: 'body-gif',
            giphyPreviewUrl: 'https://media.giphy.com/media/body-gif/100.gif',
            giphyUrl: 'https://media.giphy.com/media/body-gif/200.gif',
          }),
        ]}
        reactorProfiles={new Map()}
      />,
    );
    expect(container.querySelector('.community-depth-react-emoji')?.textContent).toBe('😮');
    expect(container.querySelector('.community-depth-comment-badge-emoji')?.textContent).toBe('❤️');
    expect(container.querySelector('.community-depth-comment-badge-giphy')?.getAttribute('src')).toContain(
      'badge-gif',
    );
    expect(container.querySelector('.community-depth-comment-giphy')?.getAttribute('src')).toContain(
      'body-gif/100.gif',
    );
    expect(container.querySelector('.community-depth-comment-badge-count')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps a long comment body uncut in the DOM and wraps body CSS without ellipsis', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    const bodyBlock = css.match(
      /\.community-depth-author-body,\s*\.community-depth-comment-body \{[^}]+\}/,
    )?.[0];
    expect(bodyBlock).toContain('white-space: normal');
    expect(bodyBlock).toContain('overflow: visible');
    expect(bodyBlock).toContain('word-break: break-word');
    expect(bodyBlock).not.toContain('nowrap');
    expect(bodyBlock).not.toContain('ellipsis');
    expect(css).toMatch(
      /\.community-depth-author-name,\s*\.community-depth-comment-name \{[\s\S]*?text-overflow: ellipsis/,
    );
    expect(css).toMatch(
      /\.community-depth-author,\s*\.community-depth-comment \{[\s\S]*?align-items: flex-start/,
    );

    const long =
      'abcdefghijklmnopqrstuvwxyz 1234567890 plus extra words that go well past forty eight characters';
    const { container } = render(
      <CommunityDepthOrnaments
        post={post({ body: long })}
        reactions={[]}
        comments={[
          comment({
            id: 'c-long',
            authorNameSnapshot: 'Minh',
            body: long,
          }),
        ]}
        reactorProfiles={new Map()}
      />,
    );
    expect(container.querySelector('.community-depth-author-body')?.textContent).toBe(long);
    expect(container.querySelector('.community-depth-comment-body')?.textContent).toBe(long);
  });

  it('omits the reaction band when a post has no reactions but still shows the author', () => {
    const { container } = render(
      <CommunityDepthOrnaments
        post={post({ body: '' })}
        reactions={[]}
        comments={[]}
        reactorProfiles={new Map()}
      />,
    );
    expect(container.querySelector('.community-depth-reacts')).toBeNull();
    expect(container.querySelector('.community-depth-author')).toBeTruthy();
    expect(container.querySelectorAll('.community-depth-comment')).toHaveLength(0);
  });

  it('lerps reaction chip scale from 2.5 at rest to 1.12 when idle', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css).toContain('scale(calc(2.5 + (1.12 - 2.5) * var(--idle, 0)))');
    expect(css).toContain('scale(calc(1.4 + (1.12 - 1.4) * var(--idle, 0)))');
    expect(css).toContain('scale(calc(1.15 + (0.95 - 1.15) * var(--idle, 0)))');
    expect(css).toContain('.community-depth-comment--reply');
    expect(css).toContain(
      'translate(-50%, calc(10px * (1 - var(--idle, 0)))) scale(calc(1.4 + (1 - 1.4) * var(--idle, 0)))',
    );
    expect(css).toContain('.community-depth-comment--giphy');
    expect(css).toContain('.community-depth-comment--photo');
    expect(css).toContain('min(70%, 280px)');
    expect(css).toMatch(/\.community-depth-comment-giphy \{[\s\S]*?width: 120px;/);
    expect(css).not.toMatch(/\.community-depth-comment--giphy \{[\s\S]*?scale\(calc\(2\.5/);
  });
});
