import { describe, expect, it } from 'vitest';
import {
  favoriteActionLabel,
  isStoreChatActionAvailable,
  listStoreChatActions,
  resolveStoreChatActionKeyboard,
  type StoreChatActionCapabilityContext,
} from './storeChatActions';

const baseCtx: StoreChatActionCapabilityContext = {
  isOwn: false,
  isDeleted: false,
  canSend: true,
  canReact: true,
  hasBody: true,
  translationAvailable: true,
  isBookmarked: false,
  canForward: true,
};

describe('storeChatActions', () => {
  it('exposes strip actions React, Reply, More', () => {
    const ids = listStoreChatActions('strip', baseCtx).map((a) => a.id);
    expect(ids).toEqual(['react', 'reply', 'more']);
  });

  it('hides delete for non-own and translate when unavailable', () => {
    const ids = listStoreChatActions('moreMenu', {
      ...baseCtx,
      translationAvailable: false,
    }).map((a) => a.id);
    expect(ids).toContain('copy');
    expect(ids).toContain('forward');
    expect(ids).toContain('favorite');
    expect(ids).not.toContain('translate');
    expect(ids).not.toContain('delete');
  });

  it('allows delete only for own active messages', () => {
    expect(isStoreChatActionAvailable('delete', { ...baseCtx, isOwn: true })).toBe(true);
    expect(isStoreChatActionAvailable('delete', baseCtx)).toBe(false);
    expect(
      isStoreChatActionAvailable('delete', { ...baseCtx, isOwn: true, isDeleted: true }),
    ).toBe(false);
  });

  it('maps R/C keyboard shortcuts when capable', () => {
    expect(resolveStoreChatActionKeyboard('r', baseCtx)).toBe('reply');
    expect(resolveStoreChatActionKeyboard('R', baseCtx)).toBe('reply');
    expect(resolveStoreChatActionKeyboard('c', baseCtx)).toBe('copy');
    expect(
      resolveStoreChatActionKeyboard('r', { ...baseCtx, canSend: false }),
    ).toBeNull();
  });

  it('toggles favorite label', () => {
    expect(favoriteActionLabel(false)).toBe('Favorite');
    expect(favoriteActionLabel(true)).toBe('Remove favorite');
  });

  it('applies localized action labels when provided', () => {
    const labels = {
      reply: 'Trả lời',
      react: 'Thả cảm xúc',
      more: 'Thêm',
      copy: 'Sao chép',
      forward: 'Chuyển tiếp',
      favorite: 'Yêu thích',
      removeFavorite: 'Bỏ yêu thích',
      translate: 'Dịch',
      delete: 'Xóa',
    };
    const strip = listStoreChatActions('strip', baseCtx, labels);
    expect(strip.find((a) => a.id === 'reply')?.label).toBe('Trả lời');
    expect(strip.find((a) => a.id === 'react')?.label).toBe('Thả cảm xúc');
    const favorite = listStoreChatActions('moreMenu', { ...baseCtx, isBookmarked: true }, labels).find(
      (a) => a.id === 'favorite',
    );
    expect(favorite?.label).toBe('Bỏ yêu thích');
  });

  it('blocks all actions on deleted messages', () => {
    expect(isStoreChatActionAvailable('copy', { ...baseCtx, isDeleted: true })).toBe(false);
    expect(isStoreChatActionAvailable('more', { ...baseCtx, isDeleted: true })).toBe(false);
  });

  it('strips forward and delete for logbook_system context', () => {
    const ctx = { ...baseCtx, isOwn: true, isLogbookSystem: true };
    expect(isStoreChatActionAvailable('reply', ctx)).toBe(true);
    expect(isStoreChatActionAvailable('react', ctx)).toBe(true);
    expect(isStoreChatActionAvailable('forward', ctx)).toBe(false);
    expect(isStoreChatActionAvailable('delete', ctx)).toBe(false);
    const sheet = listStoreChatActions('sheet', ctx).map((a) => a.id);
    expect(sheet).toContain('reply');
    expect(sheet).toContain('react');
    expect(sheet).not.toContain('forward');
    expect(sheet).not.toContain('delete');
  });
});
