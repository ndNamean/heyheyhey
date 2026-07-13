/** Feature flag for Failure & Correction History section */
export function isFailureHistoryEnabled(): boolean {
  const env = import.meta.env.VITE_FAILURE_HISTORY;
  if (env === '0' || env === 'false') return false;
  if (env === '1' || env === 'true') return true;
  try {
    const stored = localStorage.getItem('failureHistoryEnabled');
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    // ignore
  }
  return true;
}

export function setFailureHistoryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('failureHistoryEnabled', enabled ? '1' : '0');
  } catch {
    // ignore
  }
}
