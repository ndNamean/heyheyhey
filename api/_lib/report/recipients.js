/**
 * Server-side Report Store Chat recipient selection.
 * Mirrors src/lib/reportReview.ts + notifications getReviewNotificationRecipients.
 */

import { hasStoreAccess } from '../logbook/ack-chat-rooms.js';

function rankOf(roleKey, defs) {
  const found = (defs || []).find((d) => d.key === roleKey && d.active !== false);
  if (found && typeof found.rank === 'number') return found.rank;
  const legacy = {
    owner: 0,
    admin: 1,
    areaManager: 2,
    manager: 3,
    leader: 4,
    subleader: 5,
    hybrid: 6,
    staff: 7,
    viewer: 8,
  };
  return legacy[roleKey] ?? 99;
}

function canReviewRole(roleKey, defs) {
  const found = (defs || []).find((d) => d.key === roleKey && d.active !== false);
  if (found && typeof found.canReview === 'boolean') return found.canReview;
  return [
    'owner',
    'admin',
    'areaManager',
    'manager',
    'leader',
    'subleader',
    'hybrid',
  ].includes(roleKey);
}

function parseApprovesSubmitterRoles(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function canApproveItem(submittedByRole, approverRole, _approverRoles, defs) {
  if (approverRole === 'owner') return true;
  const approverDef = (defs || []).find(
    (d) => d.key === approverRole && d.active !== false,
  );
  if (!approverDef?.canReview && !canReviewRole(approverRole, defs)) return false;
  if (!canReviewRole(approverRole, defs)) return false;
  if (rankOf(approverRole, defs) >= rankOf(submittedByRole, defs)) return false;
  const allowed = parseApprovesSubmitterRoles(
    approverDef?.approvesSubmitterRolesJson,
  );
  return allowed.includes(submittedByRole);
}

function typicalApproverRank(submitterRole, defs) {
  const submitterRank = rankOf(submitterRole, defs);
  return Math.max(0, submitterRank - 1);
}

function isHigherPositionReview(approverRole, submitterRole, defs) {
  const approverRank = rankOf(approverRole, defs);
  if (approverRank >= 999) return false;
  return approverRank < typicalApproverRank(submitterRole, defs);
}

function supervisorRolesToNotify(submitterRole, defs) {
  const submitterRank = rankOf(submitterRole, defs);
  return (defs || [])
    .filter((d) => d.active !== false && d.canReview && d.rank < submitterRank)
    .map((d) => d.key);
}

function profileStoreIds(profile) {
  return (profile?.stores ?? []).map((s) => s.id).filter(Boolean);
}

function canReviewReport(profile, report, defs) {
  if (profile.approvalStatus !== 'approved') return false;
  if (!canReviewRole(profile.role, defs)) return false;
  if (!report.storeId) return false;
  return hasStoreAccess(profile, report.storeId);
}

function canReviewReportItem(profile, report, response, defs) {
  if (!canReviewReport(profile, report, defs)) return false;
  let approverRoles = [];
  try {
    const parsed = JSON.parse(response.approverRolesJson || '[]');
    if (Array.isArray(parsed)) approverRoles = parsed;
  } catch {
    approverRoles = [];
  }
  return canApproveItem(
    response.submittedByRole,
    profile.role,
    approverRoles,
    defs,
  );
}

/**
 * Reviewers who can review ≥1 waiting item; else anyone who canReviewReport.
 * Excludes actor.
 */
export function selectReportSubmittedRecipients(
  report,
  responses,
  profiles,
  actorUserId,
  defs,
) {
  const waiting = (responses || []).filter((r) => r.status === 'waiting_approval');
  const recipients = new Set();

  if (waiting.length) {
    for (const p of profiles || []) {
      if (!p.userId || p.userId === actorUserId) continue;
      if (waiting.some((resp) => canReviewReportItem(p, report, resp, defs))) {
        recipients.add(p.userId);
      }
    }
  }

  if (recipients.size === 0) {
    for (const p of profiles || []) {
      if (!p.userId || p.userId === actorUserId) continue;
      if (canReviewReport(p, report, defs)) recipients.add(p.userId);
    }
  }

  return [...recipients];
}

/** Submitter + supervisors (inbox parity). */
export function selectReportActionRecipients(
  report,
  response,
  approver,
  allProfiles,
  defs,
) {
  const recipients = new Set();
  const submitterUserId =
    response?.submittedByUserId || report?.submittedByUserId || '';
  if (submitterUserId && submitterUserId !== approver.userId) {
    recipients.add(submitterUserId);
  }
  const submitterRole = response?.submittedByRole || report?.submittedByRole || '';
  if (isHigherPositionReview(approver.role, submitterRole, defs)) {
    const supervisorRoles = new Set(supervisorRolesToNotify(submitterRole, defs));
    for (const p of allProfiles || []) {
      if (p.userId === approver.userId) continue;
      if (p.approvalStatus !== 'approved') continue;
      if (!supervisorRoles.has(p.role)) continue;
      if (!hasStoreAccess(p, report.storeId)) continue;
      recipients.add(p.userId);
    }
  }
  return [...recipients];
}

export function selectReportFinalizedRecipients(report, approver, allProfiles, defs) {
  const recipients = new Set();
  if (report.submittedByUserId && report.submittedByUserId !== approver.userId) {
    recipients.add(report.submittedByUserId);
  }
  const submitterRole = report.submittedByRole || '';
  if (isHigherPositionReview(approver.role, submitterRole, defs)) {
    const supervisorRoles = new Set(supervisorRolesToNotify(submitterRole, defs));
    for (const p of allProfiles || []) {
      if (p.userId === approver.userId) continue;
      if (p.approvalStatus !== 'approved') continue;
      if (!supervisorRoles.has(p.role)) continue;
      if (!hasStoreAccess(p, report.storeId)) continue;
      recipients.add(p.userId);
    }
  }
  return [...recipients];
}

export { hasStoreAccess, profileStoreIds, canReviewReport, canReviewReportItem };
