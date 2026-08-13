import type { LogSeverity, LogbookEntry, MediaRecord, Report, ReportResponse } from '../types';

export type FinaliseLogbookIssueMappedFields = {
  content: string;
  assigneeRole: string;
  assigneeUserIds: string[];
  resolutionProofType: string;
  resolutionRequirement: string;
  sourceFileIds: string[];
  sourceReportId: string;
  sourceResponseId: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `datetime-local` value for end of (reportDate + 1 day) in local wall clock. */
export function defaultFinaliseIssueDueLocal(reportDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(reportDate || '').trim());
  let d: Date;
  if (m) {
    d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 23, 59, 0, 0);
  } else {
    d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** True when an issue already exists for this checklist response (dedupe). */
export function hasLogbookIssueForResponse(
  entries: Pick<LogbookEntry, 'sourceResponseId'>[],
  responseId: string,
): boolean {
  const id = String(responseId || '').trim();
  if (!id) return false;
  return entries.some((e) => String(e.sourceResponseId || '').trim() === id);
}

/** Need-correction items that do not already have a linked logbook issue. */
export function needCorrectionItemsForLogbookIssues(
  responses: ReportResponse[],
  existingEntries: Pick<LogbookEntry, 'sourceResponseId'>[],
): ReportResponse[] {
  return responses.filter(
    (r) => r.status === 'need_correction' && !hasLogbookIssueForResponse(existingEntries, r.id),
  );
}

export function sourceFileIdsFromResponseMedia(
  media: MediaRecord[] | undefined | null,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of media ?? []) {
    const fileId = String(m.file?.id || '').trim();
    if (!fileId || seen.has(fileId)) continue;
    seen.add(fileId);
    ids.push(fileId);
  }
  return ids;
}

/**
 * Map a Needs correction response → logbook create fields (no Instant side effects).
 * Reviewer becomes authorUserId at create time; assignee is the item/report submitter.
 */
export function mapNeedCorrectionItemToLogbookIssue(
  report: Pick<Report, 'id' | 'storeId' | 'submittedByUserId' | 'submittedByRole'>,
  response: Pick<
    ReportResponse,
    | 'id'
    | 'title'
    | 'proofType'
    | 'rejectionReason'
    | 'feedbackNote'
    | 'submittedByUserId'
    | 'submittedByRole'
    | 'media'
  >,
): FinaliseLogbookIssueMappedFields {
  const assigneeUserId = String(
    response.submittedByUserId || report.submittedByUserId || '',
  ).trim();
  const assigneeRole = String(
    response.submittedByRole || report.submittedByRole || 'staff',
  ).trim() || 'staff';
  const requirement = String(
    response.rejectionReason || response.feedbackNote || '',
  ).trim();
  const title = String(response.title || '').trim() || 'Checklist item';
  const content = requirement ? `${title}\n\n${requirement}` : title;

  return {
    content,
    assigneeRole,
    assigneeUserIds: assigneeUserId ? [assigneeUserId] : [],
    resolutionProofType: String(response.proofType || '').trim() || 'photo',
    resolutionRequirement: requirement,
    sourceFileIds: sourceFileIdsFromResponseMedia(response.media as MediaRecord[] | undefined),
    sourceReportId: report.id,
    sourceResponseId: response.id,
  };
}

export type CreateFinaliseLogbookIssueInput = FinaliseLogbookIssueMappedFields & {
  storeId: string;
  severity: LogSeverity;
  dueAtIso: string;
  authorUserId: string;
  shift?: string;
  date: string;
  createdAt: string;
  createdTimezone: string;
};
