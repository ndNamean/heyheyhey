/** Knowledge Assistant integration mode. Default suspended = no network/AI. */
export type KnowledgeAssistantMode = 'suspended' | 'iframe' | 'native';

/**
 * Future embed boundary only — unused while mode is suspended.
 * Do not call from production UI until a real adapter ships.
 */
export interface KnowledgeAssistantAdapter {
  openSession?(storeId: string): Promise<{ sessionCode: string }>;
  closeSession?(sessionId: string): void;
}

export function getKnowledgeAssistantMode(): KnowledgeAssistantMode {
  const raw = String(import.meta.env.VITE_KNOWLEDGE_ASSISTANT_MODE ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'iframe' || raw === 'native' || raw === 'suspended') return raw;
  return 'suspended';
}

export function isKnowledgeAssistantSuspended(): boolean {
  return getKnowledgeAssistantMode() === 'suspended';
}
