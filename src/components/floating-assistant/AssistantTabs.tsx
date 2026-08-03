export type AssistantTabId = 'knowledge' | 'store-chat';

interface Props {
  activeTab: AssistantTabId;
  onChange: (tab: AssistantTabId) => void;
  knowledgePanelId: string;
  storeChatPanelId: string;
  storeChatUnread?: number;
}

const TABS: {
  id: AssistantTabId;
  label: string;
  controls: keyof Pick<Props, 'knowledgePanelId' | 'storeChatPanelId'>;
}[] = [
  { id: 'knowledge', label: 'Knowledge', controls: 'knowledgePanelId' },
  { id: 'store-chat', label: 'Store Chat', controls: 'storeChatPanelId' },
];

export default function AssistantTabs({
  activeTab,
  onChange,
  knowledgePanelId,
  storeChatPanelId,
  storeChatUnread = 0,
}: Props) {
  const ids = { knowledgePanelId, storeChatPanelId };

  return (
    <div className="fa-tabs" role="tablist" aria-label="Assistant panels">
      {TABS.map((tab) => {
        const selected = activeTab === tab.id;
        const showBadge = tab.id === 'store-chat' && storeChatUnread > 0;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`fa-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={ids[tab.controls]}
            tabIndex={selected ? 0 : -1}
            className={`fa-tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const next = e.key === 'ArrowRight' ? 'store-chat' : 'knowledge';
              onChange(next);
            }}
          >
            <span className="fa-tab-label">{tab.label}</span>
            {showBadge ? (
              <span
                className="fa-tab-badge"
                aria-label={`${storeChatUnread} unread store chat ${storeChatUnread === 1 ? 'message' : 'messages'}`}
              >
                {storeChatUnread > 99 ? '99+' : storeChatUnread}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
