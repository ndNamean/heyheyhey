// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelLayoutProps } from './FloatingAssistantPanel';
import FloatingAssistantPanel from './FloatingAssistantPanel';

vi.mock('../../i18n', async () => {
  const { mockUseLang } = await import('./storeChatTestI18n');
  return { useLang: () => mockUseLang() };
});

vi.mock('./KnowledgeAssistantPanel', () => ({
  default: ({ hidden }: { hidden: boolean }) => (
    <div data-testid="knowledge-panel" hidden={hidden}>
      Knowledge
    </div>
  ),
}));

vi.mock('./StoreChatPanel', () => ({
  default: ({ hidden }: { hidden: boolean }) => (
    <div data-testid="store-chat-panel" hidden={hidden}>
      StoreChat
    </div>
  ),
}));

vi.mock('./ChatsTabBody', () => ({
  default: ({ hidden }: { hidden: boolean }) => (
    <div data-testid="chats-tab-body" hidden={hidden}>
      Chats
    </div>
  ),
}));

vi.mock('./AuthorizedStoreSelector', () => ({
  default: () => <div data-testid="store-selector">Store</div>,
}));

vi.mock('./useFocusModeA11y', () => ({
  useFocusModeA11y: vi.fn(),
}));

vi.mock('./usePanelResize', () => ({
  usePanelResize: () => ({ onPointerDown: vi.fn() }),
}));

vi.mock('./useMobileSheetSnap', () => ({
  useMobileSheetSnap: () => ({ onHandlePointerDown: vi.fn(), compactH: 520, expandedH: 784 }),
}));

const profile = {
  id: 'p1',
  userId: 'u1',
  email: 'a@b.co',
  displayName: 'Ada',
  role: 'manager' as const,
  approvalStatus: 'approved' as const,
  approvedAt: '',
  approvedByEmail: '',
  createdAt: '',
  updatedAt: '',
};

function baseLayout(overrides: Partial<PanelLayoutProps> = {}): PanelLayoutProps {
  return {
    mode: 'compact',
    formFactor: 'desktop',
    width: 400,
    height: 640,
    keyboardInset: 0,
    finePointer: true,
    resizing: false,
    sheetDragging: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    onEnterFocus: vi.fn(),
    onExitFocus: vi.fn(),
    onResetSize: vi.fn(),
    onDesktopSize: vi.fn(),
    onResizeStart: vi.fn(),
    onResizeEnd: vi.fn(),
    onSheetHeight: vi.fn(),
    onSheetSnap: vi.fn(),
    onSheetDragStart: vi.fn(),
    onSheetDragEnd: vi.fn(),
    onSheetCloseRequest: vi.fn(),
    ...overrides,
  };
}

function renderPanel(layout: PanelLayoutProps) {
  return render(
    <FloatingAssistantPanel
      open
      side="right"
      activeTab="knowledge"
      onTabChange={vi.fn()}
      onClose={vi.fn()}
      profile={profile as any}
      stores={[]}
      selectedStoreId=""
      selectedStore={null}
      onStoreChange={vi.fn()}
      storesLoading={false}
      canSend
      composerState="idle"
      keyFlash={false}
      composerVisual={
        {
          onFocus: vi.fn(),
          onBlur: vi.fn(),
          onInput: vi.fn(),
          setSending: vi.fn(),
          setSuccess: vi.fn(),
          setFailure: vi.fn(),
          resetFlash: vi.fn(),
        } as any
      }
      storeChatUnread={0}
      unreadByStore={{}}
      unreadSendersByStore={{}}
      initialStoreChatMessageId=""
      onInitialStoreChatMessageHandled={vi.fn()}
      layout={layout}
    />,
  );
}

describe('FloatingAssistantPanel layout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps Knowledge and StoreChat mounted across mode changes', () => {
    const layout = baseLayout({ mode: 'compact' });
    const { rerender } = renderPanel(layout);

    const knowledge = screen.getByTestId('knowledge-panel');
    const storeChat = screen.getByTestId('store-chat-panel');

    rerender(
      <FloatingAssistantPanel
        open
        side="right"
        activeTab="knowledge"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        profile={profile as any}
        stores={[]}
        selectedStoreId=""
        selectedStore={null}
        onStoreChange={vi.fn()}
        storesLoading={false}
        canSend
        composerState="idle"
        keyFlash={false}
        composerVisual={
          {
            onFocus: vi.fn(),
            onBlur: vi.fn(),
            onInput: vi.fn(),
            setSending: vi.fn(),
            setSuccess: vi.fn(),
            setFailure: vi.fn(),
            resetFlash: vi.fn(),
          } as any
        }
        storeChatUnread={0}
        unreadByStore={{}}
        unreadSendersByStore={{}}
        initialStoreChatMessageId=""
        onInitialStoreChatMessageHandled={vi.fn()}
        layout={baseLayout({ mode: 'focus' })}
      />,
    );

    expect(screen.getByTestId('knowledge-panel')).toBe(knowledge);
    expect(screen.getByTestId('store-chat-panel')).toBe(storeChat);
  });

  it('exposes Expand in compact and Focus only in expanded; sets aria-modal in focus', () => {
    const onExpand = vi.fn();
    const { rerender } = renderPanel(baseLayout({ mode: 'compact', onExpand }));

    fireEvent.click(screen.getByLabelText('Expand panel'));
    expect(onExpand).toHaveBeenCalled();
    expect(screen.queryByLabelText('Enter focus mode')).toBeNull();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(dialog.getAttribute('data-mode')).toBe('compact');

    rerender(
      <FloatingAssistantPanel
        open
        side="right"
        activeTab="knowledge"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        profile={profile as any}
        stores={[]}
        selectedStoreId=""
        selectedStore={null}
        onStoreChange={vi.fn()}
        storesLoading={false}
        canSend
        composerState="idle"
        keyFlash={false}
        composerVisual={
          {
            onFocus: vi.fn(),
            onBlur: vi.fn(),
            onInput: vi.fn(),
            setSending: vi.fn(),
            setSuccess: vi.fn(),
            setFailure: vi.fn(),
            resetFlash: vi.fn(),
          } as any
        }
        storeChatUnread={0}
        unreadByStore={{}}
        unreadSendersByStore={{}}
        initialStoreChatMessageId=""
        onInitialStoreChatMessageHandled={vi.fn()}
        layout={baseLayout({ mode: 'expanded' })}
      />,
    );

    expect(screen.getByLabelText('Collapse panel')).toBeTruthy();
    expect(screen.getByLabelText('Enter focus mode')).toBeTruthy();

    rerender(
      <FloatingAssistantPanel
        open
        side="right"
        activeTab="knowledge"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        profile={profile as any}
        stores={[]}
        selectedStoreId=""
        selectedStore={null}
        onStoreChange={vi.fn()}
        storesLoading={false}
        canSend
        composerState="idle"
        keyFlash={false}
        composerVisual={
          {
            onFocus: vi.fn(),
            onBlur: vi.fn(),
            onInput: vi.fn(),
            setSending: vi.fn(),
            setSuccess: vi.fn(),
            setFailure: vi.fn(),
            resetFlash: vi.fn(),
          } as any
        }
        storeChatUnread={0}
        unreadByStore={{}}
        unreadSendersByStore={{}}
        initialStoreChatMessageId=""
        onInitialStoreChatMessageHandled={vi.fn()}
        layout={baseLayout({ mode: 'focus' })}
      />,
    );

    const focusDialog = screen.getByRole('dialog');
    expect(focusDialog.getAttribute('aria-modal')).toBe('true');
    expect(focusDialog.getAttribute('aria-label')).toBe('Assistant, focus mode');
    expect(screen.getByLabelText('Exit focus mode')).toBeTruthy();
  });

  it('shows resize grip on desktop fine pointer and Reset size in More', () => {
    const onResetSize = vi.fn();
    renderPanel(baseLayout({ finePointer: true, formFactor: 'desktop', onResetSize }));

    expect(document.querySelector('.fa-panel-resize-grip')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('More panel actions'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset panel size' }));
    expect(onResetSize).toHaveBeenCalled();
  });

  it('hides resize grip on mobile and shows sheet handle', () => {
    renderPanel(baseLayout({ formFactor: 'mobile', finePointer: false, mode: 'compact' }));
    expect(document.querySelector('.fa-panel-resize-grip')).toBeNull();
    expect(document.querySelector('.fa-panel-sheet-handle')).toBeTruthy();
  });
});
