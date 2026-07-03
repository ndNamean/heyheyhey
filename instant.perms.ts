import type { InstantRules } from '@instantdb/react';

// Common bind expressions reused across namespaces.
// auth.ref('profile.X') traverses the reverse 'profile' link on $users → profiles.
const COMMON_BIND = {
  isSignedIn: 'auth.id != null',
  isApproved: "'approved' in auth.ref('profile.approvalStatus')",
  isOwner: "'owner' in auth.ref('profile.role')",
  isAreaManager: "'areaManager' in auth.ref('profile.role')",
  isManager: "'manager' in auth.ref('profile.role')",
  isLeader: "'leader' in auth.ref('profile.role') || 'subleader' in auth.ref('profile.role')",
  canEditMaster: "isOwner || isAreaManager",
  canReview: "isApproved && (isOwner || isAreaManager || isManager || isLeader)",
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
  // New users can create their own pending profile.
  // Approved users can view all profiles.
  // Owners/areaManagers can update any profile; users can update only own displayName.
  profiles: {
    allow: {
      view: "auth.id != null && ('approved' in auth.ref('profile.approvalStatus') || data.userId == auth.id)",
      create: "auth.id != null && data.userId == auth.id && data.approvalStatus == 'pending'",
      update: "isAdmin || (isOwnProfile && onlyDisplayName)",
      delete: 'false',
    },
    bind: {
      isOwnProfile: 'auth.id != null && data.userId == auth.id',
      isApproved: "'approved' in auth.ref('profile.approvalStatus')",
      isOwner: "'owner' in auth.ref('profile.role')",
      isAreaManager: "'areaManager' in auth.ref('profile.role')",
      isAdmin: 'isOwner || isAreaManager',
      onlyDisplayName: "request.modifiedFields.all(f, f in ['displayName', 'cameraOptionsJson', 'updatedAt'])",
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
    bind: { ...COMMON_BIND },
  },

  // ── Templates ────────────────────────────────────────────────────────────
  templates: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'isOwner',
    },
    bind: { ...COMMON_BIND },
  },

  templateItems: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'canEditMaster',
    },
    bind: { ...COMMON_BIND },
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  // All approved users can read reports for their scope.
  // Any approved user can submit (create). Reviewers can update status.
  reports: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'canReview || canSubmitterUpdateReport',
      delete: 'isOwner',
    },
    bind: {
      ...COMMON_BIND,
      isReportSubmitter: 'auth.id != null && data.submittedByUserId == auth.id',
      reportOpenForCorrection:
        "data.status == 'waiting_approval' || data.status == 'need_correction' || data.status == 'rejected'",
      onlyReportResubmitFields:
        "request.modifiedFields.all(f, f in ['status', 'completionPercent', 'updatedAt'])",
      canSubmitterUpdateReport:
        'isReportSubmitter && reportOpenForCorrection && onlyReportResubmitFields',
    },
  },

  reportResponses: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'canReview || canResubmitCorrection',
      delete: 'isOwner',
    },
    bind: {
      ...COMMON_BIND,
      isResponseSubmitter: 'auth.id != null && data.submittedByUserId == auth.id',
      isCorrectable: "data.status == 'need_correction' || data.status == 'rejected'",
      onlyResubmitFields:
        "request.modifiedFields.all(f, f in ['ticked', 'numberValue', 'note', 'status', 'rejectionReason', 'feedbackCode', 'feedbackNote', 'submittedAt', 'updatedAt', 'approvedByUserId', 'approvedAt'])",
      canResubmitCorrection: 'isResponseSubmitter && isCorrectable && onlyResubmitFields',
    },
  },

  // ── Media records ─────────────────────────────────────────────────────────
  mediaRecords: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'canEditMaster',
      delete: 'canEditMaster',
    },
    bind: { ...COMMON_BIND },
  },

  // ── Watermark templates ───────────────────────────────────────────────────
  watermarkTemplates: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'isOwner',
    },
    bind: { ...COMMON_BIND },
  },

  // ── Corrective actions ────────────────────────────────────────────────────
  correctiveActions: {
    allow: {
      view: 'canReview',
      create: 'canReview',
      update: 'canReview',
      delete: 'isOwner',
    },
    bind: { ...COMMON_BIND },
  },

  // ── Report slots ─────────────────────────────────────────────────────────
  reportSlots: {
    allow: {
      view: 'isApproved',
      create: 'canEditMaster',
      update: 'canEditMaster',
      delete: 'canEditMaster',
    },
    bind: { ...COMMON_BIND },
  },

  // ── Shifts ────────────────────────────────────────────────────────────────
  shifts: {
    allow: {
      view: 'isApproved',
      create: 'isManager || canEditMaster',
      update: 'isManager || canEditMaster',
      delete: 'canEditMaster',
    },
    bind: { ...COMMON_BIND },
  },

  // ── Clock events ──────────────────────────────────────────────────────────
  clockEvents: {
    allow: {
      view: 'isApproved',
      create: 'isApproved',
      update: 'false',
      delete: 'isOwner',
    },
    bind: { ...COMMON_BIND },
  },

  // ── Logbook entries ───────────────────────────────────────────────────────
  logbookEntries: {
    allow: {
      view: 'isApproved',
      create: 'canReview',
      update: 'isAuthor || canEditMaster',
      delete: 'isOwner',
    },
    bind: {
      ...COMMON_BIND,
      isAuthor: "auth.id != null && data.authorUserId == auth.id",
    },
  },

  // ── Review feedback notifications ─────────────────────────────────────────
  notifications: {
    allow: {
      view: "isApproved && data.recipientUserId == auth.id",
      create: 'canReview',
      update: "isApproved && data.recipientUserId == auth.id && onlyReadAt",
      delete: 'false',
    },
    bind: {
      ...COMMON_BIND,
      onlyReadAt: "request.modifiedFields.all(f, f in ['readAt'])",
    },
  },
} satisfies InstantRules;

export default rules;
