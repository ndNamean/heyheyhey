import { describe, expect, it } from 'vitest';
import { hasAllStoreChatAccess } from './useAuthorizedChatStores';
import type { Role } from '../../types';

describe('hasAllStoreChatAccess', () => {
  it('matches Instant owner/admin/areaManager binds', () => {
    expect(hasAllStoreChatAccess('owner')).toBe(true);
    expect(hasAllStoreChatAccess('admin')).toBe(true);
    expect(hasAllStoreChatAccess('areaManager')).toBe(true);
  });

  it('denies membership and viewer roles', () => {
    const denied: Role[] = [
      'manager',
      'leader',
      'subleader',
      'hybrid',
      'staff',
      'viewer',
    ];
    for (const role of denied) {
      expect(hasAllStoreChatAccess(role)).toBe(false);
    }
  });
});
