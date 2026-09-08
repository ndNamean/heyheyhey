// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityPost } from '../../../types';
import CommunityDepthGallery from './CommunityDepthGallery';

vi.mock('../../profileAvatar/ProfileAvatar', () => ({
  default: ({ profile }: { profile: { displayName?: string } }) => (
    <div className="avatar-circle">{profile.displayName || 'avatar'}</div>
  ),
}));

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
      expect(layer.querySelector('.community-depth-image')).toBeTruthy();
      expect(layer.querySelector(':scope > .community-depth-ornaments')).toBeTruthy();
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

  it('clears leftover ornaments after a fast jump to the last plane and still settles the last image', () => {
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
    expect(Number(ornaments[2].style.opacity)).toBeGreaterThan(0.6);
    expect(Number(images[2].style.opacity)).toBeGreaterThan(0.6);
    expect(Number(images[0].style.opacity)).toBeLessThan(0.2);
  });
});
