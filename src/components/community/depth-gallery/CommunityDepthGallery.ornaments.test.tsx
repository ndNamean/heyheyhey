// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityComment, CommunityPost, CommunityReaction } from '../../../types';
import CommunityDepthGallery from './CommunityDepthGallery';
import { containRectForStack } from './galleryIdle';
import { AUTHOR_IDLE_TOP_PCT, buildGalleryOrnamentLayout } from './galleryOrnaments';
import {
  ornamentRippleAuthorKey,
  ornamentRippleCommentKey,
  ornamentRippleReactionKey,
} from './ornamentRipple';

vi.mock('../../profileAvatar/ProfileAvatar', () => ({
  default: ({ profile }: { profile: { displayName?: string } }) => (
    <div className="avatar-circle">{profile.displayName || 'avatar'}</div>
  ),
}));

function reaction(postId: string, extra: Partial<CommunityReaction> & Pick<CommunityReaction, 'id'>): CommunityReaction {
  return {
    postId,
    userId: extra.userId || extra.id,
    commentId: '',
    reactionType: 'unicode',
    unicode: '🔥',
    giphyId: '',
    giphyKind: '',
    giphyTitle: '',
    createdAt: extra.createdAt || '2026-09-01T00:00:00.000Z',
    clientMutationId: extra.id,
    ...extra,
  };
}

function comment(postId: string, extra: Partial<CommunityComment> & Pick<CommunityComment, 'id'>): CommunityComment {
  return {
    postId,
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

function imagePost(id: string, extra: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id,
    authorUserId: 'u',
    authorProfileId: 'p',
    authorNameSnapshot: `Author ${id}`,
    authorRoleSnapshot: '',
    body: `Body ${id}`,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    status: 'active',
    deletedAt: '',
    attachmentKind: 'image',
    attachmentPath: `stores/community/${id}/a.jpg`,
    attachmentFileId: 'f',
    attachmentUrl: `https://example.com/${id}.jpg`,
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

let rafQueue: FrameRequestCallback[] = [];

function flushFrames(count = 1, start = 16) {
  let now = start;
  act(() => {
    for (let i = 0; i < count; i++) {
      const queued = rafQueue;
      rafQueue = [];
      for (const cb of queued) cb(now);
      now += 16;
    }
  });
}

function parseScale(transform: string): number {
  const match = transform.match(/scale\(([-+\d.eE]+)\)/);
  return match ? Number(match[1]) : Number.NaN;
}

function parsePx(value: string): number {
  return Number.parseFloat(value);
}

function expectNativeClipBox(clip: HTMLElement, stackW: number, stackH: number, imageW: number, imageH: number) {
  const rect = containRectForStack(stackW, stackH, imageW, imageH);
  expect(parsePx(clip.style.width)).toBeCloseTo(rect.width, 5);
  expect(parsePx(clip.style.height)).toBeCloseTo(rect.height, 5);
  expect(parsePx(clip.style.left)).toBeCloseTo(rect.left, 5);
  expect(parsePx(clip.style.top)).toBeCloseTo(rect.top, 5);
  expect(clip.style.right).toBe('auto');
  expect(clip.style.bottom).toBe('auto');
}

function mockGalleryBox(overlayW: number, overlayH: number, box = 300) {
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('community-depth-gallery') ? overlayW : box;
  });
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('community-depth-gallery') ? overlayH : box;
  });
  return () => {
    width.mockRestore();
    height.mockRestore();
  };
}

describe('CommunityDepthGallery ornaments', () => {
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      rafQueue = [];
    });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('nests ornaments inside each depth layer and fades non-centered planes in the existing frame loop', () => {
    const posts = [imagePost('p0'), imagePost('p1'), imagePost('p2')];
    const { container } = render(
      <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
    );

    const layers = container.querySelectorAll('.community-depth-layer');
    expect(layers).toHaveLength(3);
    layers.forEach((layer) => {
      expect(layer.querySelector('.community-depth-image-clip .community-depth-image')).toBeTruthy();
      expect(layer.querySelector(':scope > .community-depth-ornaments')).toBeTruthy();
      expect(layer.querySelector(':scope > .community-depth-ripples')).toBeTruthy();
      expect(layer.querySelector('.community-depth-ornaments .community-depth-ripple')).toBeNull();
      expect(layer.querySelector('.community-depth-author-name')).toBeTruthy();
    });
    expect(container.querySelectorAll('.community-depth-ornaments button')).toHaveLength(0);
    expect(container.querySelector('.community-depth-close')?.textContent).toMatch(/back to post/i);

    flushFrames(12);

    const ornaments = [...container.querySelectorAll('.community-depth-ornaments')] as HTMLElement[];
    expect(Number(ornaments[0].style.opacity)).toBeGreaterThan(0.6);
    expect(Number(ornaments[1].style.opacity)).toBeLessThan(0.2);
    expect(Number(ornaments[2].style.opacity)).toBe(0);
  });

  it('scales the stack in portrait so ornaments inherit the same 0.65 transform', () => {
    const width = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('community-depth-gallery') ? 390 : 300;
      });
    const height = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('community-depth-gallery') ? 844 : 300;
      });

    const { container } = render(
      <CommunityDepthGallery
        sourcePosts={[imagePost('p0'), imagePost('p1')]}
        startPostId="p0"
        onClose={() => {}}
      />,
    );
    try {
      flushFrames(6);
      expect((container.querySelector('.community-depth-stack') as HTMLElement).style.transform).toBe(
        'translate(-50%, -50%) scale(0.65)',
      );
      expect(container.querySelector('.community-depth-stack .community-depth-ornaments')).toBeTruthy();
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });

  it('clears leftover ornaments after a fast jump to the last plane and still settles the last image', { timeout: 20000 }, () => {
    const posts = [imagePost('p0'), imagePost('p1'), imagePost('p2')];
    const { container } = render(
      <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
    );
    const dialog = container.querySelector('.community-depth-gallery') as HTMLElement;
    flushFrames(4);

    fireEvent.keyDown(dialog, { key: 'End' });
    flushFrames(90);

    const ornaments = [...container.querySelectorAll('.community-depth-ornaments')] as HTMLElement[];
    const images = [...container.querySelectorAll('.community-depth-image')] as HTMLElement[];
    expect(Number(ornaments[0].style.opacity)).toBe(0);
    expect(Number(ornaments[1].style.opacity)).toBeLessThan(0.15);
    expect(Number(images[2].style.opacity)).toBeGreaterThan(0.6);
    expect(Number(images[0].style.opacity)).toBeLessThan(0.2);
  });

  it('zooms the current/next pair toward stack cover after dwell and writes --idle', { timeout: 20000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const posts = [imagePost('p0', landscape), imagePost('p1', landscape), imagePost('p2', landscape)];
    try {
      const { container } = render(
        <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
      );
      flushFrames(32);
      const images = [...container.querySelectorAll('.community-depth-image')] as HTMLElement[];
      const ornaments = [...container.querySelectorAll('.community-depth-ornaments')] as HTMLElement[];
      const pairScale = parseScale(images[0].style.transform);
      const otherScale = parseScale(images[2].style.transform);
      expect(pairScale).toBeGreaterThan(0.99);
      expect(pairScale).toBeLessThan(1.03);
      expect(otherScale).toBeLessThan(1.03);
      expect(Number(ornaments[0].style.getPropertyValue('--idle'))).toBeGreaterThan(0.5);
      expect(Number(ornaments[1].style.getPropertyValue('--idle'))).toBeGreaterThan(0.5);
      expect(Number(ornaments[2].style.getPropertyValue('--idle'))).toBe(0);
    } finally {
      restore();
    }
  });

  it('vanishes pair ornaments after inward then restores on scroll', { timeout: 20000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const posts = [imagePost('p0', landscape), imagePost('p1', landscape)];
    try {
      const { container } = render(
        <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
      );
      const dialog = container.querySelector('.community-depth-gallery') as HTMLElement;
      flushFrames(700);
      const ornaments = [...container.querySelectorAll('.community-depth-ornaments')] as HTMLElement[];
      const idleBefore = Number(ornaments[0].style.getPropertyValue('--idle'));
      const opacityBefore = Number(ornaments[0].style.opacity);
      expect(opacityBefore).toBeLessThan(0.15);
      expect(idleBefore).toBeGreaterThan(0.9);

      fireEvent.keyDown(dialog, { key: 'ArrowDown' });
      flushFrames(3);
      const idleAfter = Number(ornaments[0].style.getPropertyValue('--idle'));
      const opacityAfter = Number(ornaments[0].style.opacity);
      expect(opacityAfter).toBeGreaterThan(opacityBefore);
      expect(opacityAfter).toBeGreaterThan(0.2);
      expect(idleAfter).toBeLessThan(idleBefore);
    } finally {
      restore();
    }
  });

  it('eases idle zoom back out as soon as scrolling starts', { timeout: 20000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const posts = [imagePost('p0', landscape), imagePost('p1', landscape)];
    try {
      const { container } = render(
        <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
      );
      const dialog = container.querySelector('.community-depth-gallery') as HTMLElement;
      flushFrames(32);
      const ornaments = [...container.querySelectorAll('.community-depth-ornaments')] as HTMLElement[];
      const idleBefore = Number(ornaments[0].style.getPropertyValue('--idle'));
      const scaleBefore = parseScale(
        (container.querySelectorAll('.community-depth-image')[0] as HTMLElement).style.transform,
      );
      expect(idleBefore).toBeGreaterThan(0.5);

      fireEvent.keyDown(dialog, { key: 'ArrowDown' });
      flushFrames(8);
      const idleAfter = Number(ornaments[0].style.getPropertyValue('--idle'));
      const scaleAfter = parseScale(
        (container.querySelectorAll('.community-depth-image')[0] as HTMLElement).style.transform,
      );
      expect(idleAfter).toBeLessThan(idleBefore);
      expect(scaleBefore).toBeLessThan(1.03);
      expect(scaleAfter).toBeLessThan(1.03);
    } finally {
      restore();
    }
  });

  it('sizes landscape clips to the contain-fitted photo ratio', { timeout: 20000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const posts = [imagePost('p0', landscape), imagePost('p1', landscape), imagePost('p2', landscape)];
    try {
      const { container } = render(
        <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
      );
      flushFrames(32);
      const clips = [...container.querySelectorAll('.community-depth-image-clip')] as HTMLElement[];
      const images = [...container.querySelectorAll('.community-depth-image')] as HTMLElement[];
      const stack = 300;
      expect(parsePx(clips[0].style.width)).toBeCloseTo(stack, 5);
      expect(parsePx(clips[0].style.height)).toBeLessThan(stack);
      expectNativeClipBox(clips[0], stack, stack, 1600, 900);
      expectNativeClipBox(clips[2], stack, stack, 1600, 900);
      expect(parseScale(images[0].style.transform)).toBeLessThan(1.03);
      expect(parseScale(clips[0].style.transform)).toBeGreaterThan(1);
      expect(parseScale(clips[2].style.transform)).toBeCloseTo(1, 5);
    } finally {
      restore();
    }
  });

  it('expands current/next clips after dwell while img cover-zoom stays on the image', { timeout: 20000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const posts = [imagePost('p0', landscape), imagePost('p1', landscape), imagePost('p2', landscape)];
    try {
      const { container } = render(
        <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
      );
      flushFrames(32);
      const clips = [...container.querySelectorAll('.community-depth-image-clip')] as HTMLElement[];
      const images = [...container.querySelectorAll('.community-depth-image')] as HTMLElement[];
      const pairClip = parseScale(clips[0].style.transform);
      const nextClip = parseScale(clips[1].style.transform);
      const otherClip = parseScale(clips[2].style.transform);
      const pairImg = parseScale(images[0].style.transform);
      expect(pairClip).toBeGreaterThan(1);
      expect(nextClip).toBeGreaterThan(1);
      expect(otherClip).toBeCloseTo(1, 5);
      expect(pairImg).toBeGreaterThan(0.99);
      expect(pairImg).toBeLessThan(1.03);
    } finally {
      restore();
    }
  });

  it('eases clip scale down with --idle as soon as scrolling starts', { timeout: 20000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const posts = [imagePost('p0', landscape), imagePost('p1', landscape)];
    try {
      const { container } = render(
        <CommunityDepthGallery sourcePosts={posts} startPostId="p0" onClose={() => {}} />,
      );
      const dialog = container.querySelector('.community-depth-gallery') as HTMLElement;
      flushFrames(32);
      const ornaments = [...container.querySelectorAll('.community-depth-ornaments')] as HTMLElement[];
      const idleBefore = Number(ornaments[0].style.getPropertyValue('--idle'));
      const clipBefore = parseScale(
        (container.querySelectorAll('.community-depth-image-clip')[0] as HTMLElement).style.transform,
      );
      expect(idleBefore).toBeGreaterThan(0.5);
      expect(clipBefore).toBeGreaterThan(1);

      fireEvent.keyDown(dialog, { key: 'ArrowDown' });
      flushFrames(8);
      const idleAfter = Number(ornaments[0].style.getPropertyValue('--idle'));
      const clipAfter = parseScale(
        (container.querySelectorAll('.community-depth-image-clip')[0] as HTMLElement).style.transform,
      );
      expect(idleAfter).toBeLessThan(idleBefore);
      expect(clipAfter).toBeLessThan(clipBefore);
    } finally {
      restore();
    }
  });

  it('keeps clip scale at 1 when reduced motion is on', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    const restore = mockGalleryBox(900, 600, 300);
    try {
      const { container } = render(
        <CommunityDepthGallery
          sourcePosts={[imagePost('p0', { attachmentWidth: '1600', attachmentHeight: '900' })]}
          startPostId="p0"
          onClose={() => {}}
        />,
      );
      flushFrames(8);
      const clip = container.querySelector('.community-depth-image-clip') as HTMLElement;
      expectNativeClipBox(clip, 300, 300, 1600, 900);
      expect(parsePx(clip.style.height)).toBeLessThan(300);
      expect(parseScale(clip.style.transform)).toBeCloseTo(1, 5);
    } finally {
      restore();
    }
  });

  it('keeps idle zoom at 0 when reduced motion is on', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    const restore = mockGalleryBox(900, 600, 300);
    try {
      const { container } = render(
        <CommunityDepthGallery
          sourcePosts={[imagePost('p0', { attachmentWidth: '1600', attachmentHeight: '900' })]}
          startPostId="p0"
          onClose={() => {}}
        />,
      );
      flushFrames(8);
      const img = container.querySelector('.community-depth-image') as HTMLElement;
      const ornaments = container.querySelector('.community-depth-ornaments') as HTMLElement;
      expect(parseScale(img.style.transform)).toBeCloseTo(1, 5);
      expect(Number(ornaments.style.getPropertyValue('--idle'))).toBe(0);
    } finally {
      restore();
    }
  });

  it('does not fire ripples during walk-in or early vanish', { timeout: 20000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const posts = [imagePost('p0', landscape), imagePost('p1', landscape)];
    const reactionsByPostId = new Map([['p0', [reaction('p0', { id: 'r1' })]]]);
    const commentsByPostId = new Map([['p0', [comment('p0', { id: 'c1', authorNameSnapshot: 'Minh' })]]]);
    try {
      const { container } = render(
        <CommunityDepthGallery
          sourcePosts={posts}
          startPostId="p0"
          onClose={() => {}}
          reactionsByPostId={reactionsByPostId}
          commentsByPostId={commentsByPostId}
        />,
      );
      flushFrames(32);
      const ornaments = [...container.querySelectorAll('.community-depth-ornaments')] as HTMLElement[];
      expect(Number(ornaments[0].style.getPropertyValue('--idle'))).toBeGreaterThan(0.5);
      expect(container.querySelector('.community-depth-ripple.is-firing')).toBeNull();

      flushFrames(668);
      expect(Number(ornaments[0].style.opacity)).toBeLessThan(0.15);
      expect(container.querySelector('.community-depth-ripple.is-firing')).toBeNull();
    } finally {
      restore();
    }
  });

  it('fires one ripple per inner slot after ornaments are gone and clears on scroll', { timeout: 30000 }, () => {
    const restore = mockGalleryBox(900, 600, 300);
    const landscape = { attachmentWidth: '1600', attachmentHeight: '900' };
    const post = imagePost('p0', landscape);
    const posts = [post, imagePost('p1', landscape)];
    const reactions = [reaction('p0', { id: 'r1' })];
    const comments = [comment('p0', { id: 'c1', authorNameSnapshot: 'Minh' })];
    const layout = buildGalleryOrnamentLayout({
      post,
      reactions,
      comments,
      reactorProfiles: new Map(),
    });
    try {
      const { container } = render(
        <CommunityDepthGallery
          sourcePosts={posts}
          startPostId="p0"
          onClose={() => {}}
          reactionsByPostId={new Map([['p0', reactions]])}
          commentsByPostId={new Map([['p0', comments]])}
        />,
      );
      const dialog = container.querySelector('.community-depth-gallery') as HTMLElement;
      const layers = [...container.querySelectorAll('.community-depth-layer')] as HTMLElement[];
      flushFrames(1400);

      const firing = [...layers[0].querySelectorAll('.community-depth-ripple.is-firing')] as HTMLElement[];
      expect(firing).toHaveLength(3);
      expect(firing.map((el) => el.getAttribute('data-ripple-key')).sort()).toEqual(
        [
          ornamentRippleAuthorKey('p0'),
          ornamentRippleCommentKey('p0', 'c1'),
          ornamentRippleReactionKey('p0', 'r1'),
        ].sort(),
      );
      firing.forEach((el) => {
        expect(el.querySelectorAll('.community-depth-ripple-ring')).toHaveLength(3);
      });

      const reactionRipple = layers[0].querySelector(
        `[data-ripple-key="${ornamentRippleReactionKey('p0', 'r1')}"]`,
      ) as HTMLElement;
      const commentRipple = layers[0].querySelector(
        `[data-ripple-key="${ornamentRippleCommentKey('p0', 'c1')}"]`,
      ) as HTMLElement;
      const authorRipple = layers[0].querySelector(
        `[data-ripple-key="${ornamentRippleAuthorKey('p0')}"]`,
      ) as HTMLElement;
      expect(reactionRipple.style.left).toBe(`${layout.reactions[0].innerLeftPct}%`);
      expect(reactionRipple.style.top).toBe(`${layout.reactions[0].innerTopPct}%`);
      expect(commentRipple.style.left).toBe(`${layout.comments[0].innerLeftPct}%`);
      expect(commentRipple.style.top).toBe(`${layout.comments[0].innerTopPct}%`);
      expect(authorRipple.style.left).toBe('50%');
      expect(authorRipple.style.top).toBe(`${AUTHOR_IDLE_TOP_PCT}%`);
      expect(layers[1].querySelector('.community-depth-ripple.is-firing')).toBeNull();

      flushFrames(20);
      expect(layers[0].querySelectorAll('.community-depth-ripple.is-firing')).toHaveLength(3);

      fireEvent.keyDown(dialog, { key: 'ArrowDown' });
      flushFrames(3);
      expect(container.querySelector('.community-depth-ripple.is-firing')).toBeNull();
    } finally {
      restore();
    }
  });

  it('never fires ripples when reduced motion is on', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    const restore = mockGalleryBox(900, 600, 300);
    try {
      const { container } = render(
        <CommunityDepthGallery
          sourcePosts={[imagePost('p0', { attachmentWidth: '1600', attachmentHeight: '900' })]}
          startPostId="p0"
          onClose={() => {}}
          reactionsByPostId={new Map([['p0', [reaction('p0', { id: 'r1' })]]])}
          commentsByPostId={new Map([['p0', [comment('p0', { id: 'c1' })]]])}
        />,
      );
      flushFrames(40);
      expect(container.querySelector('.community-depth-ripple.is-firing')).toBeNull();
      expect(
        Number((container.querySelector('.community-depth-ornaments') as HTMLElement).style.getPropertyValue('--idle')),
      ).toBe(0);
    } finally {
      restore();
    }
  });
});
