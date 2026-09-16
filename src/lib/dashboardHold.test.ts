import { describe, expect, it } from 'vitest';
import { shouldHoldDashLive } from './dashboardHold';

describe('shouldHoldDashLive', () => {
  it('does not hold before Instant returns data', () => {
    expect(shouldHoldDashLive(undefined, null)).toBe(false);
    expect(shouldHoldDashLive(null, null)).toBe(false);
  });

  it('does not hold an empty first snapshot', () => {
    expect(shouldHoldDashLive({ reports: [], stores: [] }, null)).toBe(false);
  });

  it('does not hold when the reports query errored', () => {
    expect(shouldHoldDashLive({ reports: [{ id: 'r1' }], stores: [{ id: 's1' }] }, new Error('fail'))).toBe(
      false,
    );
  });

  it('holds after stores arrive even if reports are still empty', () => {
    expect(shouldHoldDashLive({ reports: [], stores: [{ id: 's1' }] }, null)).toBe(true);
  });

  it('holds after reports arrive', () => {
    expect(shouldHoldDashLive({ reports: [{ id: 'r1' }], stores: [] }, null)).toBe(true);
  });
});
