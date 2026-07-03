import type { Profile, Report, ReportResponse } from '../types';

export type FeedbackCode =
  | 'blurry'
  | 'too_dark'
  | 'wrong_angle'
  | 'wrong_area'
  | 'still_dirty'
  | 'lens_smudge'
  | 'overexposed'
  | 'blocked'
  | 'incomplete'
  | 'irrelevant'
  | 'duplicate'
  | 'non_compliant'
  | 'other';

export interface FeedbackReasonOption {
  code: FeedbackCode;
  label: string;
}

export const FEEDBACK_REASONS: FeedbackReasonOption[] = [
  { code: 'blurry', label: 'Blurry – Mờ' },
  { code: 'too_dark', label: 'Too dark – Thiếu sáng' },
  { code: 'wrong_angle', label: 'Wrong angle – Sai góc' },
  { code: 'wrong_area', label: 'Wrong area – Sai khu vực' },
  { code: 'still_dirty', label: 'Still dirty – Còn bẩn' },
  { code: 'lens_smudge', label: 'Lens smudge – Mờ ống kính' },
  { code: 'overexposed', label: 'Overexposed – Quá sáng' },
  { code: 'blocked', label: 'Blocked – Bị che' },
  { code: 'incomplete', label: 'Incomplete – Thiếu chi tiết' },
  { code: 'irrelevant', label: 'Irrelevant – Không liên quan' },
  { code: 'duplicate', label: 'Duplicate – Trùng' },
  { code: 'non_compliant', label: 'Non-compliant – Không đạt' },
  { code: 'other', label: 'Other – Khác (free input)' },
];

const LABEL_BY_CODE = Object.fromEntries(FEEDBACK_REASONS.map((r) => [r.code, r.label])) as Record<
  FeedbackCode,
  string
>;

export function getFeedbackLabel(code: string): string {
  if (code in LABEL_BY_CODE) return LABEL_BY_CODE[code as FeedbackCode];
  if (code === 'other' || !code) return FEEDBACK_REASONS.find((r) => r.code === 'other')!.label;
  return code;
}

export function buildFeedbackText(code: FeedbackCode, freeText?: string, extraNote?: string): string {
  const note = extraNote?.trim();
  if (code === 'other') {
    const body = freeText?.trim() || '';
    return body;
  }
  const label = getFeedbackLabel(code);
  if (note) return `${label}\n${note}`;
  return label;
}

export function resolveFeedbackCode(resp: ReportResponse): FeedbackCode {
  const code = resp.feedbackCode?.trim();
  if (code && code in LABEL_BY_CODE) return code as FeedbackCode;
  return 'other';
}

export interface FeedbackFrequencyRow {
  code: FeedbackCode;
  label: string;
  count: number;
  percent: number;
}

export interface FeedbackOtherDetail {
  id: string;
  reportDate: string;
  storeCode: string;
  itemTitle: string;
  status: string;
  text: string;
  reviewerName: string;
  reviewerRole: string;
}

export function aggregateFeedbackFrequency(
  reports: Report[],
  profiles: Profile[],
): { rows: FeedbackFrequencyRow[]; otherDetails: FeedbackOtherDetail[] } {
  const counts: Record<string, number> = {};
  const otherDetails: FeedbackOtherDetail[] = [];

  for (const report of reports) {
    for (const resp of (report.responses ?? []) as ReportResponse[]) {
      if (!['rejected', 'need_correction'].includes(resp.status)) continue;

      const code = resolveFeedbackCode(resp);
      counts[code] = (counts[code] ?? 0) + 1;

      if (code === 'other') {
        const approver = profiles.find((p) => p.userId === resp.approvedByUserId);
        const text =
          resp.feedbackNote?.trim() ||
          resp.rejectionReason?.trim() ||
          resp.status;
        otherDetails.push({
          id: resp.id,
          reportDate: report.reportDate,
          storeCode: report.storeCode,
          itemTitle: resp.title,
          status: resp.status,
          text,
          reviewerName: approver?.displayName || approver?.email?.split('@')[0] || 'Unknown',
          reviewerRole: approver?.role || 'unknown',
        });
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows: FeedbackFrequencyRow[] = Object.entries(counts)
    .map(([code, count]) => ({
      code: code as FeedbackCode,
      label: getFeedbackLabel(code),
      count,
      percent: total ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  otherDetails.sort((a, b) => b.reportDate.localeCompare(a.reportDate));

  return { rows, otherDetails };
}
