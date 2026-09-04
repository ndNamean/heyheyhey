/**
 * Shared "store still owes work" rule for needs-action, remind, submit continue, My Reports.
 * - rejected / need_correction always count
 * - not_started counts only when required !== false (optional skips must not keep the badge)
 */

export type StoreWorkResponseLike = {
  status?: string | null;
  required?: boolean | null;
};

export function isStoreWorkResponse(resp: StoreWorkResponseLike): boolean {
  const s = String(resp?.status ?? '');
  if (s === 'rejected' || s === 'need_correction') return true;
  if (s === 'not_started') return resp.required !== false;
  return false;
}

export function filterStoreWorkResponses<T extends StoreWorkResponseLike>(responses: T[]): T[] {
  return (responses ?? []).filter(isStoreWorkResponse);
}

export function hasStoreWorkResponses(
  responses: StoreWorkResponseLike[] | undefined | null,
): boolean {
  return (responses ?? []).some(isStoreWorkResponse);
}

/** Classify store-work rows for CTA labels (complete vs fix vs mixed). */
export function classifyStoreWorkResponses(responses: StoreWorkResponseLike[]): {
  completeCount: number;
  fixCount: number;
  total: number;
} {
  let completeCount = 0;
  let fixCount = 0;
  for (const resp of responses ?? []) {
    if (!isStoreWorkResponse(resp)) continue;
    const s = String(resp.status ?? '');
    if (s === 'not_started') completeCount += 1;
    else fixCount += 1;
  }
  return { completeCount, fixCount, total: completeCount + fixCount };
}
