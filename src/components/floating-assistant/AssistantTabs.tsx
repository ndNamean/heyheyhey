import { isChatsSurfaceEnabled } from '../../lib/storeOpsLeadershipFlag';

export type AssistantTabId = 'knowledge' | 'store-chat';

interface Props {
  activeTab: AssistantTabId;
  onChange: (tab: AssistantTabId) => void;
  knowledgePanelId: string;
  storeChatPanelId: string;
  storeChatUnread?: number;
  /** When group chat is on, badge = unread conversations (+ pending invites). */
  conversationUnread?: number;
}

export default function AssistantTabs({
  activeTab,
  onChange,
  knowledgePanelId,
  storeChatPanelId,
  storeChatUnread = 0,
  conversationUnread,
}: Props) {
  const chatsSurfaceOn = isChatsSurfaceEnabled();
  const chatsLabel = chatsSurfaceOn ? 'Chats' : 'Store Chat';
  const badgeCount = chatsSurfaceOn
    ? conversationUnread ?? storeChatUnread
    : storeChatUnread;
  const ids = { knowledgePanelId, storeChatPanelId };

  const tabs: {
    id: AssistantTabId;
    label: string;
    controls: keyof Pick<Props, 'knowledgePanelId' | 'storeChatPanelId'>;
  }[] = [
    { id: 'knowledge', label: 'Knowledge', controls: 'knowledgePanelId' },
    { id: 'store-chat', label: chatsLabel, controls: 'storeChatPanelId' },
  ];

  return (
    <div className="fa-tabs" role="tablist" aria-label="Assistant panels">
      {tabs.map((tab) => {
        const selected = activeTab === tab.id;
        const showBadge = tab.id === 'store-chat' && badgeCount > 0;
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
                aria-label={
                  chatsSurfaceOn
                    ? `${badgeCount} unread conversations`
                    : `${badgeCount} unread store chat ${badgeCount === 1 ? 'message' : 'messages'}`
                }
              >
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
