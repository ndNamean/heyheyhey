// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('shows already-reminded branch and optional open chat', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(
      <OverdueRemindPanel
        state="reminded"
        mentionLabels={['Ada']}
        remindedAt="2026-08-10T11:00:00.000Z"
        storeId="store-a"
        copy={copy}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('overdue-remind-already').textContent).toContain(
      'Already reminded once',
    );
    fireEvent.click(screen.getByTestId('overdue-remind-open-chat'));
    expect(dispatchSpy).toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });
});
