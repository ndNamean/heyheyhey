import type { Store } from '../../types';
import { getKnowledgeAssistantMode } from './knowledgeAssistantMode';

interface PlaceholderProps {
  store: Store | null;
}

export function KnowledgeAssistantPlaceholder({ store }: PlaceholderProps) {
  const mode = getKnowledgeAssistantMode();

  return (
    <div className="fa-knowledge-placeholder">
      <p className="fa-knowledge-placeholder-title">Knowledge Assistant suspended</p>
      <p className="fa-knowledge-placeholder-body">
        Answers and citations are unavailable right now. Nothing is sent to an AI service
        from this tab.
      </p>
      {store ? (
        <p className="fa-knowledge-placeholder-store small">
          Store context: <strong>{store.code}</strong> — {store.name}
        </p>
      ) : (
        <p className="fa-knowledge-placeholder-store small">No store selected</p>
      )}
      {mode !== 'suspended' && (
        <p className="small fa-knowledge-mode-note">
          Mode flag is “{mode}” but only suspended UI is implemented.
        </p>
      )}
    </div>
  );
}

interface ComposerProps {
  disabled?: boolean;
}

export function KnowledgeAssistantComposer({ disabled = true }: ComposerProps) {
  return (
    <div className="fa-composer fa-composer--knowledge" data-composer-enabled={!disabled}>
      <label className="sr-only" htmlFor="fa-knowledge-composer">
        Knowledge question
      </label>
      <textarea
        id="fa-knowledge-composer"
        className="fa-composer-input"
        rows={2}
        disabled={disabled}
        placeholder="Knowledge Assistant pending…"
        aria-disabled={disabled}
        value=""
        readOnly
      />
      <button type="button" className="fa-composer-send" disabled aria-disabled="true">
        Ask
      </button>
    </div>
  );
}

export function KnowledgeAssistantStatus() {
  return (
    <p className="fa-knowledge-status small" role="status">
      Suspended — no requests
    </p>
  );
}

interface PanelProps {
  store: Store | null;
  panelId: string;
  labelledBy: string;
  hidden: boolean;
}

export default function KnowledgeAssistantPanel({
  store,
  panelId,
  labelledBy,
  hidden,
}: PanelProps) {
  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={hidden}
      className="fa-tab-panel fa-knowledge-panel"
    >
      <KnowledgeAssistantStatus />
      <div className="fa-tab-panel-body">
        <KnowledgeAssistantPlaceholder store={store} />
      </div>
      <KnowledgeAssistantComposer disabled />
    </div>
  );
}
