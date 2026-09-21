// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunityDepthAmbient from './CommunityDepthAmbient';
import { disposeAllAmbientSamplers } from './ambientSampler';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

type Ctx = {
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
};

let ctx: Ctx;

function installCanvasMock(overrides?: Partial<Ctx>) {
  ctx = {
    drawImage: overrides?.drawImage ?? vi.fn(),
    getImageData: overrides?.getImageData ?? vi.fn(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    }),
    clearRect: overrides?.clearRect ?? vi.fn(),
  };
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
}

function ImageHarness({
  active = true,
  reducedMotion = false,
}: {
  active?: boolean;
  reducedMotion?: boolean;
}) {
  return (
    <div className="community-depth-layer">
      <CommunityDepthAmbient active={active} kind="image" reducedMotion={reducedMotion} />
      <div className="community-depth-image-clip">
        <img className="community-depth-image" src={PIXEL} alt="" />
      </div>
    </div>
  );
}

function VideoHarness({ active = true }: { active?: boolean }) {
  return (
    <div className="community-depth-layer">
      <CommunityDepthAmbient active={active} kind="video" reducedMotion={false} />
      <div className="community-depth-image-clip">
        <div className="community-depth-video-slot">
          <video className="community-depth-video" />
        </div>
      </div>
    </div>
  );
}

async function microtasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function prepareImage(container: HTMLElement) {
  const img = container.querySelector('img') as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 800 });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 600 });
  Object.defineProperty(img, 'complete', { configurable: true, value: true });
  img.decode = () => Promise.resolve();
  fireEvent.load(img);
  return img;
}

describe('CommunityDepthAmbient', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getContextSpy = installCanvasMock();
  });

  afterEach(() => {
    cleanup();
    disposeAllAmbientSamplers();
    getContextSpy.mockRestore();
  });

  it('renders an inert sibling with pointer-events none and no canvas when inactive', () => {
    const { container } = render(<ImageHarness active={false} />);
    const ambient = container.querySelector('.community-depth-ambient') as HTMLElement;
    const clip = container.querySelector('.community-depth-image-clip');
    expect(ambient).toBeTruthy();
    expect(ambient.getAttribute('aria-hidden')).toBe('true');
    expect(ambient.style.pointerEvents).toBe('none');
    expect(ambient.querySelector('canvas')).toBeNull();
    expect(ambient.nextElementSibling).toBe(clip);
  });

  it('creates a live canvas only while active and reveals after a successful sample', async () => {
    const { container, rerender } = render(<ImageHarness active />);
    expect(container.querySelector('.community-depth-ambient canvas')).toBeTruthy();
    prepareImage(container);
    await microtasks();
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(container.querySelector('.community-depth-ambient')?.getAttribute('data-ready')).toBe('');
    const canvas = container.querySelector('.community-depth-ambient canvas') as HTMLCanvasElement;
    expect(canvas.style.opacity).toBe('');
    rerender(<ImageHarness active={false} />);
    expect(container.querySelector('.community-depth-ambient canvas')).toBeNull();
    expect(container.querySelector('.community-depth-ambient')?.getAttribute('data-ready')).toBeNull();
  });

  it('samples a pair video via querySelector without a mediaRef', () => {
    const { container } = render(<VideoHarness />);
    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    fireEvent.loadedData(video);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.community-depth-ambient')?.getAttribute('data-ready')).toBe('');
  });

  it('fails open when drawImage throws and does not add status text', async () => {
    ctx.drawImage.mockImplementation(() => {
      throw new Error('canvas');
    });
    const { container } = render(<ImageHarness active />);
    prepareImage(container);
    await microtasks();
    expect(container.querySelector('.community-depth-ambient')?.getAttribute('data-ready')).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('img.community-depth-image')).toBeTruthy();
  });

  it('reveals ambient when drawImage paints even if getImageData would throw', async () => {
    ctx.getImageData.mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    const { container } = render(<ImageHarness active />);
    prepareImage(container);
    await microtasks();
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.getImageData).not.toHaveBeenCalled();
    expect(container.querySelector('.community-depth-ambient')?.getAttribute('data-ready')).toBe('');
    expect(container.querySelector('.community-depth-ambient canvas')).toBeTruthy();
  });
});
