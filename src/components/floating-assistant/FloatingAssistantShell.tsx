import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BACK_PRIORITY, useNativeBack } from '../../lib/nativeBack';
import { isGroupChatEnabled } from '../../lib/groupChatFlag';
import type { Profile } from '../../types';
import {
  OPEN_STORE_CHAT_EVENT,
  type OpenStoreChatDetail,
} from '../FeedbackInbox';
import { OPEN_LOGBOOK_EVENT } from '../../lib/logbookDeepLink';
import FloatingAssistantLauncher from './FloatingAssistantLauncher';
import FloatingAssistantPanel from './FloatingAssistantPanel';
import { type AssistantTabId } from './AssistantTabs';
import { useAssistantPanelLayout } from './useAssistantPanelLayout';
import { useAuthorizedChatStores } from './useAuthorizedChatStores';
import { useComposerVisualState } from './useComposerVisualState';
import { useFloatingLauncherPosition } from './useFloatingLauncherPosition';
import { useUnreadStoreChat } from './useUnreadStoreChat';
import './floatingAssistant.css';

interface Props {
  profile: Profile;
}

function useOfflineFlag() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine,
  );

  useEffect(() => {
    function onOnline() {
      setOffline(false);
    }
    function onOffline() {
      setOffline(true);
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return offline;
}

export default function FloatingAssistantShell({ profile }: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AssistantTabId>('knowledge');
  const [initialStoreChatMessageId, setInitialStoreChatMessageId] = useState('');
  const [conversationUnread, setConversationUnread] = useState(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const offline = useOfflineFlag();
  const groupChatOn = isGroupChatEnabled();

  const {
    authorizedStores,
    selectedStoreId,
    selectedStore,
    setSelectedStoreId,
    isLoading: storesLoading,
  } = useAuthorizedChatStores(profile);

  const {
    side,
    dragging,
    dragX,
    dragEnabled,
    dockLeft,
    dockRight,
    resetPosition,
    beginPointerDrag,
  } = useFloatingLauncherPosition();

  const layout = useAssistantPanelLayout(open);

  const isViewer = profile.role === 'viewer';
  const canSend = !isViewer;
  const storeChatComposerEnabled = open && activeTab === 'store-chat' && canSend;

  const {
    state: composerState,
    keyFlash,
    onFocus,
    onBlur,
    onInput,
    setSending,
    setSuccess,
    setFailure,
    resetFlash,
  } = useComposerVisualState({
    enabled: storeChatComposerEnabled,
    offline,
  });

  const composerVisual = {
    onFocus,
    onBlur,
    onInput,
    setSending,
    setSuccess,
    setFailure,
    resetFlash,
  };

  const authorizedStoreIds = useMemo(
    () => authorizedStores.map((s) => s.id),
    [authorizedStores],
  );

  const viewingStoreId =
    open && activeTab === 'store-chat' && selectedStoreId ? selectedStoreId : null;

  const { totalUnread, hasUnread, unreadByStore, unreadSendersByStore } = useUnreadStoreChat({
    authorizedStoreIds,
    currentUserId: profile.userId,
    viewingStoreId,
  });

  const close = useCallback(() => {
    setOpen(false);
    resetFlash();
  }, [resetFlash]);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useNativeBack(
    () => {
      if (!open || layout.mode !== 'focus') return false;
      layout.exitFocus();
      return true;
    },
    open && layout.mode === 'focus',
    BACK_PRIORITY.ASSISTANT_FOCUS,
  );

  useNativeBack(
    () => {
      if (!open) return false;
      close();
      return true;
    },
    open,
    BACK_PRIORITY.MODAL,
  );

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      launcherRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    resetFlash();
  }, [activeTab, resetFlash]);

  useEffect(() => {
    function onOpenStoreChat(event: Event) {
      const detail = (event as CustomEvent<OpenStoreChatDetail>).detail;
      const storeId = detail?.storeId?.trim();
      if (!storeId) return;
      setInitialStoreChatMessageId(detail?.messageId?.trim() || '');
      setSelectedStoreId(storeId);
      setActiveTab('store-chat');
      setOpen(true);
    }
    window.addEventListener(OPEN_STORE_CHAT_EVENT, onOpenStoreChat);
    return () => window.removeEventListener(OPEN_STORE_CHAT_EVENT, onOpenStoreChat);
  }, [setSelectedStoreId]);

  useEffect(() => {
    function onOpenLogbook() {
      close();
    }
    window.addEventListener(OPEN_LOGBOOK_EVENT, onOpenLogbook);
    return () => window.removeEventListener(OPEN_LOGBOOK_EVENT, onOpenLogbook);
  }, [close]);

  const launcherUnread = groupChatOn ? conversationUnread || totalUnread : totalUnread;
  const launcherHasUnread = groupChatOn
    ? conversationUnread > 0 || hasUnread
    : hasUnread;

  const root = (
    <div
      className="floating-assistant-root"
      data-panel-state={open ? 'open' : 'closed'}
      data-composer-state={composerState}
      data-fa-mode={layout.mode}
    >
      <FloatingAssistantLauncher
        open={open}
        side={side}
        dragging={dragging}
        dragX={dragX}
        dragEnabled={dragEnabled}
        unreadCount={launcherUnread}
        hasUnread={launcherHasUnread}
        onToggle={toggle}
        onDockLeft={dockLeft}
        onDockRight={dockRight}
        onReset={resetPosition}
        beginPointerDrag={beginPointerDrag}
        buttonRef={launcherRef}
      />
      <FloatingAssistantPanel
        open={open}
        side={side}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onClose={close}
        profile={profile}
        stores={authorizedStores}
        selectedStoreId={selectedStoreId}
        selectedStore={selectedStore}
        onStoreChange={setSelectedStoreId}
        storesLoading={storesLoading}
        canSend={canSend}
        composerState={composerState}
        keyFlash={keyFlash}
        composerVisual={composerVisual}
        storeChatUnread={totalUnread}
        conversationUnread={conversationUnread}
        onConversationUnreadChange={setConversationUnread}
        unreadByStore={unreadByStore}
        unreadSendersByStore={unreadSendersByStore}
        initialStoreChatMessageId={initialStoreChatMessageId}
        onInitialStoreChatMessageHandled={() => setInitialStoreChatMessageId('')}
        layout={{
          mode: layout.mode,
          formFactor: layout.formFactor,
          width: layout.width,
          height: layout.height,
          keyboardInset: layout.keyboardInset,
          finePointer: layout.finePointer,
          resizing: layout.resizing,
          sheetDragging: layout.sheetDragging,
          onExpand: layout.expand,
          onCollapse: layout.collapse,
          onEnterFocus: layout.enterFocus,
          onExitFocus: layout.exitFocus,
          onResetSize: layout.resetSize,
          onDesktopSize: layout.setDesktopSize,
          onResizeStart: () => layout.setResizing(true),
          onResizeEnd: () => layout.setResizing(false),
          onSheetHeight: layout.setMobileHeight,
          onSheetSnap: layout.snapMobile,
          onSheetDragStart: () => layout.setSheetDragging(true),
          onSheetDragEnd: () => layout.setSheetDragging(false),
          onSheetCloseRequest: close,
        }}
      />
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(root, document.body);
}
