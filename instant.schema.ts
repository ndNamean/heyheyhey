import { i } from '@instantdb/react';

const _schema = i.schema({
  entities: {
    // Built-in auth entity — created automatically on Google sign-in
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),

    // Built-in file storage entity
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),

    // ─── User profiles & approval ───────────────────────────────────────────
    profiles: i.entity({
      userId: i.string().unique().indexed(), // mirrors auth $users id
      email: i.string().indexed(),
      displayName: i.string(),
      role: i.string(),                      // owner|areaManager|manager|leader|subleader|staff|viewer
      approvalStatus: i.string(),            // pending|manager_review|pre_approved|needs_manager_recheck|approved|rejected
      approvedAt: i.string(),
      approvedByEmail: i.string(),
      accessReviewStoreIdsJson: i.string(),  // JSON: string[] store IDs for manager pre-approval
      accessReviewNote: i.string(),
      preApprovedByUserId: i.string(),
      preApprovedByEmail: i.string(),
      preApprovedAt: i.string(),
      accessReviewRequestedByEmail: i.string(),
      accessReviewRequestedAt: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
      cameraOptionsJson: i.string(),       // JSON: { weatherEnabled, logoEnabled, flashlightLastUsed }
    }),
    stores: i.entity({
      code: i.string().unique(),
      name: i.string(),
      address: i.string(),
      area: i.string(),
      lat: i.number(),
      lng: i.number(),
      geofenceRadiusM: i.number(),
      active: i.boolean(),
      createdAt: i.string(),
      updatedAt: i.string(),
      proofLogoUrl: i.string(),            // '' = use app default logo
    }),
    templates: i.entity({
      name: i.string(),
      reportType: i.string(),
      scheduleJson: i.string(),             // JSON: TemplateSchedule v2 (or legacy { enabled, recurrence, days, dueTime, assignedRole })
      active: i.boolean(),
      createdByUserId: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // Additive schedule history — templates.scheduleJson remains the active config
    templateScheduleVersions: i.entity({
      templateId: i.string().indexed(),
      scheduleJson: i.string(),
      effectiveFrom: i.string().indexed(),
      effectiveTo: i.string(),             // '' = currently active version
      createdAt: i.string(),
      createdByUserId: i.string(),
    }),

    templateItems: i.entity({
      section: i.string(),
      title: i.string(),
      requirement: i.string(),
      proofType: i.string(),               // tick|photo|video|number|note|photo_note|photo_number|video_note
      required: i.boolean(),
      assignedRole: i.string(),
      approverRolesJson: i.string(),       // JSON array of role strings
      weight: i.number(),
      failureCategory: i.string(),
      sortOrder: i.number(),
    }),

    // ─── Reports ─────────────────────────────────────────────────────────────
    reports: i.entity({
      storeId: i.string().indexed(),       // denormalised for permission checks
      storeCode: i.string(),
      storeName: i.string(),
      templateId: i.string().indexed(),
      templateName: i.string(),
      reportType: i.string(),
      reportDate: i.string().indexed(),
      submittedByUserId: i.string().indexed(),
      submittedByRole: i.string(),
      submittedAt: i.string(),
      status: i.string(),                  // waiting_approval|approved|rejected|need_correction
      completionPercent: i.number(),
      compliancePercent: i.number(),
      archived: i.boolean(),
      archiveMonth: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    reportResponses: i.entity({
      reportId: i.string().indexed(),
      templateItemId: i.string().indexed(),
      section: i.string(),
      title: i.string(),
      proofType: i.string(),
      required: i.boolean(),
      assignedRole: i.string(),
      approverRolesJson: i.string(),
      weight: i.number(),
      failureCategory: i.string(),
      ticked: i.boolean(),
      numberValue: i.string(),
      note: i.string(),
      status: i.string(),                  // not_started|waiting_approval|approved|rejected|need_correction
      rejectionReason: i.string(),
      feedbackCode: i.string().indexed(),  // preset code or 'other'
      feedbackNote: i.string(),            // free text for 'other' or optional extra note
      submittedByUserId: i.string(),
      submittedByRole: i.string(),
      submittedAt: i.string(),
      approvedByUserId: i.string(),
      approvedAt: i.string(),
      updatedAt: i.string(),
      // Additive schedule capture (Phase 2) — blank when unscheduled / not applicable
      scheduleOccurrenceKey: i.string().indexed(),
      scheduledDueAt: i.string(),
      firstCompletedAt: i.string(),
      scheduleVersionId: i.string(),
    }),

    // ─── Media / photo records ───────────────────────────────────────────────
    mediaRecords: i.entity({
      reportId: i.string().indexed(),
      reportResponseId: i.string().indexed(),
      storeId: i.string().indexed(),
      fileName: i.string(),
      mimeType: i.string(),
      lat: i.number(),
      lng: i.number(),
      accuracy: i.number(),
      capturedAt: i.string(),
      watermarked: i.boolean(),
      photoCode: i.string().indexed(),     // HP-XX-YYYYMMDD-XXXX
      verificationHash: i.string(),
      captureMode: i.string(),             // live_camera|file_fallback
      storeDistanceM: i.number(),
      noteText: i.string(),
      address: i.string(),
      uploadedByUserId: i.string(),
      createdAt: i.string(),
      // ── Storage cleanup fields ───────────────────────────────────────────
      storagePath: i.string(),             // InstantDB $files path; used by cleanup job
      fileUrl: i.string(),                 // denormalised CDN url for review UI
      deletedAt: i.string(),               // '' while active; ISO date when storage file deleted
      storageDeleted: i.boolean(),         // true after cleanup job removes the file
      storageDeletedReason: i.string(),    // e.g. 'auto_cleanup_after_7_days_reviewed'
      proofMetadataJson: i.string(),       // JSON: proofTimestamp, proofTimezone, proofLocation, proofWeather, proofLogoUrl, cameraOptionsSnapshot
    }),

    // ─── Watermark templates ─────────────────────────────────────────────────
    watermarkTemplates: i.entity({
      name: i.string(),
      fieldsJson: i.string(),             // JSON boolean toggles for each watermark field
      layout: i.string(),                 // bottom-band|corner
      isDefault: i.boolean(),
      createdByUserId: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // ─── Corrective actions (Phase 2A) ───────────────────────────────────────
    correctiveActions: i.entity({
      reportId: i.string().indexed(),
      itemId: i.string(),
      title: i.string(),
      storeId: i.string().indexed(),
      severity: i.string(),               // critical|major|minor
      assignedRole: i.string(),
      assignedByUserId: i.string(),
      dueAt: i.string(),
      status: i.string(),                 // open|in_progress|verified|overdue
      evidenceNote: i.string(),
      closedByUserId: i.string(),
      closedAt: i.string(),
      escalationLevel: i.number(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // ─── Scheduled report slots (Phase 2B) ───────────────────────────────────
    reportSlots: i.entity({
      templateId: i.string().indexed(),
      templateName: i.string(),
      storeId: i.string().indexed(),
      scheduledDate: i.string().indexed(),
      dueTime: i.string(),
      assignedRole: i.string(),
      status: i.string(),                 // pending|submitted|missed
      reportId: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // ─── Shifts (Phase 2C) ───────────────────────────────────────────────────
    shifts: i.entity({
      storeId: i.string().indexed(),
      employeeUserId: i.string().indexed(),
      role: i.string(),
      date: i.string().indexed(),
      startTime: i.string(),
      endTime: i.string(),
      hourlyRate: i.number(),
      status: i.string(),                 // scheduled|swap_requested
      swapRequestedByUserId: i.string(),
      swapApprovedByUserId: i.string(),
      notes: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // ─── Clock events (Phase 2C) ─────────────────────────────────────────────
    clockEvents: i.entity({
      shiftId: i.string().indexed(),
      employeeUserId: i.string().indexed(),
      storeId: i.string().indexed(),
      type: i.string(),                   // clockIn|clockOut
      lat: i.number(),
      lng: i.number(),
      accuracy: i.number(),
      photoCode: i.string(),
      timestamp: i.string(),
      gpsValid: i.boolean(),
      createdAt: i.string(),
    }),

    // ─── Logbook entries (Phase 2D) ──────────────────────────────────────────
    logbookEntries: i.entity({
      storeId: i.string().indexed(),
      authorUserId: i.string().indexed(),
      date: i.string().indexed(),
      shift: i.string(),                  // AM|PM|Night|All day
      content: i.string(),
      severity: i.string(),               // info|warning|critical
      isAnnouncement: i.boolean(),
      requiresAck: i.boolean(),
      ackUserIdsJson: i.string(),         // JSON array of user IDs who acknowledged
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // ─── Review audit trail ──────────────────────────────────────────────────
    reviewEvents: i.entity({
      reportId: i.string().indexed(),
      reportResponseId: i.string().indexed(), // '' for report-level events
      storeId: i.string().indexed(),
      eventType: i.string().indexed(),
      // submitted|resubmitted|item_approved|item_rejected|item_correction|report_finalized
      itemTitle: i.string(),
      templateItemId: i.string().indexed(),
      sectionSnapshot: i.string(),
      categorySnapshot: i.string(),
      statusAfter: i.string(),
      previousStatus: i.string(),
      actorUserId: i.string(),
      actorRole: i.string(),
      actorDisplayNameSnapshot: i.string(),
      note: i.string(),
      feedbackCode: i.string(),
      feedbackNote: i.string(),
      createdAt: i.string().indexed(),
    }),

    // ─── Export jobs (async CSV/PDF generation) ─────────────────────────────
    exportJobs: i.entity({
      requesterUserId: i.string().indexed(),
      exportType: i.string(),              // dashboard|review_status
      format: i.string(),                  // csv|pdf
      status: i.string().indexed(),        // pending|processing|completed|failed
      paramsJson: i.string(),
      rowCount: i.number(),
      truncated: i.boolean(),
      warningHeader: i.string(),
      filePath: i.string(),
      downloadUrl: i.string(),
      errorMessage: i.string(),
      startedAt: i.string(),
      completedAt: i.string(),
      createdAt: i.string(),
    }),

    // ─── Export audit trail ──────────────────────────────────────────────────
    exportAuditLogs: i.entity({
      userId: i.string().indexed(),
      role: i.string(),
      exportType: i.string(),
      format: i.string(),
      dateRangeJson: i.string(),
      storeScopeJson: i.string(),
      paramsJson: i.string(),
      rowCount: i.number(),
      truncated: i.boolean(),
      jobId: i.string().indexed(),
      status: i.string(),                  // requested|completed|failed|downloaded
      downloadAt: i.string(),
      createdAt: i.string(),
    }),

    // ─── Review feedback notifications ───────────────────────────────────────
    notifications: i.entity({
      recipientUserId: i.string().indexed(),
      type: i.string(),                   // item_approved|item_rejected|item_correction|report_finalized
      reportId: i.string().indexed(),
      reportResponseId: i.string(),
      storeId: i.string().indexed(),
      title: i.string(),
      body: i.string(),
      itemTitle: i.string(),
      completionPercent: i.number(),
      compliancePercent: i.number(),
      actionStatus: i.string(),
      actorUserId: i.string(),
      actorRole: i.string(),
      readAt: i.string(),                   // '' = unread
      createdAt: i.string(),
    }),

    roleDefinitions: i.entity({
      key: i.string().unique().indexed(),
      label: i.string(),
      rank: i.number().indexed(),
      isSystem: i.boolean(),
      active: i.boolean(),
      canEditMaster: i.boolean(),
      canManageUsers: i.boolean(),
      canReview: i.boolean(),
      canPreApproveAccess: i.boolean(),
      canAccessAllStores: i.boolean(),
      seesAllTemplateItems: i.boolean(),
      canExportDashboard: i.boolean(),
      canExportReviewStatus: i.boolean(),
      canScheduleShifts: i.boolean(),
      canDeleteShifts: i.boolean(),
      canUseOpsTools: i.boolean(),
      canClockIn: i.boolean(),
      approvesSubmitterRolesJson: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),
  },

  links: {
    // ─── Profiles <-> $users (1:1) ───────────────────────────────────────────
    profileUser: {
      forward: { on: 'profiles', has: 'one', label: '$user' },
      reverse: { on: '$users', has: 'one', label: 'profile' },
    },

    // ─── Profiles <-> roleDefinitions (many:one) ─────────────────────────────
    profileRoleDefinition: {
      forward: { on: 'profiles', has: 'one', label: 'roleDefinition' },
      reverse: { on: 'roleDefinitions', has: 'many', label: 'profiles' },
    },

    // ─── Profiles <-> stores (many:many) ─────────────────────────────────────
    profileStores: {
      forward: { on: 'profiles', has: 'many', label: 'stores' },
      reverse: { on: 'stores', has: 'many', label: 'staff' },
    },

    // ─── Templates <-> stores (many:many) ────────────────────────────────────
    templateStores: {
      forward: { on: 'templates', has: 'many', label: 'stores' },
      reverse: { on: 'stores', has: 'many', label: 'templates' },
    },

    // ─── TemplateItems -> template (many:one) ────────────────────────────────
    templateItemTemplate: {
      forward: { on: 'templateItems', has: 'one', label: 'template' },
      reverse: { on: 'templates', has: 'many', label: 'items' },
    },

    // ─── TemplateScheduleVersions -> template (many:one) ─────────────────────
    templateScheduleVersionTemplate: {
      forward: { on: 'templateScheduleVersions', has: 'one', label: 'template' },
      reverse: { on: 'templates', has: 'many', label: 'scheduleVersions' },
    },

    // ─── Reports -> store ────────────────────────────────────────────────────
    reportStore: {
      forward: { on: 'reports', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'reports' },
    },

    // ─── Reports -> template ─────────────────────────────────────────────────
    reportTemplate: {
      forward: { on: 'reports', has: 'one', label: 'template' },
      reverse: { on: 'templates', has: 'many', label: 'reports' },
    },

    // ─── Reports -> submitter profile ────────────────────────────────────────
    reportSubmitter: {
      forward: { on: 'reports', has: 'one', label: 'submitter' },
      reverse: { on: 'profiles', has: 'many', label: 'submittedReports' },
    },

    // ─── ReportResponses -> report ───────────────────────────────────────────
    reportResponseReport: {
      forward: { on: 'reportResponses', has: 'one', label: 'report' },
      reverse: { on: 'reports', has: 'many', label: 'responses' },
    },

    // ─── ReportResponses -> templateItem ─────────────────────────────────────
    reportResponseTemplateItem: {
      forward: { on: 'reportResponses', has: 'one', label: 'templateItem' },
      reverse: { on: 'templateItems', has: 'many', label: 'responses' },
    },

    // ─── MediaRecords -> $files ──────────────────────────────────────────────
    mediaRecordFile: {
      forward: { on: 'mediaRecords', has: 'one', label: 'file' },
      reverse: { on: '$files', has: 'many', label: 'mediaRecords' },
    },

    // ─── MediaRecords -> reportResponse ──────────────────────────────────────
    mediaRecordResponse: {
      forward: { on: 'mediaRecords', has: 'one', label: 'reportResponse' },
      reverse: { on: 'reportResponses', has: 'many', label: 'media' },
    },

    // ─── WatermarkTemplates <-> stores (many:many) ───────────────────────────
    watermarkTemplateStores: {
      forward: { on: 'watermarkTemplates', has: 'many', label: 'stores' },
      reverse: { on: 'stores', has: 'many', label: 'watermarkTemplates' },
    },

    // ─── WatermarkTemplates -> $files (logo) ─────────────────────────────────
    watermarkTemplateLogo: {
      forward: { on: 'watermarkTemplates', has: 'one', label: 'logo' },
      reverse: { on: '$files', has: 'many', label: 'watermarkTemplates' },
    },

    // ─── CorrectiveActions -> report ─────────────────────────────────────────
    correctiveActionReport: {
      forward: { on: 'correctiveActions', has: 'one', label: 'report' },
      reverse: { on: 'reports', has: 'many', label: 'correctiveActions' },
    },

    // ─── CorrectiveActions -> $files (evidence photo) ────────────────────────
    correctiveActionEvidence: {
      forward: { on: 'correctiveActions', has: 'one', label: 'evidencePhoto' },
      reverse: { on: '$files', has: 'many', label: 'correctiveActions' },
    },

    // ─── ReportSlots -> template ─────────────────────────────────────────────
    reportSlotTemplate: {
      forward: { on: 'reportSlots', has: 'one', label: 'template' },
      reverse: { on: 'templates', has: 'many', label: 'slots' },
    },

    // ─── ReportSlots -> store ────────────────────────────────────────────────
    reportSlotStore: {
      forward: { on: 'reportSlots', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'slots' },
    },

    // ─── Shifts -> store ─────────────────────────────────────────────────────
    shiftStore: {
      forward: { on: 'shifts', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'shifts' },
    },

    // ─── Shifts -> employee profile ──────────────────────────────────────────
    shiftEmployee: {
      forward: { on: 'shifts', has: 'one', label: 'employee' },
      reverse: { on: 'profiles', has: 'many', label: 'shifts' },
    },

    // ─── ClockEvents -> shift ────────────────────────────────────────────────
    clockEventShift: {
      forward: { on: 'clockEvents', has: 'one', label: 'shift' },
      reverse: { on: 'shifts', has: 'many', label: 'clockEvents' },
    },

    // ─── ClockEvents -> $files (clock-in photo) ──────────────────────────────
    clockEventPhoto: {
      forward: { on: 'clockEvents', has: 'one', label: 'photo' },
      reverse: { on: '$files', has: 'many', label: 'clockEvents' },
    },

    // ─── LogbookEntries -> store ─────────────────────────────────────────────
    logbookEntryStore: {
      forward: { on: 'logbookEntries', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'logbookEntries' },
    },

    // ─── LogbookEntries -> $files (attached photo) ───────────────────────────
    logbookEntryPhoto: {
      forward: { on: 'logbookEntries', has: 'one', label: 'photo' },
      reverse: { on: '$files', has: 'many', label: 'logbookEntries' },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
