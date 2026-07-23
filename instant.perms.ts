import type { InstantRules } from '@instantdb/react';

// Server-side capability checks use legacy profile.role strings so permissions
// work before every profile has a linked roleDefinition. The app UI still reads
// capabilities from roleDefinitions on the client.
// System `admin` is treated like areaManager for master-data / review / users
// (templates, stores, report review writes, profile admin actions).
const LEGACY_BIND = {
  isSignedIn: 'auth.id != null',
  isApproved: "'approved' in auth.ref('$user.profile.approvalStatus')",
  isOwner: "'owner' in auth.ref('$user.profile.role')",
  isAreaManager: "'areaManager' in auth.ref('$user.profile.role')",
  isAdminRole: "'admin' in auth.ref('$user.profile.role')",
  isAreaManagerTier: 'isAreaManager || isAdminRole',
  isManager: "'manager' in auth.ref('$user.profile.role')",
  isLeader: "'leader' in auth.ref('$user.profile.role') || 'subleader' in auth.ref('$user.profile.role')",
  isHybrid: "'hybrid' in auth.ref('$user.profile.role')",
  canEditMaster: 'isOwner || isAreaManagerTier',
  canManageUsers: 'isOwner || isAreaManagerTier',
  canReview: "isApproved && (isOwner || isAreaManagerTier || isManager || isLeader || isHybrid)",
  canPreApproveAccess: 'isManager',
  canScheduleShifts: 'isOwner || isAreaManagerTier || isManager',
  canProposeTemplateItem: 'isApproved && (isManager || isLeader)',
  canFirstApproveTemplateItemProposal: 'isApproved && (isManager || isAreaManagerTier || isOwner)',
  canFinalApproveTemplateItemProposal: 'isApproved && (isAreaManagerTier || isOwner)',
  canPublishTemplateItemProposal: 'isOwner || isAreaManagerTier',
};

const rules = {
  // ── Global default: deny everything ─────────────────────────────────────
  $default: {
    allow: {
      $default: 'false',
    },
  },

  // ── $files (Instant Storage) ─────────────────────────────────────────────
  // NOTE: auth.ref() traversals are NOT evaluated in $files permission context;
  // only auth.id is available. We use isSignedIn here; the UI already gates
  // access to approved users via AuthGate before the camera is reachable.
  // Storage file deletion is performed exclusively via the admin SDK (cleanup
  // cron job), which bypasses client permissions — so delete is 'false' here.
  $files: {
    allow: {
      view: 'isSignedIn',
      create: "isSignedIn && data.path.startsWith('stores/')",
      delete: 'false',
    },
    bind: { isSignedIn: 'auth.id != null' },
  },

  // ── Profiles ─────────────────────────────────────────────────────────────
  profiles: {
    allow: {
      // Owner profiles are only visible to the owner (or self). Everyone else is hidden from other roles.
      view:
        "auth.id != null && ('approved' in auth.ref('$user.profile.approvalStatus') || data.userId == auth.id) && (data.role != 'owner' || isOwner || data.userId == auth.id)",
      create: "auth.id != null && data.userId == auth.id && data.approvalStatus == 'pending'",
      update: 'isAdmin || managerAccessReview || (isOwnProfile && onlyDisplayName)',
      delete: 'false',
      link: {
        '$user': "auth.id != null && data.userId == auth.id",
        stores: 'isAdmin',
        roleDefinition: 'isAdmin',
      },
      unlink: {
        stores: 'isAdmin',
        roleDefinition: 'isAdmin',
      },
    },
    bind: {
      isOwnProfile: 'auth.id != null && data.userId == auth.id',
      isOwner: "'owner' in auth.ref('$user.profile.role')",
      isAreaManager: "'areaManager' in auth.ref('$user.profile.role')",
      isAdminRole: "'admin' in auth.ref('$user.profile.role')",
      isManager: "'manager' in auth.ref('$user.profile.role')",
      isAdmin: 'isOwner || isAreaManager || isAdminRole',
      onlyDisplayName: "request.modifiedFields.all(f, f in ['displayName', 'cameraOptionsJson', 'updatedAt'])",
      managerAccessReview:
        "isManager && request.modifiedFields.all(f, f in ['approvalStatus', 'accessReviewNote', 'preApprovedByUserId', 'preApprovedByEmail', 'preApprovedAt', 'updatedAt']) && (data.approvalStatus == 'pre_approved' || data.approvalStatus == 'pending')",
    },
  },

  roleDefinitions: {
    allow: {
      view: 'isApproved',
      create: 'isOwner',
      update: 'isOwner',
      delete: 'isOwner',
      link: {
        profiles: 'isAdmin',
      },
      unlink: {
        profiles: 'isAdmin',
      },
    },
    bind: {
      isApproved: "'approved' in auth.ref('$user.profile.approvalStatus')",
      isOwner: "'owner' in auth.ref('$user.profile.role')",
      isAreaManager: "'areaManager' in auth.ref('$user.profile.role')",
      isAdminRole: "'admin' in auth.ref('$user.profile.role')",
      isAdmin: 'isOwner || isAreaManager || isAdminRole',
    },
  },

  // Invitations: admin SDK only (token hashes must never be client-readable)
  invitations: {
    allow: {
      view: 'false',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },

  // ── Stores ───────────────────────────────────────────────────────────────
  stores: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'isOwner',
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Templates ────────────────────────────────────────────────────────────
  templates: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'isOwner',
      link: {
        stores: 'canEditMaster',
      },
      unlink: {
        stores: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  templateItems: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'canEditMaster',
      link: {
        template: 'canEditMaster',
      },
      unlink: {
        template: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  templateScheduleVersions: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'isOwner',
      link: {
        template: 'canEditMaster',
      },
      unlink: {
        template: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  reports: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'canReview || canSubmitterUpdateReport || canSubmitterSubmitReport',
      delete: 'isOwner',
      link: {
        store: 'isApproved',
        template: 'isApproved',
        submitter: 'isApproved',
      },
      unlink: {
        store: 'isOwner',
        template: 'isOwner',
        submitter: 'isOwner',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isReportSubmitter: 'auth.id != null && data.submittedByUserId == auth.id',
      reportOpenForCorrection:
        "data.status == 'waiting_approval' || data.status == 'need_correction' || data.status == 'rejected'",
      onlyReportResubmitFields:
        "request.modifiedFields.all(f, f in ['status', 'completionPercent', 'updatedAt'])",
      onlyReportSubmitFields:
        "request.modifiedFields.all(f, f in ['storeId', 'storeCode', 'storeName', 'templateId', 'templateName', 'reportType', 'reportDate', 'submittedByUserId', 'submittedByRole', 'submittedAt', 'status', 'completionPercent', 'compliancePercent', 'archived', 'archiveMonth', 'createdAt', 'updatedAt'])",
      canSubmitterUpdateReport:
        'isReportSubmitter && reportOpenForCorrection && onlyReportResubmitFields',
      canSubmitterSubmitReport: 'isApproved && onlyReportSubmitFields',
    },
  },

  reportResponses: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'canReview || canResubmitCorrection || canSubmitterSubmitResponse',
      delete: 'isOwner',
      link: {
        report: 'isApproved',
        templateItem: 'isApproved',
      },
      unlink: {
        report: 'isOwner',
        templateItem: 'isOwner',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isResponseSubmitter: 'auth.id != null && data.submittedByUserId == auth.id',
      isCorrectable: "data.status == 'need_correction' || data.status == 'rejected'",
      onlyResubmitFields:
        "request.modifiedFields.all(f, f in ['ticked', 'numberValue', 'note', 'status', 'rejectionReason', 'feedbackCode', 'feedbackNote', 'submittedAt', 'updatedAt', 'approvedByUserId', 'approvedAt'])",
      onlyResponseSubmitFields:
        "request.modifiedFields.all(f, f in ['reportId', 'templateItemId', 'section', 'title', 'proofType', 'required', 'assignedRole', 'approverRolesJson', 'weight', 'failureCategory', 'ticked', 'numberValue', 'note', 'status', 'rejectionReason', 'feedbackCode', 'feedbackNote', 'submittedByUserId', 'submittedByRole', 'submittedAt', 'approvedByUserId', 'approvedAt', 'updatedAt', 'scheduleOccurrenceKey', 'scheduledDueAt', 'firstCompletedAt', 'scheduleVersionId'])",
      canResubmitCorrection: 'isResponseSubmitter && isCorrectable && onlyResubmitFields',
      canSubmitterSubmitResponse: 'isApproved && onlyResponseSubmitFields',
    },
  },

  // ── Media records ─────────────────────────────────────────────────────────
  mediaRecords: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'canEditMaster',
      delete: 'canEditMaster',
      link: {
        file: 'isApproved',
        reportResponse: 'isApproved',
      },
      unlink: {
        file: 'canEditMaster',
        reportResponse: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Watermark templates ───────────────────────────────────────────────────
  watermarkTemplates: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'isOwner',
      link: {
        stores: 'canEditMaster',
        logo: 'canEditMaster',
      },
      unlink: {
        stores: 'canEditMaster',
        logo: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Corrective actions ────────────────────────────────────────────────────
  correctiveActions: {
    allow: {
      view: 'canReview',
      create: 'canReview',
      update: 'canReview',
      delete: 'isOwner',
      link: {
        report: 'canReview',
        evidencePhoto: 'canReview',
      },
      unlink: {
        report: 'isOwner',
        evidencePhoto: 'isOwner',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Report slots ─────────────────────────────────────────────────────────
  reportSlots: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'canEditMaster',
      link: {
        template: 'canEditMaster',
        store: 'canEditMaster',
      },
      unlink: {
        template: 'canEditMaster',
        store: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Shifts ────────────────────────────────────────────────────────────────
  shifts: {
    allow: {
      view: 'isApproved',
      create: 'canScheduleShifts',
      update: 'canScheduleShifts',
      delete: 'canEditMaster',
      link: {
        store: 'canScheduleShifts',
        employee: 'canScheduleShifts',
      },
      unlink: {
        store: 'canEditMaster',
        employee: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Clock events ──────────────────────────────────────────────────────────
  clockEvents: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'false',
      delete: 'isOwner',
      link: {
        shift: 'isApproved',
        photo: 'isApproved',
      },
      unlink: {
        shift: 'isOwner',
        photo: 'isOwner',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Logbook entries ───────────────────────────────────────────────────────
  // Staff/assignees may only touch lifecycle fields + resolution/source media links.
  // Resolution-submitted inbox rows are created via Admin SDK (api/logbook-notify).
  logbookEntries: {
    allow: {
      view: 'isApproved',
      create: 'canReview',
      update:
        'isAuthor || canEditMaster || canAckUpdate || canIssueLifecycleUpdate || canIssueReviewUpdate || canDueStampUpdate',
      delete: 'isOwner',
      link: {
        store: 'isApproved',
        photo: 'isApproved',
        resolutionMedia: 'isApproved',
        resolutionProofHistory: 'isApproved',
        sourceMedia: 'isApproved',
      },
      unlink: {
        store: 'isOwner',
        // Resubmit replaces proof — assignees/reviewers must unlink prior photo
        photo: 'isApproved',
        resolutionMedia: 'isApproved',
        // Prefer no unlink of history in product logic; rule is for safety only
        resolutionProofHistory: 'isApproved',
        sourceMedia: 'isApproved',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isAuthor: "auth.id != null && data.authorUserId == auth.id",
      onlyAckFields: "request.modifiedFields.all(f, f in ['ackUserIdsJson', 'updatedAt'])",
      canAckUpdate: 'isApproved && onlyAckFields',
      onlyIssueLifecycleFields:
        "request.modifiedFields.all(f, f in ['status', 'startedAt', 'startedByUserId', 'resolutionNote', 'resolutionNumber', 'resolutionChecked', 'resolutionSubmittedAt', 'resolutionSubmittedByUserId', 'resolutionAttemptId', 'updatedAt'])",
      canIssueLifecycleUpdate: 'isApproved && onlyIssueLifecycleFields',
      onlyIssueReviewFields:
        "request.modifiedFields.all(f, f in ['status', 'resolvedAt', 'resolvedByUserId', 'reviewedAt', 'reviewedByUserId', 'reviewNote', 'reopenedAt', 'reopenedByUserId', 'reopenReason', 'recalledAt', 'recalledByUserId', 'recallReason', 'updatedAt', 'assigneeRole', 'dueAt', 'severity', 'resolutionRequirement', 'resolutionProofType'])",
      canIssueReviewUpdate: 'canReview && onlyIssueReviewFields',
      onlyDueStampFields:
        "request.modifiedFields.all(f, f in ['dueSoonNotifiedAt', 'overdueNotifiedAt', 'updatedAt'])",
      canDueStampUpdate: 'isApproved && onlyDueStampFields',
    },
  },

  // ── Review audit trail ────────────────────────────────────────────────────
  reviewEvents: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'false',
      delete: 'false',
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Export jobs (server-managed via Admin SDK) ─────────────────────────────
  exportJobs: {
    allow: {
      view: "isApproved && data.requesterUserId == auth.id",
      create: 'false',
      update: 'false',
      delete: 'false',
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Export audit logs (server-managed via Admin SDK) ───────────────────────
  exportAuditLogs: {
    allow: {
      view: "isApproved && data.userId == auth.id",
      create: 'false',
      update: 'false',
      delete: 'false',
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Review feedback notifications ─────────────────────────────────────────
  // Client create remains for assignment/due (canReview / approved). Resolution
  // submitted notifications use Admin SDK (api/logbook-notify) so Staff submit
  // Stage A never depends on notifications.create.
  notifications: {
    allow: {
      view: "isApproved && data.recipientUserId == auth.id",
      create: 'isApproved',
      update: "isApproved && data.recipientUserId == auth.id && onlyReadAt",
      delete: 'false',
    },
    bind: {
      ...LEGACY_BIND,
      onlyReadAt: "request.modifiedFields.all(f, f in ['readAt'])",
    },
  },

  // ── Checklist item proposals ──────────────────────────────────────────────
  checklistItemProposals: {
    allow: {
      view: 'isApproved',
      create:
        "canProposeTemplateItem && data.requestedByUserId == auth.id && (data.status == 'draft' || data.status == 'pending_first_approval')",
      update: 'canUpdateOwnProposal || canApproveProposal || canPublishProposal || canAssignApprovers',
      delete: 'false',
      link: {
        template: 'canProposeTemplateItem',
        requester: 'canProposeTemplateItem',
        sourceStore: 'canProposeTemplateItem',
        sourceReport: 'canProposeTemplateItem',
      },
      unlink: {
        // Owner may unlink when permanently deleting a template; proposal keeps templateId snapshot.
        template: 'isOwner',
        requester: 'false',
        sourceStore: 'false',
        sourceReport: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isRequester: 'auth.id != null && data.requestedByUserId == auth.id',
      canUpdateOwnProposal:
        "isRequester && (data.status == 'draft' || data.status == 'changes_requested' || data.status == 'pending_first_approval' || data.status == 'cancelled')",
      canApproveProposal:
        'canFirstApproveTemplateItemProposal || canFinalApproveTemplateItemProposal',
      canPublishProposal: 'canPublishTemplateItemProposal',
      canAssignApprovers: 'isOwner || isAdminRole',
    },
  },

  checklistItemProposalComments: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'false',
      delete: 'false',
      link: {
        proposal: 'isApproved',
      },
      unlink: {
        proposal: 'false',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  checklistItemProposalEvents: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'false',
      delete: 'false',
      link: {
        proposal: 'isApproved',
      },
      unlink: {
        proposal: 'false',
      },
    },
    bind: { ...LEGACY_BIND },
  },
} satisfies InstantRules;

export default rules;
