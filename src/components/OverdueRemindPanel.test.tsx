// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  db: {
    queryOnce: vi.fn(async () => ({ data: { storeChatMessages: [] } })),
  },
}));

import OverdueRemindPanel from './OverdueRemindPanel';

const copy = {
  assignedTo: 'This logbook is assigned to {mentions}',
  unassignedBlock: 'Fix assignment before remind.',
  askRemind: 'Remind overdue to Store Chat?',
  confirmRemind: 'Remind to Store Chat',
  notNow: 'Not now',
  alreadyReminded: 'Already reminded once',
  openStoreChat: 'Open Store Chat',
  reminding: 'Sending…',
};

afterEach(() => {
  cleanup();
});

describe('OverdueRemindPanel', () => {
  it('shows unassigned branch with disabled remind', () => {
    const onConfirm = vi.fn();
    render(
      <OverdueRemindPanel
        state="unassigned"
        mentionLabels={[]}
        entryId="e1"
        copy={copy}
        onConfirm={onConfirm}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('overdue-remind-unassigned').textContent).toContain(
      'Fix assignment before remind.',
    );
    const remindBtn = screen.getByRole('button', { name: 'Remind to Store Chat' }) as HTMLButtonElement;
    expect(remindBtn.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows confirm CTA when not reminded', () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <OverdueRemindPanel
        state="not_reminded"
        mentionLabels={['Ada', 'Bob']}
        entryId="e1"
        copy={copy}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('overdue-remind-assigned').textContent).toContain(
      'This logbook is assigned to @Ada @Bob',
    );
    fireEvent.click(screen.getByTestId('overdue-remind-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows already-reminded branch and optional open chat', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(
      <OverdueRemindPanel
        state="reminded"
        mentionLabels={['Ada']}
        remindedAt="2026-08-10T11:00:00.000Z"
        storeId="store-a"
        entryId="e1"
        copy={copy}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('overdue-remind-already').textContent).toContain(
      'Already reminded once',
    );
    fireEvent.click(screen.getByTestId('overdue-remind-open-chat'));
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalled();
    });
    dispatchSpy.mockRestore();
  });

  it('dispatches messageId and startReply when remind id is known', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(
      <OverdueRemindPanel
        state="reminded"
        mentionLabels={['Ada']}
        remindedAt="2026-08-10T11:00:00.000Z"
        storeId="store-a"
        entryId="e1"
        remindMessageId="msg-remind"
        copy={copy}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('overdue-remind-open-chat'));
    await waitFor(() => {
      const evt = dispatchSpy.mock.calls
        .map(([arg]) => arg)
        .find((arg): arg is CustomEvent => arg instanceof CustomEvent);
      expect(evt?.type).toBe('heyPelo:openStoreChat');
      expect(evt?.detail).toEqual({
        storeId: 'store-a',
        messageId: 'msg-remind',
        startReply: true,
      });
    });
    dispatchSpy.mockRestore();
  });
});
