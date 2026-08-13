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
      role: i.string(),                      // owner|admin|areaManager|manager|leader|subleader|hybrid|staff|viewer
      approvalStatus: i.string(),            // pending|manager_review|pre_approved|needs_manager_recheck|approved|rejected
      approvedAt: i.string(),
      approvedByEmail: i.string(),
      accessReviewStoreIdsJson: i.string().clientRequired(),  // JSON: string[] store IDs for manager pre-approval
      accessReviewNote: i.string().clientRequired(),
      preApprovedByUserId: i.string().clientRequired(),
      preApprovedByEmail: i.string().clientRequired(),
      preApprovedAt: i.string().clientRequired(),
      accessReviewRequestedByEmail: i.string().clientRequired(),
      accessReviewRequestedAt: i.string().clientRequired(),
      invitedStoreIdsJson: i.string().clientRequired(),     // JSON: string[] intended stores from invitation
      createdAt: i.string(),
      updatedAt: i.string(),
      cameraOptionsJson: i.string().clientRequired(),       // JSON: { weatherEnabled, logoEnabled, flashlightLastUsed }
      avatarUrl: i.string().clientRequired(),               // legacy; new uploads leave ''; prefer avatarFile.url
      avatarPath: i.string().clientRequired(),              // stable $files path; '' when none
    }),

    // Opaque-token user invitations (managed via admin API)
    invitations: i.entity({
      tokenHash: i.string().unique().indexed(),
      email: i.string().indexed(),
      role: i.string(),
      storeIdsJson: i.string(),                              // JSON: string[]
      invitedByUserId: i.string().indexed(),
      invitedByEmail: i.string(),
      status: i.string().indexed(),                          // pending|opened|accepted|expired|revoked
      createdAt: i.string(),
      expiresAt: i.string().indexed(),
      acceptedAt: i.string(),
      revokedAt: i.string(),
      firstOpenedAt: i.string(),
      lastOpenedAt: i.string(),
      acceptedUserId: i.string(),
      intendedRedirect: i.string(),
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
      proofLogoUrl: i.string().clientRequired(),            // '' = use app default logo
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
      assignedRolesJson: i.string().optional(),       // JSON array of role strings (or ["*"] for all)
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
      status: i.string().indexed(),        // waiting_approval|approved|rejected|need_correction
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
      assignedRolesJson: i.string().optional(),       // JSON array of role strings (or ["*"] for all)
      approverRolesJson: i.string(),
      weight: i.number(),
      failureCategory: i.string(),
      ticked: i.boolean(),
      numberValue: i.string(),
      note: i.string(),
      status: i.string(),                  // not_started|waiting_approval|approved|rejected|need_correction
      rejectionReason: i.string(),
      feedbackCode: i.string().indexed().clientRequired(),  // preset code or 'other'
      feedbackNote: i.string().clientRequired(),            // free text for 'other' or optional extra note
      submittedByUserId: i.string(),
      submittedByRole: i.string(),
      submittedAt: i.string(),
      approvedByUserId: i.string(),
      approvedAt: i.string(),
      updatedAt: i.string(),
      // Denormalised for Instant store-scoped review writes (optional for legacy rows)
      storeId: i.string().indexed().optional(),
      // Additive schedule capture (Phase 2) — optional so existing responses can stay null
      scheduleOccurrenceKey: i.string().indexed().optional(),
      scheduledDueAt: i.string().optional(),
      firstCompletedAt: i.string().optional(),
      scheduleVersionId: i.string().optional(),
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
      fileUrl: i.string().clientRequired(),                 // denormalised CDN url for review UI
      deletedAt: i.string(),               // '' while active; ISO date when storage file deleted
      storageDeleted: i.boolean(),         // true after cleanup job removes the file
      storageDeletedReason: i.string(),    // e.g. 'auto_cleanup_after_7_days_reviewed'
      proofMetadataJson: i.string().clientRequired(),       // JSON: proofTimestamp, proofTimezone, proofLocation, proofWeather, proofLogoUrl, cameraOptionsSnapshot
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

    // ─── Logbook entries (Phase 2D + issue lifecycle) ────────────────────────
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
      // IANA timezone at create (GPS → store → device); '' = legacy
      createdTimezone: i.string().clientRequired(),
      // Issue lifecycle (additive; '' / missing = legacy note/announcement)
      entryType: i.string().indexed().clientRequired(),           // note|announcement|issue
      assigneeRole: i.string().indexed().clientRequired(),
      // JSON array of specific assignee user IDs; '[]' = anyone with assigneeRole at store
      assigneeUserIdsJson: i.string().clientRequired(),
      dueAt: i.string().indexed().clientRequired(),
      status: i.string().indexed().clientRequired(),              // open|in_progress|waiting_approval|resolved|recalled
      startedAt: i.string().clientRequired(),
      startedByUserId: i.string().clientRequired(),
      resolutionProofType: i.string().indexed().clientRequired(), // PROOF_TYPES; default photo for issues
      resolutionRequirement: i.string().clientRequired(),         // instructions for assignee
      resolutionChecked: i.boolean().clientRequired(),            // tick completion
      resolutionNumber: i.string().clientRequired(),              // numeric result (report numberValue style)
      resolutionNote: i.string().clientRequired(),
      resolutionSubmittedAt: i.string().clientRequired(),
      resolutionSubmittedByUserId: i.string().clientRequired(),
      resolutionAttemptId: i.string().clientRequired(),           // idempotency key for Stage A/B submit
      resolvedAt: i.string().clientRequired(),
      resolvedByUserId: i.string().clientRequired(),
      reviewedAt: i.string().clientRequired(),
      reviewedByUserId: i.string().clientRequired(),
      reviewNote: i.string().clientRequired(),
      reopenedAt: i.string().clientRequired(),
      reopenedByUserId: i.string().clientRequired(),
      reopenReason: i.string().clientRequired(),
      recalledAt: i.string().clientRequired(),
      recalledByUserId: i.string().clientRequired(),
      recallReason: i.string().clientRequired(),
      dueSoonNotifiedAt: i.string().clientRequired(),
      overdueNotifiedAt: i.string().clientRequired(),
      /** Admin-only stamp: overdue Store Chat remind sent once. Client cannot forge. */
      overdueChatRemindedAt: i.string().clientRequired(),
      /** Admin-stamped Instant id of the overdue remind Store Chat message; '' until sent. */
      overdueChatRemindMessageId: i.string().clientRequired(),
    }),

    // ─── Review audit trail ──────────────────────────────────────────────────
    reviewEvents: i.entity({
      reportId: i.string().indexed(),
      reportResponseId: i.string().indexed(), // '' for report-level / logbook events
      storeId: i.string().indexed(),
      eventType: i.string().indexed(),
      // report: submitted|resubmitted|item_approved|item_rejected|item_correction|report_finalized
      // logbook: issue_created|issue_assigned|work_started|…
      itemTitle: i.string(),
      templateItemId: i.string().indexed().clientRequired(),
      sectionSnapshot: i.string().clientRequired(),
      categorySnapshot: i.string().clientRequired(),
      statusAfter: i.string(),
      previousStatus: i.string().clientRequired(),
      actorUserId: i.string(),
      actorRole: i.string(),
      actorDisplayNameSnapshot: i.string().clientRequired(),
      note: i.string(),
      feedbackCode: i.string().clientRequired(),
      feedbackNote: i.string().clientRequired(),
      createdAt: i.string().indexed(),
      logbookEntryId: i.string().indexed().clientRequired(), // '' for report events
      targetType: i.string().clientRequired(),               // report|logbook
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
      type: i.string(),                   // item_approved|item_rejected|item_correction|report_finalized|checklist_item_proposal_*
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
      // Optional: legacy inbox rows have null; new Admin delivers set a key.
      deliveryKey: i.string().indexed().optional(),
      // clientRequired for new client writes ('' ok); legacy rows may be null.
      deepLinkJson: i.string().optional().clientRequired(),
    }),

    // ─── Checklist item proposals (new-item requests; not templateItems) ─────
    checklistItemProposals: i.entity({
      templateId: i.string().indexed(),
      templateNameSnapshot: i.string(),
      templateVersionSnapshot: i.string(),
      sourceStoreId: i.string().indexed(),
      affectedStoreIdsJson: i.string(),
      requestedByUserId: i.string().indexed(),
      requesterNameSnapshot: i.string(),
      requesterRoleSnapshot: i.string(),
      requesterStoreId: i.string().indexed(),
      section: i.string(),
      title: i.string(),
      requirement: i.string(),
      reason: i.string(),
      proofType: i.string(),
      assignedRole: i.string(),
      failureCategory: i.string(),
      required: i.boolean(),
      completionTime: i.string(),
      sourceReportId: i.string(),
      supportingEvidenceJson: i.string(),
      proposedItemJson: i.string(),
      status: i.string().indexed(),
      firstApproverUserIdsJson: i.string(),
      firstApproverRole: i.string(),
      firstApproverUserId: i.string(),
      firstApprovedAt: i.string(),
      firstApprovalComment: i.string(),
      finalApproverUserIdsJson: i.string(),
      finalApproverRole: i.string(),
      finalApproverUserId: i.string(),
      finalApprovedAt: i.string(),
      finalApprovalComment: i.string(),
      rejectedByUserId: i.string(),
      rejectedAt: i.string(),
      rejectionReason: i.string(),
      publishedAt: i.string(),
      publishedByUserId: i.string(),
      resultingTemplateItemId: i.string(),
      similarityWarningJson: i.string(),
      duplicateOverrideReason: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    checklistItemProposalComments: i.entity({
      proposalId: i.string().indexed(),
      userId: i.string().indexed(),
      userNameSnapshot: i.string(),
      userRoleSnapshot: i.string(),
      message: i.string(),
      createdAt: i.string(),
    }),

    checklistItemProposalEvents: i.entity({
      proposalId: i.string().indexed(),
      eventType: i.string(),
      actorUserId: i.string(),
      fromStatus: i.string(),
      toStatus: i.string(),
      metadataJson: i.string(),
      createdAt: i.string(),
    }),

    // ─── User change requests (role change / soft-delete approvals) ──────────
    userChangeRequests: i.entity({
      type: i.string().indexed(),
      status: i.string().indexed(),
      targetUserId: i.string().indexed(),
      targetEmail: i.string(),
      fromRole: i.string(),
      toRole: i.string(),
      storeIdsJson: i.string(),
      note: i.string(),
      requestedByUserId: i.string().indexed(),
      firstApproverUserIdsJson: i.string(),
      firstApproverUserId: i.string(),
      firstApproverAt: i.string(),
      firstApproverNote: i.string(),
      finalApproverUserIdsJson: i.string(),
      finalApproverUserId: i.string(),
      finalApproverAt: i.string(),
      finalApproverNote: i.string(),
      rejectionReason: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
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
      canProposeTemplateItem: i.boolean().optional(),
      canFirstApproveTemplateItemProposal: i.boolean().optional(),
      canFinalApproveTemplateItemProposal: i.boolean().optional(),
      canPublishTemplateItemProposal: i.boolean().optional(),
      canRequestUserChanges: i.boolean().optional(),
      /** Custom Group Chat — create private invite-accept rooms. */
      canCreateGroupChat: i.boolean().optional(),
      /** Invite members outside the actor's assigned stores. */
      canCreateCrossStoreGroupChat: i.boolean().optional(),
      /** Send messages in group rooms when also a member (viewer stays blocked in Instant). */
      canSendGroupChat: i.boolean().optional(),
      roleDefinitionVersion: i.number().optional(),
      approvesSubmitterRolesJson: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // ─── Store Wi-Fi public IPs (push activation gate) ───────────────────────
    storeWifiIps: i.entity({
      storeId: i.string().indexed(),
      label: i.string(),
      publicIp: i.string().indexed(),
      active: i.boolean(),
      createdAt: i.string(),
      updatedAt: i.string(),
    }),

    // ─── Web Push subscriptions (device-scoped) ──────────────────────────────
    pushSubscriptions: i.entity({
      userId: i.string().indexed(),
      deviceId: i.string().indexed(),
      endpoint: i.string().unique(),
      p256dh: i.string(),
      auth: i.string(),
      userAgent: i.string(),
      createdAt: i.string(),
      updatedAt: i.string(),
      revokedAt: i.string(),              // '' = active
    }),

    // ─── Device activation sessions (Admin SDK writes only) ──────────────────
    notificationActivationSessions: i.entity({
      userId: i.string().indexed(),
      deviceId: i.string().indexed(),
      storeId: i.string().indexed(),
      wifiIpId: i.string(),               // real id for wifi_ip; '' for geofence
      shiftId: i.string(),
      subscriptionId: i.string(),
      matchedPublicIp: i.string(),        // public IP for wifi_ip; '' for geofence
      storeCode: i.string(),
      activatedAt: i.string(),
      expiresAt: i.string().indexed(),    // '' = no TTL (wifi_ip); ISO now+5m (geofence)
      deactivatedAt: i.string(),          // '' = active
      deactivateReason: i.string(),
      // Additive Admin-SDK fields: '' when unused. clientRequired so legacy sessions (null) stay valid.
      activationMethod: i.string().clientRequired(),       // 'wifi_ip' | 'geofence'; ''/missing on legacy → treat as wifi_ip if wifiIpId set
      verifiedLat: i.string().clientRequired(),            // stringified number for geofence; '' for wifi_ip
      verifiedLng: i.string().clientRequired(),            // stringified number for geofence; '' for wifi_ip
      locationAccuracyM: i.string().clientRequired(),      // string number for geofence; '' for wifi_ip
      distanceFromStoreM: i.string().clientRequired(),     // string number for geofence; '' for wifi_ip
      presenceVerifiedAt: i.string().clientRequired(),     // ISO for geofence; '' for wifi_ip
    }),

    // ─── Push delivery / suppression audit (Admin SDK writes only) ───────────
    pushDeliveryLogs: i.entity({
      notificationId: i.string().indexed(),
      userId: i.string().indexed(),
      deviceId: i.string(),
      outcome: i.string(),                // sent|suppressed
      reason: i.string(),
      createdAt: i.string(),
    }),

    // ─── Store Chat messages (room key = storeId) ───────────────────────────
    storeChatMessages: i.entity({
      storeId: i.string().indexed(),           // room key
      senderUserId: i.string().indexed(),      // auth.id — ownership for rules
      senderProfileId: i.string().indexed(),
      senderNameSnapshot: i.string(),
      senderRoleSnapshot: i.string(),
      messageType: i.string(),                 // 'text' | 'giphy_media' | 'text_giphy' | 'attachment' | 'text_attachment' | 'logbook_system' | 'report_system'
      body: i.string(),
      createdAt: i.string().indexed(),
      editedAt: i.string().clientRequired(),   // '' unused in v1
      deletedAt: i.string().clientRequired(),  // '' = active
      status: i.string(),                      // 'active' | 'deleted'
      replyToMessageId: i.string().clientRequired(), // '' unused in v1
      mentionedUserIdsJson: i.string().clientRequired(), // JSON string[]; '[]' default
      mentionAll: i.boolean().clientRequired(),         // false default
      // Phase 4 GIPHY media ('' when text-only). Merge-safe with Phase 3 forward/bookmarks.
      giphyId: i.string().clientRequired(),
      giphyKind: i.string().clientRequired(), // 'gif' | 'sticker' | 'meme' | 'emoji' | ''
      giphyTitle: i.string().clientRequired(),
      giphyWidth: i.string().clientRequired(), // numeric string or ''
      giphyHeight: i.string().clientRequired(),
      giphyUrl: i.string().clientRequired(),
      giphyPreviewUrl: i.string().clientRequired(),
      // Chat attachments ('' when unused). Additive; mutual-exclusive with GIPHY via perms.
      attachmentKind: i.string().clientRequired(), // '' | 'image' | 'file'
      attachmentPath: i.string().clientRequired(),
      attachmentFileId: i.string().clientRequired(),
      attachmentUrl: i.string().clientRequired(),
      attachmentMimeType: i.string().clientRequired(),
      attachmentFileName: i.string().clientRequired(),
      attachmentBytes: i.string().clientRequired(), // decimal string
      attachmentWidth: i.string().clientRequired(),
      attachmentHeight: i.string().clientRequired(),
      // Forward metadata (empty = not forwarded). Sender remains the forwarder.
      forwardedFromMessageId: i.string().clientRequired(),
      forwardedFromUserId: i.string().clientRequired(),
      clientMutationId: i.string().clientRequired(),
      // Admin-created Logbook / Report system cards (empty defaults for client messages).
      sourceType: i.string().clientRequired(), // '' | 'logbook' | 'report'
      logbookEntryId: i.string().clientRequired(),
      // Report id for report_system rows (symmetry with logbookEntryId); '' otherwise.
      reportId: i.string().clientRequired(),
      // Logbook event name, or report event: report_submitted | report_action_required | report_finalized
      logbookEventType: i.string().clientRequired(),
      actionType: i.string().clientRequired(),
      targetUserIdsJson: i.string().clientRequired(),
      deepLinkJson: i.string().clientRequired(),
      statusSnapshot: i.string().clientRequired(),
      chatDeliveryKey: i.string().indexed().optional(),
    }),

    // ─── Store Chat reactions (room key = storeId) ─────────────────────────
    storeChatReactions: i.entity({
      storeId: i.string().indexed(),
      messageId: i.string().indexed(),
      userId: i.string().indexed(), // auth.id — ownership for rules
      reactionType: i.string(), // 'unicode' | 'giphy'
      unicode: i.string().clientRequired(), // emoji; '' when giphy
      giphyId: i.string().clientRequired(), // '' when unicode
      giphyKind: i.string().clientRequired(),
      giphyTitle: i.string().clientRequired(),
      giphyUrl: i.string().clientRequired(), // '' when unicode
      giphyPreviewUrl: i.string().clientRequired(), // '' when unicode
      createdAt: i.string().indexed(),
      clientMutationId: i.string().clientRequired(),
    }),

    // ─── Store Chat bookmarks / favorites (per viewer) ─────────────────────
    storeChatBookmarks: i.entity({
      storeId: i.string().indexed(),
      messageId: i.string().indexed(),
      userId: i.string().indexed(), // auth.id — ownership for rules
      createdAt: i.string().indexed(),
    }),

    // ─── Custom Group Chat rooms (room key = room id; private invite-accept) ─
    // Separate from storeChat* — never reuse storeId; no Logbook delivery.
    groupChatRooms: i.entity({
      name: i.string(),
      description: i.string().clientRequired(),
      icon: i.string().clientRequired(),
      privacy: i.string(), // 'private' only in v1
      status: i.string().indexed(), // 'active' | 'archived'
      createdByUserId: i.string().indexed(),
      createdByProfileId: i.string().indexed(),
      createdAt: i.string().indexed(),
      updatedAt: i.string(),
      lastMessageAt: i.string().indexed().clientRequired(),
      similarNameKey: i.string().indexed().clientRequired(),
    }),

    groupChatMembers: i.entity({
      roomId: i.string().indexed(), // denormalized for auth.ref membership
      userId: i.string().indexed(),
      profileId: i.string().indexed(),
      roomRole: i.string(), // 'owner' | 'admin' | 'member'
      joinedAt: i.string().indexed(),
      notificationMode: i.string().clientRequired(), // 'all' | 'mentions' | 'muted'
      lastReadAt: i.string().clientRequired(),
      muted: i.boolean().clientRequired(),
      pinned: i.boolean().clientRequired(),
    }),

    groupChatInvites: i.entity({
      roomId: i.string().indexed(),
      inviteeUserId: i.string().indexed(),
      inviteeProfileId: i.string().indexed(),
      inviterUserId: i.string().indexed(),
      inviterProfileId: i.string().indexed(),
      status: i.string().indexed(), // pending|accepted|declined|expired|cancelled
      historyMode: i.string(), // 'full' only in v1
      /** Denormalized so invitees can preview without room membership view. */
      roomNameSnapshot: i.string(),
      roomDescriptionSnapshot: i.string().clientRequired(),
      inviterNameSnapshot: i.string().clientRequired(),
      createdAt: i.string().indexed(),
      respondedAt: i.string().clientRequired(),
      expiresAt: i.string().clientRequired(),
    }),

    // Mirror safe Store Chat fields with roomId (not storeId). No logbook fields.
    groupChatMessages: i.entity({
      roomId: i.string().indexed(),
      senderUserId: i.string().indexed(),
      senderProfileId: i.string().indexed(),
      senderNameSnapshot: i.string(),
      senderRoleSnapshot: i.string(),
      messageType: i.string(), // 'text' | 'giphy_media' | 'text_giphy' | 'attachment' | 'text_attachment' | 'system'
      body: i.string(),
      createdAt: i.string().indexed(),
      editedAt: i.string().clientRequired(),
      deletedAt: i.string().clientRequired(),
      status: i.string(), // 'active' | 'deleted'
      replyToMessageId: i.string().clientRequired(),
      mentionedUserIdsJson: i.string().clientRequired(),
      mentionAll: i.boolean().clientRequired(),
      giphyId: i.string().clientRequired(),
      giphyKind: i.string().clientRequired(),
      giphyTitle: i.string().clientRequired(),
      giphyWidth: i.string().clientRequired(),
      giphyHeight: i.string().clientRequired(),
      giphyUrl: i.string().clientRequired(),
      giphyPreviewUrl: i.string().clientRequired(),
      // Chat attachments ('' when unused). Additive; mutual-exclusive with GIPHY via perms.
      attachmentKind: i.string().clientRequired(), // '' | 'image' | 'file'
      attachmentPath: i.string().clientRequired(),
      attachmentFileId: i.string().clientRequired(),
      attachmentUrl: i.string().clientRequired(),
      attachmentMimeType: i.string().clientRequired(),
      attachmentFileName: i.string().clientRequired(),
      attachmentBytes: i.string().clientRequired(),
      attachmentWidth: i.string().clientRequired(),
      attachmentHeight: i.string().clientRequired(),
      // Forward metadata (empty = not forwarded). Sender remains the forwarder.
      forwardedFromMessageId: i.string().clientRequired(),
      forwardedFromUserId: i.string().clientRequired(),
      clientMutationId: i.string().clientRequired(),
    }),

    // Group Chat reactions (room key = roomId; membership-only, no elevated bypass)
    groupChatReactions: i.entity({
      roomId: i.string().indexed(),
      messageId: i.string().indexed(),
      userId: i.string().indexed(),
      reactionType: i.string(), // 'unicode' | 'giphy'
      unicode: i.string().clientRequired(),
      giphyId: i.string().clientRequired(),
      giphyKind: i.string().clientRequired(),
      giphyTitle: i.string().clientRequired(),
      giphyUrl: i.string().clientRequired(),
      giphyPreviewUrl: i.string().clientRequired(),
      createdAt: i.string().indexed(),
      clientMutationId: i.string().clientRequired(),
    }),

    // Group Chat bookmarks / favorites (per viewer; membership-only)
    groupChatBookmarks: i.entity({
      roomId: i.string().indexed(),
      messageId: i.string().indexed(),
      userId: i.string().indexed(),
      createdAt: i.string().indexed(),
    }),
  },

  links: {
    // ─── Profiles <-> $users (1:1) ───────────────────────────────────────────
    profileUser: {
      forward: { on: 'profiles', has: 'one', label: '$user' },
      reverse: { on: '$users', has: 'one', label: 'profile' },
    },

    // ─── Profiles <-> $files (avatar; Admin SDK link/unlink only) ────────────
    profileAvatarFile: {
      forward: { on: 'profiles', has: 'one', label: 'avatarFile' },
      reverse: { on: '$files', has: 'one', label: 'avatarProfile' },
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

    // ─── StoreWifiIps -> store (many:one) ─────────────────────────────────────
    storeWifiIpStore: {
      forward: { on: 'storeWifiIps', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'wifiIps' },
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

    // ─── LogbookEntries -> $files (legacy attached photo; resolution or source) ─
    logbookEntryPhoto: {
      forward: { on: 'logbookEntries', has: 'one', label: 'photo' },
      reverse: { on: '$files', has: 'many', label: 'logbookEntries' },
    },

    // Creator / context media (many)
    logbookEntrySourceMedia: {
      forward: { on: 'logbookEntries', has: 'many', label: 'sourceMedia' },
      reverse: { on: '$files', has: 'many', label: 'logbookSourceEntries' },
    },

    // Resolution proof media (many) — current-attempt proofs
    logbookEntryResolutionMedia: {
      forward: { on: 'logbookEntries', has: 'many', label: 'resolutionMedia' },
      reverse: { on: '$files', has: 'many', label: 'logbookResolutionEntries' },
    },

    // All submitted resolution proofs (append-only history)
    logbookEntryResolutionProofHistory: {
      forward: { on: 'logbookEntries', has: 'many', label: 'resolutionProofHistory' },
      reverse: { on: '$files', has: 'many', label: 'logbookResolutionHistoryEntries' },
    },

    // ─── Checklist item proposals ────────────────────────────────────────────
    checklistItemProposalTemplate: {
      forward: { on: 'checklistItemProposals', has: 'one', label: 'template' },
      reverse: { on: 'templates', has: 'many', label: 'checklistItemProposals' },
    },
    checklistItemProposalRequester: {
      forward: { on: 'checklistItemProposals', has: 'one', label: 'requester' },
      reverse: { on: 'profiles', has: 'many', label: 'checklistItemProposals' },
    },
    checklistItemProposalSourceStore: {
      forward: { on: 'checklistItemProposals', has: 'one', label: 'sourceStore' },
      reverse: { on: 'stores', has: 'many', label: 'checklistItemProposals' },
    },
    checklistItemProposalSourceReport: {
      forward: { on: 'checklistItemProposals', has: 'one', label: 'sourceReport' },
      reverse: { on: 'reports', has: 'many', label: 'checklistItemProposals' },
    },
    checklistItemProposalCommentProposal: {
      forward: { on: 'checklistItemProposalComments', has: 'one', label: 'proposal' },
      reverse: { on: 'checklistItemProposals', has: 'many', label: 'comments' },
    },
    checklistItemProposalEventProposal: {
      forward: { on: 'checklistItemProposalEvents', has: 'one', label: 'proposal' },
      reverse: { on: 'checklistItemProposals', has: 'many', label: 'events' },
    },

    // ─── User change requests ────────────────────────────────────────────────
    userChangeRequestRequester: {
      forward: { on: 'userChangeRequests', has: 'one', label: 'requester' },
      reverse: { on: 'profiles', has: 'many', label: 'userChangeRequests' },
    },
    userChangeRequestTarget: {
      forward: { on: 'userChangeRequests', has: 'one', label: 'target' },
      reverse: { on: 'profiles', has: 'many', label: 'targetedUserChangeRequests' },
    },

    // ─── Store Chat messages -> store / sender profile ───────────────────────
    // Rules primarily use denormalized storeId + senderUserId; links aid tooling.
    storeChatMessageStore: {
      forward: { on: 'storeChatMessages', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'storeChatMessages' },
    },
    storeChatMessageSender: {
      forward: { on: 'storeChatMessages', has: 'one', label: 'sender' },
      reverse: { on: 'profiles', has: 'many', label: 'storeChatMessages' },
    },
    storeChatMessageAttachmentFile: {
      forward: { on: 'storeChatMessages', has: 'one', label: 'attachmentFile' },
      reverse: { on: '$files', has: 'many', label: 'storeChatAttachmentMessages' },
    },

    // ─── Store Chat reactions -> store / message ─────────────────────────────
    storeChatReactionStore: {
      forward: { on: 'storeChatReactions', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'storeChatReactions' },
    },
    storeChatReactionMessage: {
      forward: { on: 'storeChatReactions', has: 'one', label: 'message' },
      reverse: { on: 'storeChatMessages', has: 'many', label: 'reactions' },
    },

    // ─── Store Chat bookmarks -> store / message ─────────────────────────────
    storeChatBookmarkStore: {
      forward: { on: 'storeChatBookmarks', has: 'one', label: 'store' },
      reverse: { on: 'stores', has: 'many', label: 'storeChatBookmarks' },
    },
    storeChatBookmarkMessage: {
      forward: { on: 'storeChatBookmarks', has: 'one', label: 'message' },
      reverse: { on: 'storeChatMessages', has: 'many', label: 'bookmarks' },
    },

    // ─── Custom Group Chat — membership graph for auth.ref ───────────────────
    // Traversal: data.roomId in auth.ref('$user.profile.groupChatMemberships.room.id')
    // Mirrors store chat membership via profile.stores.id (not elevated roles).
    groupChatMemberRoom: {
      forward: { on: 'groupChatMembers', has: 'one', label: 'room' },
      reverse: { on: 'groupChatRooms', has: 'many', label: 'members' },
    },
    groupChatMemberProfile: {
      forward: { on: 'groupChatMembers', has: 'one', label: 'profile' },
      reverse: { on: 'profiles', has: 'many', label: 'groupChatMemberships' },
    },
    groupChatInviteRoom: {
      forward: { on: 'groupChatInvites', has: 'one', label: 'room' },
      reverse: { on: 'groupChatRooms', has: 'many', label: 'invites' },
    },
    groupChatInviteInvitee: {
      forward: { on: 'groupChatInvites', has: 'one', label: 'invitee' },
      reverse: { on: 'profiles', has: 'many', label: 'groupChatInvitesReceived' },
    },
    groupChatInviteInviter: {
      forward: { on: 'groupChatInvites', has: 'one', label: 'inviter' },
      reverse: { on: 'profiles', has: 'many', label: 'groupChatInvitesSent' },
    },
    groupChatMessageRoom: {
      forward: { on: 'groupChatMessages', has: 'one', label: 'room' },
      reverse: { on: 'groupChatRooms', has: 'many', label: 'messages' },
    },
    groupChatMessageSender: {
      forward: { on: 'groupChatMessages', has: 'one', label: 'sender' },
      reverse: { on: 'profiles', has: 'many', label: 'groupChatMessages' },
    },
    groupChatMessageAttachmentFile: {
      forward: { on: 'groupChatMessages', has: 'one', label: 'attachmentFile' },
      reverse: { on: '$files', has: 'many', label: 'groupChatAttachmentMessages' },
    },
    groupChatReactionRoom: {
      forward: { on: 'groupChatReactions', has: 'one', label: 'room' },
      reverse: { on: 'groupChatRooms', has: 'many', label: 'reactions' },
    },
    groupChatReactionMessage: {
      forward: { on: 'groupChatReactions', has: 'one', label: 'message' },
      reverse: { on: 'groupChatMessages', has: 'many', label: 'reactions' },
    },
    groupChatBookmarkRoom: {
      forward: { on: 'groupChatBookmarks', has: 'one', label: 'room' },
      reverse: { on: 'groupChatRooms', has: 'many', label: 'bookmarks' },
    },
    groupChatBookmarkMessage: {
      forward: { on: 'groupChatBookmarks', has: 'one', label: 'message' },
      reverse: { on: 'groupChatMessages', has: 'many', label: 'bookmarks' },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
