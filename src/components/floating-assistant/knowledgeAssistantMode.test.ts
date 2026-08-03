import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getKnowledgeAssistantMode,
  isKnowledgeAssistantSuspended,
} from './knowledgeAssistantMode';

describe('knowledgeAssistantMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to suspended when unset', () => {
    vi.stubEnv('VITE_KNOWLEDGE_ASSISTANT_MODE', undefined);
    expect(getKnowledgeAssistantMode()).toBe('suspended');
    expect(isKnowledgeAssistantSuspended()).toBe(true);
  });

  it('accepts suspended / iframe / native (case-insensitive)', () => {
    vi.stubEnv('VITE_KNOWLEDGE_ASSISTANT_MODE', 'IFRAME');
    expect(getKnowledgeAssistantMode()).toBe('iframe');
    expect(isKnowledgeAssistantSuspended()).toBe(false);

    vi.stubEnv('VITE_KNOWLEDGE_ASSISTANT_MODE', 'native');
    expect(getKnowledgeAssistantMode()).toBe('native');

    vi.stubEnv('VITE_KNOWLEDGE_ASSISTANT_MODE', ' suspended ');
    expect(getKnowledgeAssistantMode()).toBe('suspended');
  });

  it('falls back to suspended for unknown values', () => {
    vi.stubEnv('VITE_KNOWLEDGE_ASSISTANT_MODE', 'enabled');
    expect(getKnowledgeAssistantMode()).toBe('suspended');
    expect(isKnowledgeAssistantSuspended()).toBe(true);
  });
});
