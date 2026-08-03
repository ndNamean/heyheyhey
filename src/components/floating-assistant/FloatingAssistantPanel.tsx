import { useEffect, useRef } from 'react';
import type { Profile, Store } from '../../types';
import AssistantTabs, { type AssistantTabId } from './AssistantTabs';
import AuthorizedStoreSelector from './AuthorizedStoreSelector';
import KnowledgeAssistantPanel from './KnowledgeAssistantPanel';
import StoreChatPanel from './StoreChatPanel';
import FloatingAssistantLoader from './FloatingAssistantLoader';
import { FLOATING_ASSISTANT_PANEL_ID } from './FloatingAssistantLauncher';
import type {
  ComposerVisualHandlers,
  ComposerVisualState,
} from './useComposerVisualState';
import type { LauncherSide } from './useFloatingLauncherPosition';

const KNOWLEDGE_PANEL_ID = 'fa-panel-knowledge';
const STORE_CHAT_PANEL_ID = 'fa-panel-store-chat';

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
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    const closeBtn = el.querySelector<HTMLElement>('.fa-panel-close');
    (closeBtn ?? el).focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      id={FLOATING_ASSISTANT_PANEL_ID}
      className={`fa-panel fa-panel--${side}`}
      role="dialog"
      aria-modal="false"
      aria-label="Assistant and store chat"
      tabIndex={-1}
      data-panel-state="open"
      data-composer-state={composerState}
      data-key-flash={keyFlash ? 'true' : undefined}
    >
      <header className="fa-panel-header">
        <div className="fa-panel-header-text">
          <h2 className="fa-panel-title">Assistant</h2>
          <p className="fa-panel-subtitle small">Knowledge & store chat</p>
        </div>
        <button
          type="button"
          className="fa-panel-close"
          aria-label="Close assistant"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="fa-panel-store">
        {storesLoading ? (
          <FloatingAssistantLoader label="Loading stores…" />
        ) : (
          <AuthorizedStoreSelector
            stores={stores}
            selectedStoreId={selectedStoreId}
            onChange={onStoreChange}
          />
        )}
      </div>

      <AssistantTabs
        activeTab={activeTab}
        onChange={onTabChange}
        knowledgePanelId={KNOWLEDGE_PANEL_ID}
        storeChatPanelId={STORE_CHAT_PANEL_ID}
        storeChatUnread={storeChatUnread}
      />

      <div className="fa-panel-body">
        <KnowledgeAssistantPanel
          store={selectedStore}
          panelId={KNOWLEDGE_PANEL_ID}
          labelledBy="fa-tab-knowledge"
          hidden={activeTab !== 'knowledge'}
        />
        <StoreChatPanel
          store={selectedStore}
          profile={profile}
          panelId={STORE_CHAT_PANEL_ID}
          labelledBy="fa-tab-store-chat"
          hidden={activeTab !== 'store-chat'}
          canSend={canSend}
          composerVisual={composerVisual}
        />
      </div>
    </div>
  );
}
