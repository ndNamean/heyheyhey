/**
 * Pure helpers for Stage A logbook resolution submit (multi-file proofs).
 * Instant `resolutionMedia` is `has: 'many'`; the HTTP handler applies these id lists.
 */

/**
 * Prefer `fileIds` array; fall back to legacy singular `fileId`.
 * Trim, drop empties, dedupe (same pattern as group-chat invitee ids).
 */
export function parseSubmitFileIds(body) {
  if (Array.isArray(body?.fileIds)) {
    const fromArray = [
      ...new Set(body.fileIds.map((x) => String(x).trim()).filter(Boolean)),
    ];
    if (fromArray.length > 0) return fromArray;
  }
  const fileId = String(body?.fileId || '').trim();
  return fileId ? [fileId] : [];
}

/**
 * Instant many-array or legacy single `{ id }` (mirrors client normalizeResolutionMediaList).
 */
export function linkedFileIds(rel) {
  if (!rel) return [];
  const list = Array.isArray(rel) ? rel : rel.id ? [rel] : [];
  const seen = new Set();
  const ids = [];
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function toIdSet(raw) {
  if (raw instanceof Set) {
    return new Set([...raw].filter(Boolean).map((id) => String(id)));
  }
  if (Array.isArray(raw)) {
    return new Set(raw.filter(Boolean).map((id) => String(id)));
  }
  return new Set();
}

/**
 * Replace-the-set plan: unlink current proofs, history-link priors, then
 * history-link + current-link every new fileId.
 *
 * @returns {{
 *   unlinkResolutionMediaIds: string[],
 *   unlinkPhotoIds: string[],
 *   historyLinkIds: string[],
 *   currentLinkIds: string[],
 * }}
 */
export function planResolutionMediaLinks({
  priorResolutionMedia,
  priorPhotoId,
  historyIds,
  newFileIds,
} = {}) {
  const priorFileIds = linkedFileIds(priorResolutionMedia);
  const currentLinkIds = [
    ...new Set(
      (Array.isArray(newFileIds) ? newFileIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    ),
  ];
  const historySet = toIdSet(historyIds);
  const historyLinkIds = [];

  for (const id of priorFileIds) {
    if (historySet.has(id)) continue;
    historyLinkIds.push(id);
    historySet.add(id);
  }
  for (const id of currentLinkIds) {
    if (historySet.has(id)) continue;
    historyLinkIds.push(id);
    historySet.add(id);
  }

  const photoId = String(priorPhotoId || '').trim();
  const unlinkPhotoIds =
    photoId && priorFileIds.includes(photoId) ? [photoId] : [];

  return {
    unlinkResolutionMediaIds: priorFileIds,
    unlinkPhotoIds,
    historyLinkIds,
    currentLinkIds,
  };
}
