// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useRef } from 'react';
import { useFocusModeA11y } from './useFocusModeA11y';

function Harness({ enabled }: { enabled: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<HTMLButtonElement>(null);
  useFocusModeA11y({ enabled, panelRef, initialFocusRef: initialRef });
  return (
    <div>
      <div className="app-shell" data-testid="shell">
        <button type="button">Outside</button>
      </div>
      <div ref={panelRef} tabIndex={-1} data-testid="panel">
        <button ref={initialRef} type="button">
          Exit Focus
        </button>
        <button type="button">Close</button>
      </div>
    </div>
  );
}

describe('useFocusModeA11y', () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll('.app-shell').forEach((el) => el.removeAttribute('inert'));
  });

  it('sets inert on app-shell and focuses Exit Focus when enabled', () => {
    const { getByTestId, getByText, rerender } = render(<Harness enabled={false} />);
    expect(getByTestId('shell').hasAttribute('inert')).toBe(false);

    rerender(<Harness enabled={true} />);
    expect(getByTestId('shell').hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(getByText('Exit Focus'));

    rerender(<Harness enabled={false} />);
    expect(getByTestId('shell').hasAttribute('inert')).toBe(false);
  });

  it('traps Tab focus inside the panel', () => {
    const { getByText } = render(<Harness enabled={true} />);
    const exitBtn = getByText('Exit Focus');
    const closeBtn = getByText('Close');

    closeBtn.focus();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(exitBtn);
  });
});
