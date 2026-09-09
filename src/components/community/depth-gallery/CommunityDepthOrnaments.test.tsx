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
    expect(container.textContent).not.toContain('Hidden reply');

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
    expect(css).toContain(
      'translate(-50%, calc(10px * (1 - var(--idle, 0)))) scale(calc(1.4 + (1 - 1.4) * var(--idle, 0)))',
    );
  });
});
