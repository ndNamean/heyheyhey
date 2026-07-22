/**
 * Logbook issue resolution proof helpers — reuse report PROOF_TYPES semantics.
 */

import {
  needsMedia,
  needsNote,
  needsNumber,
  needsTick,
  needsVideoProof,
  PROOF_TYPES,
} from './roles';
import type { LogbookEntry, ProofType, UploadedMedia } from '../types';

export type LogbookResolutionDraft = {
  note: string;
  numberValue: string;
  checked: boolean;
  media: UploadedMedia | null;
};

export function resolveLogbookProofType(
  entry: Pick<LogbookEntry, 'resolutionProofType'>,
): ProofType {
  const raw = (entry.resolutionProofType ?? '').trim();
  if ((PROOF_TYPES as readonly string[]).includes(raw)) {
    return raw as ProofType;
  }
  return 'photo';
}

export function proofTypeLabel(proofType: string): string {
  return proofType.replace(/_/g, ' + ');
}

export function hasCorrectionFeedback(entry: Pick<LogbookEntry, 'status' | 'reviewNote' | 'entryType' | 'isAnnouncement'>): boolean {
  const status = (entry.status ?? '').trim();
  if (status !== 'in_progress') return false;
  return Boolean((entry.reviewNote ?? '').trim());
}

export function canSubmitResolutionDraft(
  proofType: string,
  draft: LogbookResolutionDraft,
): boolean {
  if (needsTick(proofType) && !draft.checked) return false;
  if (needsNote(proofType) && !draft.note.trim()) return false;
  if (needsNumber(proofType) && !draft.numberValue.trim()) return false;
  if (needsMedia(proofType) && !draft.media) return false;
  return true;
}

export function emptyResolutionDraft(entry?: LogbookEntry): LogbookResolutionDraft {
  return {
    note: entry?.resolutionNote ?? '',
    numberValue: entry?.resolutionNumber ?? '',
    checked: Boolean(entry?.resolutionChecked),
    media: null,
  };
}

export {
  needsTick,
  needsMedia,
  needsNote,
  needsNumber,
  needsVideoProof,
  PROOF_TYPES,
};
