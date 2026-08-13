import { describe, expect, it } from 'vitest';
import {
  defaultFinaliseIssueDueLocal,
  hasLogbookIssueForResponse,
  mapNeedCorrectionItemToLogbookIssue,
  needCorrectionItemsForLogbookIssues,
  sourceFileIdsFromResponseMedia,
} from './finaliseLogbookIssues';
import type { LogbookEntry, MediaRecord, Report, ReportResponse } from '../types';

function report(partial: Partial<Report> = {}): Report {
  return {
    id: partial.id ?? 'report-1',
    storeId: partial.storeId ?? 'store-a',
    storeCode: partial.storeCode ?? 'TKA',
    storeName: partial.storeName ?? 'Store A',
    templateId: partial.templateId ?? 't1',
    templateName: partial.templateName ?? 'Checklist',
    reportType: partial.reportType ?? 'daily',
    reportDate: partial.reportDate ?? '2026-08-12',
    submittedByUserId: partial.submittedByUserId ?? 'staff-1',
    submittedByRole: partial.submittedByRole ?? 'staff',
    submittedAt: partial.submittedAt ?? '',
    status: partial.status ?? 'waiting_approval',
    completionPercent: partial.completionPercent ?? 100,
    compliancePercent: partial.compliancePercent ?? 0,
    archived: partial.archived ?? false,
    archiveMonth: partial.archiveMonth ?? '',
    createdAt: partial.createdAt ?? '',
    updatedAt: partial.updatedAt ?? '',
    responses: partial.responses,
  };
}

function response(partial: Partial<ReportResponse> = {}): ReportResponse {
  return {
    id: partial.id ?? 'resp-1',
    reportId: partial.reportId ?? 'report-1',
    templateItemId: partial.templateItemId ?? 'item-1',
    section: partial.section ?? 'Ops',
    title: partial.title ?? 'Nấu khăn',
    proofType: partial.proofType ?? 'photo',
    required: partial.required ?? true,
    assignedRole: partial.assignedRole ?? 'staff',
    approverRolesJson: partial.approverRolesJson ?? '[]',
    weight: partial.weight ?? 1,
    failureCategory: partial.failureCategory ?? 'Operations',
    ticked: partial.ticked ?? true,
    numberValue: partial.numberValue ?? '',
    note: partial.note ?? '',
    status: partial.status ?? 'need_correction',
    rejectionReason: partial.rejectionReason ?? 'Blurry photo',
    feedbackCode: partial.feedbackCode ?? 'blurry',
    feedbackNote: partial.feedbackNote ?? '',
    submittedByUserId: partial.submittedByUserId ?? 'staff-1',
    submittedByRole: partial.submittedByRole ?? 'staff',
    submittedAt: partial.submittedAt ?? '',
    approvedByUserId: partial.approvedByUserId ?? '',
    approvedAt: partial.approvedAt ?? '',
    updatedAt: partial.updatedAt ?? '',
    storeId: partial.storeId,
    media: partial.media,
  };
}

describe('defaultFinaliseIssueDueLocal', () => {
  it('defaults to end of reportDate + 1 day', () => {
    expect(defaultFinaliseIssueDueLocal('2026-08-12')).toBe('2026-08-13T23:59');
  });
});

describe('sourceFileIdsFromResponseMedia', () => {
  it('collects unique $file ids and skips missing file links', () => {
    const media = [
      { id: 'm1', file: { id: 'file-a', url: 'https://x/a.jpg' } },
      { id: 'm2', file: { id: 'file-b', url: 'https://x/b.jpg' } },
      { id: 'm3', file: { id: 'file-a', url: 'https://x/a.jpg' } },
      { id: 'm4' },
    ] as MediaRecord[];
    expect(sourceFileIdsFromResponseMedia(media)).toEqual(['file-a', 'file-b']);
  });
});

describe('mapNeedCorrectionItemToLogbookIssue', () => {
  it('maps content, named submitter assignee, proof, and source ids', () => {
    const mapped = mapNeedCorrectionItemToLogbookIssue(
      report(),
      response({
        title: 'Nấu khăn',
        rejectionReason: 'Retake clearer photo',
        proofType: 'photo',
        submittedByUserId: 'staff-9',
        submittedByRole: 'staff',
        media: [
          {
            id: 'm1',
            file: { id: 'file-1', url: 'https://x/1.jpg' },
          } as MediaRecord,
        ],
      }),
    );

    expect(mapped.content).toBe('Nấu khăn\n\nRetake clearer photo');
    expect(mapped.assigneeRole).toBe('staff');
    expect(mapped.assigneeUserIds).toEqual(['staff-9']);
    expect(mapped.resolutionProofType).toBe('photo');
    expect(mapped.resolutionRequirement).toBe('Retake clearer photo');
    expect(mapped.sourceFileIds).toEqual(['file-1']);
    expect(mapped.sourceReportId).toBe('report-1');
    expect(mapped.sourceResponseId).toBe('resp-1');
  });

  it('falls back to report submitter when item submitter is empty', () => {
    const mapped = mapNeedCorrectionItemToLogbookIssue(
      report({ submittedByUserId: 'report-staff', submittedByRole: 'hybrid' }),
      response({ submittedByUserId: '', submittedByRole: '', rejectionReason: '' }),
    );
    expect(mapped.assigneeUserIds).toEqual(['report-staff']);
    expect(mapped.assigneeRole).toBe('hybrid');
    expect(mapped.content).toBe('Nấu khăn');
  });
});

describe('needCorrectionItemsForLogbookIssues', () => {
  it('skips responses that already have a sourceResponseId issue', () => {
    const items = needCorrectionItemsForLogbookIssues(
      [
        response({ id: 'resp-new', status: 'need_correction' }),
        response({ id: 'resp-dup', status: 'need_correction' }),
        response({ id: 'resp-ok', status: 'approved' }),
      ],
      [{ sourceResponseId: 'resp-dup' } as LogbookEntry],
    );
    expect(items.map((i) => i.id)).toEqual(['resp-new']);
  });

  it('hasLogbookIssueForResponse matches trimmed ids', () => {
    expect(
      hasLogbookIssueForResponse([{ sourceResponseId: 'resp-1' }], 'resp-1'),
    ).toBe(true);
    expect(hasLogbookIssueForResponse([{ sourceResponseId: '' }], 'resp-1')).toBe(false);
  });
});
