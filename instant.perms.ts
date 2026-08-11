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
  // Leader only (not subleader); managers request user changes too.
  canRequestUserChanges:
    "isApproved && (isManager || 'leader' in auth.ref('$user.profile.role'))",
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
      // Managers may only pre-approve / flag — never final-approve or assign stores.
      onlyManagerReviewFields:
        "request.modifiedFields.all(f, f in ['approvalStatus', 'accessReviewNote', 'preApprovedByUserId', 'preApprovedByEmail', 'preApprovedAt', 'updatedAt'])",
      managerReviewFromStatus:
        "data.approvalStatus == 'manager_review' || data.approvalStatus == 'needs_manager_recheck' || data.approvalStatus == 'pending'",
      managerReviewToStatus:
        "!('approvalStatus' in request.modifiedFields) || newData.approvalStatus == 'pre_approved' || newData.approvalStatus == 'pending'",
      managerAccessReview:
        'isManager && onlyManagerReviewFields && managerReviewFromStatus && managerReviewToStatus',
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
      update: 'canReviewReportStore || canSubmitterUpdateReport || canSubmitterSubmitReport',
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
      hasAllStoreAccess: 'isOwner || isAreaManagerTier',
      canReviewReportStore:
        "canReview && (hasAllStoreAccess || data.storeId in auth.ref('$user.profile.stores.id'))",
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
      update: 'canReviewReportStore || canResubmitCorrection || canSubmitterSubmitResponse',
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
      hasAllStoreAccess: 'isOwner || isAreaManagerTier',
      // Empty storeId = legacy row; client still gates by report.storeId until backfill.
      canReviewReportStore:
        "canReview && (hasAllStoreAccess || data.storeId == null || data.storeId == '' || data.storeId in auth.ref('$user.profile.stores.id'))",
      isResponseSubmitter: 'auth.id != null && data.submittedByUserId == auth.id',
      isCorrectable: "data.status == 'need_correction' || data.status == 'rejected'",
      onlyResubmitFields:
        "request.modifiedFields.all(f, f in ['ticked', 'numberValue', 'note', 'status', 'rejectionReason', 'feedbackCode', 'feedbackNote', 'submittedAt', 'updatedAt', 'approvedByUserId', 'approvedAt', 'storeId'])",
      onlyResponseSubmitFields:
        "request.modifiedFields.all(f, f in ['reportId', 'templateItemId', 'section', 'title', 'proofType', 'required', 'assignedRole', 'assignedRolesJson', 'approverRolesJson', 'weight', 'failureCategory', 'ticked', 'numberValue', 'note', 'status', 'rejectionReason', 'feedbackCode', 'feedbackNote', 'submittedByUserId', 'submittedByRole', 'submittedAt', 'approvedByUserId', 'approvedAt', 'updatedAt', 'storeId', 'scheduleOccurrenceKey', 'scheduledDueAt', 'firstCompletedAt', 'scheduleVersionId'])",
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
        "request.modifiedFields.all(f, f in ['status', 'resolvedAt', 'resolvedByUserId', 'reviewedAt', 'reviewedByUserId', 'reviewNote', 'reopenedAt', 'reopenedByUserId', 'reopenReason', 'recalledAt', 'recalledByUserId', 'recallReason', 'updatedAt', 'assigneeRole', 'assigneeUserIdsJson', 'dueAt', 'severity', 'resolutionRequirement', 'resolutionProofType'])",
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
      // Non-reviewers (e.g. staff submitters) may create; reviewers must have store access.
      create: '(canReview && canReviewReportStore) || (isApproved && !canReview)',
      update: 'false',
      delete: 'false',
    },
    bind: {
      ...LEGACY_BIND,
      hasAllStoreAccess: 'isOwner || isAreaManagerTier',
      canReviewReportStore:
        "canReview && (hasAllStoreAccess || data.storeId in auth.ref('$user.profile.stores.id'))",
    },
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
  // Logbook_* inbox rows (except due-soon) are Admin SDK via /api/logbook-notify.
  // Client create remains for reports/access + logbook_issue_due_soon.
  notifications: {
    allow: {
      view: "isApproved && data.recipientUserId == auth.id",
      create:
        "isApproved && (!data.type.startsWith('logbook_') || data.type == 'logbook_issue_due_soon')",
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

  // ── Store Wi-Fi public IPs (master-data only; hide from ordinary staff) ───
  storeWifiIps: {
    allow: {
      view: 'canEditMaster',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'canEditMaster',
      link: {
        store: 'canEditMaster',
      },
      unlink: {
        store: 'canEditMaster',
      },
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Web Push subscriptions (own device only) ──────────────────────────────
  pushSubscriptions: {
    allow: {
      view: 'isApproved && data.userId == auth.id',
      create: 'isApproved && data.userId == auth.id',
      update: 'isApproved && data.userId == auth.id',
      delete: 'false',
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Notification activation sessions (Admin SDK writes only) ──────────────
  notificationActivationSessions: {
    allow: {
      view: 'isApproved && data.userId == auth.id',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
    bind: { ...LEGACY_BIND },
  },

  // ── Push delivery logs (Admin SDK only; no client access) ─────────────────
  pushDeliveryLogs: {
    allow: {
      view: 'false',
      create: 'false',
      update: 'false',
      delete: 'false',
    },
  },

  // ── Store Chat messages (store-scoped; Viewer read-only) ──────────────────
  // Membership: data.storeId in auth.ref('$user.profile.stores.id').
  // Verify this traversal after push; fall back if Instant rejects the path.
  storeChatMessages: {
    allow: {
      view: 'canAccessMessageStore',
      create:
        "canSendStoreChat && data.senderUserId == auth.id && isOwnSenderProfile && storeIdValid && data.status == 'active' && messageTypeValid && bodySizeValid && mediaCoherent && data.messageType != 'logbook_system' && data.messageType != 'report_system'",
      update: 'isOwnMessage && onlyDeletedFields && softDeleteValid',
      delete: 'false',
      link: {
        store: 'canSendStoreChat',
        sender: 'canSendStoreChat && isOwnSenderProfile',
      },
      unlink: {
        store: 'false',
        sender: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      hasAllStoreChatAccess: 'isOwner || isAreaManagerTier',
      storeIdValid: "data.storeId != ''",
      canAccessMessageStore:
        "isApproved && storeIdValid && (hasAllStoreChatAccess || data.storeId in auth.ref('$user.profile.stores.id'))",
      isViewer: "'viewer' in auth.ref('$user.profile.role')",
      canSendStoreChat: 'canAccessMessageStore && !isViewer',
      isOwnMessage: 'auth.id != null && data.senderUserId == auth.id',
      // Denormalized profile id must match the signed-in profile (not another user).
      isOwnSenderProfile: "data.senderProfileId in auth.ref('$user.profile.id')",
      onlyDeletedFields:
        "request.modifiedFields.all(f, f in ['deletedAt', 'status'])",
      softDeleteValid: "newData.status == 'deleted' && newData.deletedAt != ''",
      messageTypeValid:
        "data.messageType == 'text' || data.messageType == 'giphy_media' || data.messageType == 'text_giphy' || data.messageType == 'logbook_system' || data.messageType == 'report_system'",
      bodySizeValid: 'size(data.body) <= 2000',
      // text / logbook_system / report_system / text_giphy need body; giphy_media may be body-empty; giphy types need media ids.
      mediaCoherent:
        "((data.messageType == 'text' || data.messageType == 'logbook_system' || data.messageType == 'report_system') && size(data.body) > 0 && data.giphyId == '') || (data.messageType == 'giphy_media' && data.giphyId != '' && data.giphyUrl != '') || (data.messageType == 'text_giphy' && size(data.body) > 0 && data.giphyId != '' && data.giphyUrl != '')",
    },
  },

  // ── Store Chat reactions (store-scoped; actor-owned create/delete) ────────
  storeChatReactions: {
    allow: {
      view: 'canAccessReactionStore',
      create:
        "canAccessReactionStore && isOwnReaction && storeIdValid && messageIdValid && (unicodeReactionValid || giphyReactionValid)",
      update: 'false',
      delete: 'canAccessReactionStore && isOwnReaction',
      link: {
        store: 'canAccessReactionStore && isOwnReaction',
        message: 'canAccessReactionStore && isOwnReaction',
      },
      unlink: {
        store: 'false',
        message: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      hasAllStoreChatAccess: 'isOwner || isAreaManagerTier',
      storeIdValid: "data.storeId != ''",
      messageIdValid: "data.messageId != ''",
      canAccessReactionStore:
        "isApproved && storeIdValid && (hasAllStoreChatAccess || data.storeId in auth.ref('$user.profile.stores.id'))",
      isOwnReaction: 'auth.id != null && data.userId == auth.id',
      unicodeReactionValid:
        "data.reactionType == 'unicode' && data.unicode != '' && data.giphyId == ''",
      giphyReactionValid:
        "data.reactionType == 'giphy' && data.giphyId != '' && data.unicode == '' && data.giphyUrl != ''",
    },
  },

  // ── Store Chat bookmarks (store-scoped; actor-owned create/delete) ────────
  storeChatBookmarks: {
    allow: {
      view: 'canAccessBookmarkStore',
      create:
        'canAccessBookmarkStore && isOwnBookmark && storeIdValid && messageIdValid',
      update: 'false',
      delete: 'canAccessBookmarkStore && isOwnBookmark',
      link: {
        store: 'canAccessBookmarkStore && isOwnBookmark',
        message: 'canAccessBookmarkStore && isOwnBookmark',
      },
      unlink: {
        store: 'false',
        message: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      hasAllStoreChatAccess: 'isOwner || isAreaManagerTier',
      storeIdValid: "data.storeId != ''",
      messageIdValid: "data.messageId != ''",
      canAccessBookmarkStore:
        "isApproved && storeIdValid && (hasAllStoreChatAccess || data.storeId in auth.ref('$user.profile.stores.id'))",
      isOwnBookmark: 'auth.id != null && data.userId == auth.id',
    },
  },

  // ── Custom Group Chat rooms (Admin SDK lifecycle; members view) ───────────
  // Elevated Store Chat roles MUST NOT appear here — private groups only.
  // Membership bind uses linked room id (Store-parallel: profile.stores.id),
  // not the denormalized roomId attribute on the member row.
  groupChatRooms: {
    allow: {
      view: 'isActiveMember',
      create: 'false',
      update: 'isActiveMember && onlyRoomActivityFields',
      delete: 'false',
      link: {
        members: 'false',
        invites: 'false',
        // Reverse link half: Instant evaluates these in an empty bind container, so
        // named binds like isActiveMember fail with "undeclared reference". Gate
        // membership on the child entity forward links (messages/reactions/bookmarks
        // .link.room) — same pattern as Store Chat (stores has no reverse chat links).
        messages: 'true',
        reactions: 'true',
        bookmarks: 'true',
      },
      unlink: {
        members: 'false',
        invites: 'false',
        messages: 'false',
        reactions: 'false',
        bookmarks: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isActiveMember:
        "isApproved && data.id in auth.ref('$user.profile.groupChatMemberships.room.id')",
      onlyRoomActivityFields:
        "request.modifiedFields.all(f, f in ['lastMessageAt', 'updatedAt'])",
    },
  },

  // ── Custom Group Chat members (Admin create; own lastReadAt/mute updates) ─
  groupChatMembers: {
    allow: {
      view: 'isActiveMemberOfRoom',
      create: 'false',
      update: 'isOwnMembership && onlySelfMemberFields',
      delete: 'false',
      link: {
        room: 'false',
        profile: 'false',
      },
      unlink: {
        room: 'false',
        profile: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isActiveMemberOfRoom:
        "isApproved && data.roomId in auth.ref('$user.profile.groupChatMemberships.room.id')",
      isOwnMembership: 'auth.id != null && data.userId == auth.id',
      onlySelfMemberFields:
        "request.modifiedFields.all(f, f in ['lastReadAt', 'notificationMode', 'muted', 'pinned'])",
    },
  },

  // ── Custom Group Chat invites (invitee or room member view; accept/decline via Admin) ─────
  groupChatInvites: {
    allow: {
      view: 'isInvitee || isRoomMemberOfInviteRoom',
      create: 'false',
      update: 'false',
      delete: 'false',
      link: {
        room: 'false',
        invitee: 'false',
        inviter: 'false',
      },
      unlink: {
        room: 'false',
        invitee: 'false',
        inviter: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isInvitee: 'isApproved && auth.id != null && data.inviteeUserId == auth.id',
      isRoomMemberOfInviteRoom:
        "isApproved && data.roomId in auth.ref('$user.profile.groupChatMemberships.room.id')",
    },
  },

  // ── Custom Group Chat messages (membership-only; no elevated Store Chat) ──
  groupChatMessages: {
    allow: {
      view: 'canViewGroupMessage',
      create:
        "canSendGroupMessage && data.senderUserId == auth.id && isOwnSenderProfile && roomIdValid && data.status == 'active' && messageTypeValid && bodySizeValid && mediaCoherent && data.messageType != 'logbook_system'",
      update: 'isOwnMessage && onlyDeletedFields && softDeleteValid',
      delete: 'false',
      link: {
        room: 'canSendGroupMessage',
        sender: 'canSendGroupMessage && isOwnSenderProfile',
      },
      unlink: {
        room: 'false',
        sender: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      roomIdValid: "data.roomId != ''",
      // Explicit: no hasAllStoreChatAccess — Owner/Admin/AM cannot auto-read private groups.
      // Bind via membership→room link id (Store-parallel), keep data.roomId for comparisons.
      isRoomMember:
        "data.roomId in auth.ref('$user.profile.groupChatMemberships.room.id')",
      canViewGroupMessage: 'isApproved && roomIdValid && isRoomMember',
      isViewer: "'viewer' in auth.ref('$user.profile.role')",
      canSendGroupMessage: 'canViewGroupMessage && !isViewer',
      isOwnMessage: 'auth.id != null && data.senderUserId == auth.id',
      isOwnSenderProfile: "data.senderProfileId in auth.ref('$user.profile.id')",
      onlyDeletedFields:
        "request.modifiedFields.all(f, f in ['deletedAt', 'status'])",
      softDeleteValid: "newData.status == 'deleted' && newData.deletedAt != ''",
      messageTypeValid:
        "data.messageType == 'text' || data.messageType == 'giphy_media' || data.messageType == 'text_giphy' || data.messageType == 'system'",
      bodySizeValid: 'size(data.body) <= 2000',
      mediaCoherent:
        "((data.messageType == 'text' || data.messageType == 'system') && size(data.body) > 0 && data.giphyId == '') || (data.messageType == 'giphy_media' && data.giphyId != '' && data.giphyUrl != '') || (data.messageType == 'text_giphy' && size(data.body) > 0 && data.giphyId != '' && data.giphyUrl != '')",
    },
  },

  // ── Custom Group Chat reactions (membership-only; no elevated Store Chat) ─
  groupChatReactions: {
    allow: {
      view: 'canAccessReactionRoom',
      create:
        "canAccessReactionRoom && isOwnReaction && roomIdValid && messageIdValid && (unicodeReactionValid || giphyReactionValid)",
      update: 'false',
      delete: 'canAccessReactionRoom && isOwnReaction',
      link: {
        room: 'canAccessReactionRoom && isOwnReaction',
        message: 'canAccessReactionRoom && isOwnReaction',
      },
      unlink: {
        room: 'false',
        message: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      roomIdValid: "data.roomId != ''",
      messageIdValid: "data.messageId != ''",
      canAccessReactionRoom:
        "isApproved && roomIdValid && data.roomId in auth.ref('$user.profile.groupChatMemberships.room.id')",
      isOwnReaction: 'auth.id != null && data.userId == auth.id',
      unicodeReactionValid:
        "data.reactionType == 'unicode' && data.unicode != '' && data.giphyId == ''",
      giphyReactionValid:
        "data.reactionType == 'giphy' && data.giphyId != '' && data.unicode == '' && data.giphyUrl != ''",
    },
  },

  // ── Custom Group Chat bookmarks (membership-only; actor-owned) ────────────
  groupChatBookmarks: {
    allow: {
      view: 'canAccessBookmarkRoom',
      create:
        'canAccessBookmarkRoom && isOwnBookmark && roomIdValid && messageIdValid',
      update: 'false',
      delete: 'canAccessBookmarkRoom && isOwnBookmark',
      link: {
        room: 'canAccessBookmarkRoom && isOwnBookmark',
        message: 'canAccessBookmarkRoom && isOwnBookmark',
      },
      unlink: {
        room: 'false',
        message: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      roomIdValid: "data.roomId != ''",
      messageIdValid: "data.messageId != ''",
      canAccessBookmarkRoom:
        "isApproved && roomIdValid && data.roomId in auth.ref('$user.profile.groupChatMemberships.room.id')",
      isOwnBookmark: 'auth.id != null && data.userId == auth.id',
    },
  },

  // ── User change requests ──────────────────────────────────────────────────
  userChangeRequests: {
    allow: {
      view: 'isApproved',
      create:
        "canRequestUserChanges && data.requestedByUserId == auth.id && (data.status == 'pending_first_approval' || data.status == 'pending_final_approval')",
      update: 'canUpdateOwnRequest || canFirstApproveUserChange || canFinalApproveUserChange',
      delete: 'false',
      link: {
        requester: 'canRequestUserChanges',
        target: 'canRequestUserChanges',
      },
      unlink: {
        requester: 'false',
        target: 'false',
      },
    },
    bind: {
      ...LEGACY_BIND,
      isRequester: 'auth.id != null && data.requestedByUserId == auth.id',
      canUpdateOwnRequest:
        "isRequester && (data.status == 'pending_first_approval' || data.status == 'pending_final_approval' || data.status == 'cancelled')",
      canFirstApproveUserChange:
        "isApproved && isManager && data.status == 'pending_first_approval'",
      canFinalApproveUserChange:
        "canManageUsers && (data.status == 'pending_first_approval' || data.status == 'pending_final_approval' || data.status == 'approved' || data.status == 'rejected')",
    },
  },
} satisfies InstantRules;

export default rules;
