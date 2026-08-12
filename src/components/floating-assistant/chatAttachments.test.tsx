// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ChatDropOverlay } from './ChatDropOverlay';
import { ChatAttachmentPreview } from './ChatAttachmentPreview';
import {
  ComposerAttachMenu,
  buildQuickMessageLabels,
} from './ComposerAttachMenu';
import {
  useChatAttachmentStaging,
  type StagedChatAttachment,
} from './useChatAttachmentStaging';
import { createRef } from 'react';

afterEach(() => cleanup());

beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => 'blob:mock-url',
    });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
});

const quickLabels = {
  onMyWay: 'On my way',
  gotIt: 'Got it',
  willCheck: 'Will check',
  needHelp: 'Need help',
  almostDone: 'Almost done',
  thanks: 'Thanks!',
};

const menuLabels = {
  attach: 'Attach',
  attachMenuTitle: 'Attach',
  camera: 'Camera',
  photos: 'Photos',
  file: 'File',
  quickMessage: 'Quick Message',
  closeMenu: 'Close attach menu',
  cameraDenied: 'Camera permission denied',
  chooseFromPhotos: 'Choose from Photos',
  cancel: 'Cancel',
  quickMessages: quickLabels,
};

describe('ChatDropOverlay', () => {
  it('shows overlay on file drag and forwards drop', () => {
    const onFiles = vi.fn();
    render(
      <ChatDropOverlay enabled label="Drop files to send" onFiles={onFiles}>
        <div>messages</div>
      </ChatDropOverlay>,
    );

    const target = document.querySelector('.chat-drop-target') as HTMLElement;
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
    fireEvent.dragEnter(target, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(document.querySelector('.chat-drop-overlay')).toBeTruthy();
    fireEvent.drop(target, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(document.querySelector('.chat-drop-overlay')).toBeNull();
  });

  it('ignores drags when disabled', () => {
    const onFiles = vi.fn();
    render(
      <ChatDropOverlay enabled={false} label="Drop" onFiles={onFiles}>
        <div>messages</div>
      </ChatDropOverlay>,
    );
    const target = document.querySelector('.chat-drop-target') as HTMLElement;
    fireEvent.dragEnter(target, {
      dataTransfer: { types: ['Files'], files: [] },
    });
    expect(document.querySelector('.chat-drop-overlay')).toBeNull();
  });
});

describe('ChatAttachmentPreview', () => {
  const baseItem: StagedChatAttachment = {
    localId: 'local-1',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    objectUrl: 'blob:preview',
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    bytes: 1200,
    kind: 'image',
    width: 100,
    height: 80,
  };

  it('renders image preview and clear action', () => {
    const onClear = vi.fn();
    render(
      <ChatAttachmentPreview item={baseItem} onClear={onClear} removeLabel="Remove attachment" />,
    );
    expect(screen.getByRole('group', { name: /photo\.jpg/i })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Remove attachment'));
    expect(onClear).toHaveBeenCalled();
  });

  it('shows retry when failed and announces status', () => {
    const onRetry = vi.fn();
    render(
      <ChatAttachmentPreview
        item={{ ...baseItem, kind: 'file', fileName: 'doc.pdf', mimeType: 'application/pdf' }}
        phase="failed"
        onRetry={onRetry}
        retryLabel="Retry"
        statusLabel="Upload failed"
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/upload failed/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('ComposerAttachMenu', () => {
  it('maps i18n keys via buildQuickMessageLabels', () => {
    const labels = buildQuickMessageLabels({
      quickMsgOnMyWay: 'On my way',
      quickMsgGotIt: 'Got it',
      quickMsgWillCheck: 'Will check',
      quickMsgNeedHelp: 'Need help',
      quickMsgAlmostDone: 'Almost done',
      quickMsgThanks: 'Thanks!',
    });
    expect(labels.onMyWay).toBe('On my way');
    expect(labels.thanks).toBe('Thanks!');
  });

  it('closes on Escape and restores focus to the attach button', async () => {
    const onOpenChange = vi.fn();
    const anchorRef = createRef<HTMLButtonElement>();
    render(
      <div>
        <button type="button" ref={anchorRef}>
          +
        </button>
        <ComposerAttachMenu
          open
          onOpenChange={onOpenChange}
          anchorRef={anchorRef}
          labels={menuLabels}
          onFileChosen={vi.fn()}
          onQuickMessage={vi.fn()}
        />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Attach' })).toBeTruthy();
    });
    expect(screen.getByRole('menuitem', { name: 'Camera' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('announces camera denied with Photos fallback', () => {
    const onOpenChange = vi.fn();
    const anchorRef = createRef<HTMLButtonElement>();
    render(
      <ComposerAttachMenu
        open
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        labels={menuLabels}
        cameraDenied
        onFileChosen={vi.fn()}
        onQuickMessage={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/camera permission denied/i);
    expect(screen.getByRole('button', { name: 'Choose from Photos' })).toBeTruthy();
  });
});

describe('useChatAttachmentStaging', () => {
  it('rejects blocked policy and keeps idle when invalid', async () => {
    const { result } = renderHook(() => useChatAttachmentStaging());
    let outcome: Awaited<ReturnType<typeof result.current.stageFile>> | undefined;
    await act(async () => {
      outcome = await result.current.stageFile(
        new File(['x'], 'evil.exe', { type: 'application/pdf' }),
      );
    });
    expect(outcome?.ok).toBe(false);
    expect(result.current.staged).toBeNull();
    expect(result.current.error?.code).toBe('blocked_extension');
  });

  it('keeps stable send ids and cached upload across retry', async () => {
    const { result } = renderHook(() => useChatAttachmentStaging());
    await act(async () => {
      await result.current.stageFile(
        new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' }),
      );
    });
    expect(result.current.phase).toBe('selected');

    let n = 0;
    const createId = () => `id-${++n}`;
    const first = result.current.ensureSendIds(createId);
    const second = result.current.ensureSendIds(createId);
    expect(second).toEqual(first);
    expect(n).toBe(2);

    result.current.cacheUpload({
      fileId: 'f1',
      url: 'https://example.com/f1',
      path: 'stores/group-chat/r1/id-1/note.txt',
      mimeType: 'text/plain',
      bytes: 3,
      fileName: 'note.txt',
      kind: 'file',
    });
    expect(result.current.getCachedUpload()?.fileId).toBe('f1');

    act(() => {
      result.current.markFailed('Instant write failed');
    });
    expect(result.current.phase).toBe('failed');
    expect(result.current.getCachedUpload()?.path).toContain('group-chat');
    expect(result.current.ensureSendIds(createId)).toEqual(first);

    act(() => {
      result.current.clear();
    });
    expect(result.current.getCachedUpload()).toBeNull();
    expect(result.current.ensureSendIds(createId)).not.toEqual(first);
  });

  it('calls onStageAttachment so parent can clear GIPHY (XOR)', async () => {
    const onStageAttachment = vi.fn();
    const { result } = renderHook(() =>
      useChatAttachmentStaging({ onStageAttachment }),
    );
    await act(async () => {
      await result.current.stageFile(
        new File([new Uint8Array([1, 2, 3, 4])], 'a.txt', {
          type: 'text/plain',
        }),
      );
    });
    expect(onStageAttachment).toHaveBeenCalled();
    expect(result.current.hasStaged).toBe(true);
    expect(result.current.staged?.kind).toBe('file');
  });
});
