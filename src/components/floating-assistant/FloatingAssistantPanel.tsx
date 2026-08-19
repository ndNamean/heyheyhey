import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLang } from '../../i18n';
import { isChatsSurfaceEnabled } from '../../lib/storeOpsLeadershipFlag';
import type { Profile, Store } from '../../types';
import type { AssistantPanelMode, FormFactor } from './assistantPanelLayout';
import AssistantTabs, { type AssistantTabId } from './AssistantTabs';
import AuthorizedStoreSelector from './AuthorizedStoreSelector';
import ChatsTabBody from './ChatsTabBody';
import KnowledgeAssistantPanel from './KnowledgeAssistantPanel';
import StoreChatPanel from './StoreChatPanel';
import FloatingAssistantLoader from './FloatingAssistantLoader';
import { FLOATING_ASSISTANT_PANEL_ID } from './FloatingAssistantLauncher';
import type {
  ComposerVisualHandlers,
  ComposerVisualState,
} from './useComposerVisualState';
import type { LauncherSide } from './useFloatingLauncherPosition';
import { useFocusModeA11y } from './useFocusModeA11y';
import { useMobileSheetSnap } from './useMobileSheetSnap';
import { usePanelResize } from './usePanelResize';
import type { UnreadSenderSummary } from './useUnreadStoreChat';

const KNOWLEDGE_PANEL_ID = 'fa-panel-knowledge';
const STORE_CHAT_PANEL_ID = 'fa-panel-store-chat';

export type PanelLayoutProps = {
  mode: AssistantPanelMode;
  formFactor: FormFactor;
  width: number;
  height: number;
  keyboardInset: number;
  finePointer: boolean;
  resizing: boolean;
  sheetDragging: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onEnterFocus: () => void;
  onExitFocus: () => void;
  onResetSize: () => void;
  onDesktopSize: (width: number, height: number, opts?: { persist?: boolean }) => void;
  onResizeStart: () => void;
  onResizeEnd: (width: number, height: number) => void;
  onSheetHeight: (height: number) => void;
  onSheetSnap: (mode: 'compact' | 'expanded') => void;
  onSheetDragStart: () => void;
  onSheetDragEnd: () => void;
  onSheetCloseRequest: () => void;
};

interface Props {
  open: boolean;
  side: LauncherSide;
  activeTab: AssistantTabId;
  onTabChange: (tab: AssistantTabId) => void;
  onClose: () => void;
  profile: Profile;
  stores: Store[];
  selectedStoreId: string;
  selectedStore: Store | null;
  onStoreChange: (storeId: string) => void;
  storesLoading: boolean;
  canSend: boolean;
  composerState: ComposerVisualState;
  keyFlash: boolean;
  composerVisual: ComposerVisualHandlers;
  storeChatUnread: number;
  unreadByStore: Record<string, number>;
  unreadSendersByStore: Record<string, UnreadSenderSummary[]>;
  initialStoreChatMessageId: string;
  initialStoreChatStartReply?: boolean;
  onInitialStoreChatMessageHandled: () => void;
  pendingGroupChatRoomId?: string;
  onPendingGroupChatRoomHandled?: () => void;
  initialGroupChatMessageId?: string;
  onInitialGroupChatMessageHandled?: () => void;
  conversationUnread?: number;
  onConversationUnreadChange?: (n: number) => void;
  layout: PanelLayoutProps;
}

function ariaForMode(
  mode: AssistantPanelMode,
  labels: { ariaCompact: string; ariaExpanded: string; ariaFocus: string },
): string {
  if (mode === 'focus') return labels.ariaFocus;
  if (mode === 'expanded') return labels.ariaExpanded;
  return labels.ariaCompact;
}

export default function FloatingAssistantPanel({
  open,
  side,
  activeTab,
  onTabChange,
  onClose,
  profile,
  stores,
  selectedStoreId,
  selectedStore,
  onStoreChange,
  storesLoading,
  canSend,
  composerState,
  keyFlash,
  composerVisual,
  storeChatUnread,
  unreadByStore,
  unreadSendersByStore,
  initialStoreChatMessageId,
  initialStoreChatStartReply = false,
  onInitialStoreChatMessageHandled,
  pendingGroupChatRoomId = '',
  onPendingGroupChatRoomHandled,
  initialGroupChatMessageId = '',
  onInitialGroupChatMessageHandled,
  conversationUnread,
  onConversationUnreadChange,
  layout,
}: Props) {
  const { t } = useLang();
  const fa = t.floatingAssistant;
  const chatsSurfaceOn = isChatsSurfaceEnabled();
  const panelRef = useRef<HTMLDivElement>(null);
  const exitFocusRef = useRef<HTMLButtonElement>(null);
  const moreWrapRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const wasOpenRef = useRef(false);

  const {
    mode,
    formFactor,
    width,
    height,
    keyboardInset,
    finePointer,
    resizing,
    sheetDragging,
    onExpand,
    onCollapse,
    onEnterFocus,
    onExitFocus,
    onResetSize,
    onDesktopSize,
    onResizeStart,
    onResizeEnd,
    onSheetHeight,
    onSheetSnap,
    onSheetDragStart,
    onSheetDragEnd,
    onSheetCloseRequest,
  } = layout;

  const isMobile = formFactor === 'mobile';
  const showResizeGrip = !isMobile && finePointer && mode !== 'focus';
  const persistableMode = mode === 'focus' ? 'expanded' : mode;

  useFocusModeA11y({
    enabled: open && mode === 'focus',
    panelRef,
    initialFocusRef: exitFocusRef,
  });

  const { onPointerDown: onResizePointerDown } = usePanelResize({
    enabled: open && showResizeGrip,
    dock: side,
    width,
    height,
    onResize: (w, h) => onDesktopSize(w, h, { persist: false }),
    onResizeStart,
    onResizeEnd: (w, h) => {
      onDesktopSize(w, h, { persist: true });
      onResizeEnd(w, h);
    },
  });

  const { onHandlePointerDown } = useMobileSheetSnap({
    enabled: open && isMobile,
    mode: persistableMode,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 800,
    onHeightChange: onSheetHeight,
    onSnap: onSheetSnap,
    onCloseRequest: onSheetCloseRequest,
    onDragStart: onSheetDragStart,
    onDragEnd: onSheetDragEnd,
  });

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setMoreOpen(false);
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const el = panelRef.current;
    if (!el) return;
    const closeBtn = el.querySelector<HTMLElement>('.fa-panel-close');
    (closeBtn ?? el).focus();
  }, [open]);

  useEffect(() => {
    if (!moreOpen) return;
    function onDocPointer(event: MouseEvent) {
      const wrap = moreWrapRef.current;
      if (!wrap) return;
      if (event.target instanceof Node && wrap.contains(event.target)) return;
      setMoreOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  if (!open) return null;

  const style: CSSProperties = {
    ['--fa-panel-width' as string]: `${width}px`,
    ['--fa-panel-height' as string]: `${height}px`,
    ['--fa-keyboard-inset' as string]: `${keyboardInset}px`,
  };

  const className = [
    'fa-panel',
    `fa-panel--${side}`,
    resizing ? 'is-resizing' : '',
    sheetDragging ? 'is-sheet-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={panelRef}
      id={FLOATING_ASSISTANT_PANEL_ID}
      className={className}
      style={style}
      role="dialog"
      aria-modal={mode === 'focus' ? 'true' : 'false'}
      aria-label={ariaForMode(mode, fa)}
      tabIndex={-1}
      data-panel-state="open"
      data-mode={mode}
      data-form-factor={formFactor}
      data-composer-state={composerState}
      data-key-flash={keyFlash ? 'true' : undefined}
    >
      {isMobile && mode !== 'focus' ? (
        <div
          className="fa-panel-sheet-handle"
          role="separator"
          aria-label={fa.sheetHandle}
          onPointerDown={onHandlePointerDown}
        >
          <span className="fa-panel-sheet-handle-bar" aria-hidden="true" />
        </div>
      ) : null}

      {showResizeGrip ? (
        <div
          className={`fa-panel-resize-grip fa-panel-resize-grip--${side === 'right' ? 'tl' : 'tr'}`}
          aria-hidden="true"
          onPointerDown={onResizePointerDown}
        >
          <span className="fa-panel-resize-grip-glyph" />
        </div>
      ) : null}

      <header className="fa-panel-header">
        <div className="fa-panel-header-text">
          <h2 className="fa-panel-title">Assistant</h2>
          <p className="fa-panel-subtitle small">
            {chatsSurfaceOn ? 'Knowledge & chats' : 'Knowledge & store chat'}
          </p>
        </div>
        <div className="fa-panel-header-actions">
          {mode === 'compact' ? (
            <button
              type="button"
              className="fa-panel-action"
              aria-label={fa.expandPanel}
              title={fa.expand}
              onClick={onExpand}
            >
              ⤢
            </button>
          ) : null}
          {mode === 'expanded' ? (
            <>
              <button
                type="button"
                className="fa-panel-action"
                aria-label={fa.collapsePanel}
                title={fa.collapse}
                onClick={onCollapse}
              >
                ⤡
              </button>
              <button
                type="button"
                className="fa-panel-action"
                aria-label={fa.enterFocusMode}
                title={fa.focus}
                onClick={onEnterFocus}
              >
                ⛶
              </button>
            </>
          ) : null}
          {mode === 'focus' ? (
            <button
              ref={exitFocusRef}
              type="button"
              className="fa-panel-action"
              aria-label={fa.exitFocusMode}
              title={fa.exitFocus}
              onClick={onExitFocus}
            >
              ⛶
            </button>
          ) : null}

          <div className="fa-panel-more-wrap" ref={moreWrapRef}>
            <button
              type="button"
              className="fa-panel-action"
              aria-label={fa.morePanelActions}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              title={fa.morePanelActions}
              onClick={() => setMoreOpen((v) => !v)}
            >
              ⋯
            </button>
            {moreOpen ? (
              <div className="fa-panel-more-menu" role="menu">
                {!isMobile ? (
                  <button
                    type="button"
                    className="fa-panel-more-item"
                    role="menuitem"
                    onClick={() => {
                      onResetSize();
                      setMoreOpen(false);
                    }}
                  >
                    {fa.resetPanelSize}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="fa-panel-more-item"
                    role="menuitem"
                    onClick={() => {
                      if (mode === 'expanded') onCollapse();
                      else onExpand();
                      setMoreOpen(false);
                    }}
                  >
                    {mode === 'expanded' ? fa.collapsePanel : fa.expandPanel}
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="fa-panel-close"
            aria-label="Close assistant"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>

      {!chatsSurfaceOn || activeTab === 'knowledge' ? (
        <div className="fa-panel-store">
          {storesLoading ? (
            <FloatingAssistantLoader label="Loading stores…" />
          ) : (
            <AuthorizedStoreSelector
              stores={stores}
              selectedStoreId={selectedStoreId}
              onChange={onStoreChange}
              unreadByStore={unreadByStore}
              unreadSendersByStore={unreadSendersByStore}
            />
          )}
        </div>
      ) : null}

      <AssistantTabs
        activeTab={activeTab}
        onChange={onTabChange}
        knowledgePanelId={KNOWLEDGE_PANEL_ID}
        storeChatPanelId={STORE_CHAT_PANEL_ID}
        storeChatUnread={storeChatUnread}
        conversationUnread={conversationUnread}
      />

      <div className="fa-panel-body">
        <KnowledgeAssistantPanel
          store={selectedStore}
          panelId={KNOWLEDGE_PANEL_ID}
          labelledBy="fa-tab-knowledge"
          hidden={activeTab !== 'knowledge'}
        />
        {chatsSurfaceOn ? (
          <ChatsTabBody
            profile={profile}
            stores={stores}
            selectedStoreId={selectedStoreId}
            onStoreChange={onStoreChange}
            selectedStore={selectedStore}
            storesLoading={storesLoading}
            canSendStore={canSend}
            composerVisual={composerVisual}
            panelId={STORE_CHAT_PANEL_ID}
            labelledBy="fa-tab-store-chat"
            hidden={activeTab !== 'store-chat'}
            mode={mode}
            unreadByStore={unreadByStore}
            unreadSendersByStore={unreadSendersByStore}
            initialStoreChatMessageId={initialStoreChatMessageId}
            initialStoreChatStartReply={initialStoreChatStartReply}
            onInitialStoreChatMessageHandled={onInitialStoreChatMessageHandled}
            pendingGroupChatRoomId={pendingGroupChatRoomId}
            onPendingGroupChatRoomHandled={onPendingGroupChatRoomHandled}
            initialGroupChatMessageId={initialGroupChatMessageId}
            onInitialGroupChatMessageHandled={onInitialGroupChatMessageHandled}
            onConversationUnreadChange={onConversationUnreadChange}
          />
        ) : (
          <StoreChatPanel
            store={selectedStore}
            profile={profile}
            panelId={STORE_CHAT_PANEL_ID}
            labelledBy="fa-tab-store-chat"
            hidden={activeTab !== 'store-chat'}
            canSend={canSend}
            authorizedStores={stores}
            composerVisual={composerVisual}
            initialTargetMessageId={initialStoreChatMessageId}
            initialStartReply={initialStoreChatStartReply}
            onInitialTargetHandled={onInitialStoreChatMessageHandled}
          />
        )}
      </div>
    </div>
  );
}
