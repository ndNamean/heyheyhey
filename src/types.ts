// Shared domain types derived from the schema's shape.

export type Role = string;

export const OWNER_ROLE_KEY = 'owner';
export const ADMIN_ROLE_KEY = 'admin';
export const AREA_MANAGER_ROLE_KEY = 'areaManager';

/** Roles only Owner may assign (Area-manager tier and above). */
export const ELEVATED_ASSIGN_ROLE_KEYS = [
  OWNER_ROLE_KEY,
  ADMIN_ROLE_KEY,
  AREA_MANAGER_ROLE_KEY,
] as const;

export interface RoleDefinitionSeed {
  key: string;
  label: string;
  rank: number;
  isSystem: boolean;
  active: boolean;
  canEditMaster: boolean;
  canManageUsers: boolean;
  canReview: boolean;
  canPreApproveAccess: boolean;
  canAccessAllStores: boolean;
  seesAllTemplateItems: boolean;
  canExportDashboard: boolean;
  canExportReviewStatus: boolean;
  canScheduleShifts: boolean;
  canDeleteShifts: boolean;
  canUseOpsTools: boolean;
  canClockIn: boolean;
  canProposeTemplateItem?: boolean;
  canFirstApproveTemplateItemProposal?: boolean;
  canFinalApproveTemplateItemProposal?: boolean;
  canPublishTemplateItemProposal?: boolean;
  canRequestUserChanges?: boolean;
  /** Create private Custom Group Chat rooms. */
  canCreateGroupChat?: boolean;
  /** Invite members outside assigned stores into a group. */
  canCreateCrossStoreGroupChat?: boolean;
  /** Send in group rooms when also a member (Instant still blocks viewer). */
  canSendGroupChat?: boolean;
  /** Schema/migration marker; Owner-editable fields are never rewritten by ensure. */
  roleDefinitionVersion?: number;
  approvesSubmitterRolesJson: string;
}

export interface RoleDefinition extends RoleDefinitionSeed {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalStatus =
  | 'pending'
  | 'manager_review'
  | 'pre_approved'
  | 'needs_manager_recheck'
  | 'approved'
  | 'rejected';

export type ReportStatus =
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'need_correction';

export type ResponseStatus =
  | 'not_started'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'need_correction';

export type ProofType =
  | 'tick'
  | 'photo'
  | 'video'
  | 'number'
  | 'note'
  | 'photo_note'
  | 'photo_number'
  | 'video_note';

export type Severity = 'critical' | 'major' | 'minor';

export type CorrectiveStatus = 'open' | 'in_progress' | 'verified' | 'overdue';

export type SlotStatus = 'pending' | 'submitted' | 'missed';

export type ShiftStatus = 'scheduled' | 'swap_requested';

export type ClockType = 'clockIn' | 'clockOut';

export type LogSeverity = 'info' | 'warning' | 'critical';

export type WatermarkStyle =
  | 'blackBox'
  | 'transparentFloating'
  | 'logoDock'
  | 'blackBoxInline'
  | 'ultimate_custom'
  | 'timecard_stamp';

export type UltimateLayoutMode = 'strip' | 'logo_dock';

export type UltimateGradientPreset =
  | 'luxury_ceo'
  | 'cyberpunk'
  | 'royal_mystique'
  | 'volcanic_energy'
  | 'moody_monochrome';

export type TimecardBackgroundMode = 'solid' | 'gradient' | 'frosted';

export interface UltimateBoxItems {
  logo: boolean;
  userName: boolean;
  storeCode: boolean;
  taskItem: boolean;
  timestamp: boolean;
  address: boolean;
  weather: boolean;
}

export interface UltimateWatermarkConfig {
  boxEnabled: boolean;
  boxGradientEnabled: boolean;
  boxGradientPreset: UltimateGradientPreset;
  boxItems: UltimateBoxItems;
  layoutMode: UltimateLayoutMode;
  autoResize: boolean;
}

export interface TimecardItems {
  time: boolean;
  date: boolean;
  day: boolean;
  userName: boolean;
  storeCode: boolean;
  taskItem: boolean;
  timestamp: boolean;
  address: boolean;
  weather: boolean;
  photoCode: boolean;
  gpsAccuracy: boolean;
}

export interface TimecardWatermarkConfig {
  logoOutside: boolean;
  backgroundMode: TimecardBackgroundMode;
  gradientPreset: UltimateGradientPreset;
  cardFadeDirection: 'left_to_right';
  frostedGlassEnabled: boolean;
  autoResize: boolean;
  items: TimecardItems;
}

/** Clockwise watermark / capture frame direction (TimeMark-style). */
export type WatermarkDirection = 0 | 90 | 180 | 270;

export interface CameraOptions {
  weatherEnabled: boolean;
  logoEnabled: boolean;
  flashlightLastUsed: boolean;
  watermarkStyle?: WatermarkStyle;
  watermarkConfig?: UltimateWatermarkConfig;
  timecardConfig?: TimecardWatermarkConfig;
  /** Manual watermark direction; independent of phone/UI orientation. Default 0. */
  watermarkDirection?: WatermarkDirection;
}

export interface ProofWeather {
  temperature: number;
  feelsLike: number;
  humidity: number;
  condition: string;
  description: string;
  windSpeed: number;
  city: string;
  fetchedAt: string;
}

export interface ProofMetadata {
  proofTimestamp: string;
  proofTimezone?: string;
  proofLocation: string;
  proofWeather: ProofWeather | null;
  proofLogoUrl: string;
  cameraOptionsSnapshot: CameraOptions;
  /** Degrees applied when saving capture pixels (0 | 90 | 270). */
  captureFrameRotation?: WatermarkDirection;
}

// Profile shape (from db.useQuery result ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â fields only, no links)
export interface Profile {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  approvalStatus: ApprovalStatus;
  approvedAt: string;
  approvedByEmail: string;
  accessReviewStoreIdsJson?: string;
  accessReviewNote?: string;
  preApprovedByUserId?: string;
  preApprovedByEmail?: string;
  preApprovedAt?: string;
  accessReviewRequestedByEmail?: string;
  accessReviewRequestedAt?: string;
  invitedStoreIdsJson?: string;
  createdAt: string;
  updatedAt: string;
  cameraOptionsJson?: string;
  /** Legacy denormalized signed URL; do not use for display ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â prefer avatarFile.url. */
  avatarUrl?: string;
  /** Stable Instant storage path (`profile-avatars/{userId}/avatar.ext`); '' when none. */
  avatarPath?: string;
  /** Linked $files row; `url` is the live signed URL from Instant queries. */
  avatarFile?: { id: string; path?: string; url?: string };
  roleDefinition?: RoleDefinition;
  /** Linked auth user; Instant permission rules traverse via $user.profile.* */
  $user?: { id: string };
  // Optional linked data from useQuery:
  stores?: Store[];
}

export type InvitationStatus =
  | 'pending'
  | 'opened'
  | 'accepted'
  | 'expired'
  | 'revoked';

export interface InvitationPublic {
  status: InvitationStatus;
  emailMasked: string;
  email: string;
  role: string;
  storeNames: string[];
  invitedByEmail: string;
  expiresAt: string;
  acceptedAt?: string;
}

export interface InvitationAdminRow {
  id: string;
  email: string;
  role: string;
  storeIds: string[];
  storeNames: string[];
  invitedByEmail: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  firstOpenedAt: string;
  lastOpenedAt: string;
  acceptedAt: string;
  revokedAt: string;
}

export interface StoreWifiIp {
  id: string;
  storeId: string;
  label: string;
  publicIp: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  store?: Store;
}

export interface Store {
  id: string;
  code: string;
  name: string;
  address: string;
  area: string;
  lat: number;
  lng: number;
  geofenceRadiusM: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  proofLogoUrl?: string;
  wifiIps?: StoreWifiIp[];
}

export type PushDeactivateReason =
  | ''
  | 'logout'
  | 'shift_end'
  | 'auth_expired'
  | 'store_access_removed'
  | 'store_deactivated'
  | 'wifi_ip_deactivated'
  | 'subscription_removed'
  | 'replaced'
  | 'network_left';

export type NotificationActivationMethod = 'wifi_ip' | 'geofence';

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string;
}

/**
 * Device activation session (Admin SDK writes). Instant string fields;
 * unused / wifi_ip-only values are `''`.
 *
 * Legacy sessions may omit `activationMethod`. Callers should treat missing or
 * empty as `wifi_ip` when `wifiIpId` is non-empty — see
 * `resolveNotificationActivationMethod`.
 */
export interface NotificationActivationSession {
  id: string;
  userId: string;
  deviceId: string;
  storeId: string;
  /** Real wifi IP id for `wifi_ip`; `''` for geofence. */
  wifiIpId: string;
  shiftId: string;
  subscriptionId: string;
  /** Matched public IP for `wifi_ip`; `''` for geofence. */
  matchedPublicIp: string;
  storeCode: string;
  activatedAt: string;
  /** `''` = no TTL (`wifi_ip`); ISO now+5m for geofence. */
  expiresAt: string;
  deactivatedAt: string;
  deactivateReason: PushDeactivateReason | string;
  /** `'wifi_ip' | 'geofence'`; `''` / missing on legacy sessions. */
  activationMethod?: NotificationActivationMethod | '';
  /** Stringified number for geofence; `''` for wifi_ip / unused. */
  verifiedLat?: string;
  verifiedLng?: string;
  locationAccuracyM?: string;
  distanceFromStoreM?: string;
  /** ISO for geofence; `''` for wifi_ip / unused. */
  presenceVerifiedAt?: string;
}

/** Infer activation method for current + legacy sessions. */
export function resolveNotificationActivationMethod(
  session: Pick<NotificationActivationSession, 'activationMethod' | 'wifiIpId'>,
): NotificationActivationMethod | '' {
  const method = String(session.activationMethod ?? '').trim();
  if (method === 'wifi_ip' || method === 'geofence') return method;
  if (String(session.wifiIpId ?? '').trim()) return 'wifi_ip';
  return '';
}

export type PushDeliveryOutcome = 'sent' | 'suppressed';

export interface PushDeliveryLog {
  id: string;
  notificationId: string;
  userId: string;
  deviceId: string;
  outcome: PushDeliveryOutcome | string;
  reason: string;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  reportType: string;
  scheduleJson: string;
  active: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  items?: TemplateItem[];
  stores?: Store[];
  scheduleVersions?: TemplateScheduleVersion[];
}

export interface TemplateItem {
  id: string;
  section: string;
  title: string;
  requirement: string;
  proofType: ProofType;
  required: boolean;
  assignedRole: Role;
  assignedRolesJson?: string;
  approverRolesJson: string;
  weight: number;
  failureCategory: string;
  sortOrder: number;
}

export type ChecklistItemProposalStatus =
  | 'draft'
  | 'pending_first_approval'
  | 'changes_requested'
  | 'pending_final_approval'
  | 'rejected'
  | 'approved'
  | 'published'
  | 'cancelled';

export type ChecklistItemProposalEventType =
  | 'proposal_created'
  | 'proposal_submitted'
  | 'first_approval_granted'
  | 'changes_requested'
  | 'proposal_resubmitted'
  | 'final_approval_granted'
  | 'elevated_approval_granted'
  | 'approval_check_requested'
  | 'proposal_rejected'
  | 'proposal_published'
  | 'proposal_cancelled'
  | 'approvers_assigned';

export type UserChangeRequestType = 'role_change' | 'delete';

export type UserChangeRequestStatus =
  | 'pending_first_approval'
  | 'pending_final_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface UserChangeRequest {
  id: string;
  type: UserChangeRequestType | string;
  status: UserChangeRequestStatus | string;
  targetUserId: string;
  targetEmail: string;
  fromRole: string;
  toRole: string;
  storeIdsJson: string;
  note: string;
  requestedByUserId: string;
  firstApproverUserIdsJson: string;
  firstApproverUserId: string;
  firstApproverAt: string;
  firstApproverNote: string;
  finalApproverUserIdsJson: string;
  finalApproverUserId: string;
  finalApproverAt: string;
  finalApproverNote: string;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
  requester?: Profile;
  target?: Profile;
}

export interface ChecklistItemProposal {
  id: string;
  templateId: string;
  templateNameSnapshot: string;
  templateVersionSnapshot: string;
  sourceStoreId: string;
  affectedStoreIdsJson: string;
  requestedByUserId: string;
  requesterNameSnapshot: string;
  requesterRoleSnapshot: string;
  requesterStoreId: string;
  section: string;
  title: string;
  requirement: string;
  reason: string;
  proofType: ProofType | string;
  assignedRole: Role | string;
  failureCategory: string;
  required: boolean;
  completionTime: string;
  sourceReportId: string;
  supportingEvidenceJson: string;
  proposedItemJson: string;
  status: ChecklistItemProposalStatus | string;
  firstApproverUserIdsJson: string;
  firstApproverRole: string;
  firstApproverUserId: string;
  firstApprovedAt: string;
  firstApprovalComment: string;
  finalApproverUserIdsJson: string;
  finalApproverRole: string;
  finalApproverUserId: string;
  finalApprovedAt: string;
  finalApprovalComment: string;
  rejectedByUserId: string;
  rejectedAt: string;
  rejectionReason: string;
  publishedAt: string;
  publishedByUserId: string;
  resultingTemplateItemId: string;
  similarityWarningJson: string;
  duplicateOverrideReason: string;
  createdAt: string;
  updatedAt: string;
  template?: Template;
  requester?: Profile;
  sourceStore?: Store;
  comments?: ChecklistItemProposalComment[];
  events?: ChecklistItemProposalEvent[];
}

export interface ChecklistItemProposalComment {
  id: string;
  proposalId: string;
  userId: string;
  userNameSnapshot: string;
  userRoleSnapshot: string;
  message: string;
  createdAt: string;
}

export interface ChecklistItemProposalEvent {
  id: string;
  proposalId: string;
  eventType: ChecklistItemProposalEventType | string;
  actorUserId: string;
  fromStatus: string;
  toStatus: string;
  metadataJson: string;
  createdAt: string;
}

/** Historical schedule snapshot. templates.scheduleJson remains the active config. */
export interface TemplateScheduleVersion {
  id: string;
  templateId: string;
  scheduleJson: string;
  effectiveFrom: string;
  effectiveTo: string;
  createdAt: string;
  createdByUserId: string;
}

export interface Report {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  templateId: string;
  templateName: string;
  reportType: string;
  reportDate: string;
  submittedByUserId: string;
  submittedByRole: string;
  submittedAt: string;
  status: ReportStatus;
  completionPercent: number;
  compliancePercent: number;
  archived: boolean;
  archiveMonth: string;
  createdAt: string;
  updatedAt: string;
  responses?: ReportResponse[];
  store?: Store;
}

export interface ReportResponse {
  id: string;
  reportId: string;
  templateItemId: string;
  section: string;
  title: string;
  proofType: ProofType;
  required: boolean;
  assignedRole: Role;
  assignedRolesJson?: string;
  approverRolesJson: string;
  weight: number;
  failureCategory: string;
  ticked: boolean;
  numberValue: string;
  note: string;
  status: ResponseStatus;
  rejectionReason: string;
  feedbackCode: string;
  feedbackNote: string;
  submittedByUserId: string;
  submittedByRole: string;
  submittedAt: string;
  approvedByUserId: string;
  approvedAt: string;
  updatedAt: string;
  /** Denormalised for Instant store-scoped review; blank/missing on legacy rows */
  storeId?: string;
  /** Additive schedule fields ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â blank when unscheduled */
  scheduleOccurrenceKey?: string;
  scheduledDueAt?: string;
  firstCompletedAt?: string;
  scheduleVersionId?: string;
  media?: MediaRecord[];
}

export interface MediaRecord {
  id: string;
  reportId: string;
  reportResponseId: string;
  storeId: string;
  fileName: string;
  mimeType: string;
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
  watermarked: boolean;
  photoCode: string;
  verificationHash: string;
  captureMode: string;
  storeDistanceM: number;
  noteText: string;
  address: string;
  uploadedByUserId: string;
  createdAt: string;
  // Storage cleanup fields
  storagePath: string;
  fileUrl: string;
  deletedAt: string;
  storageDeleted: boolean;
  storageDeletedReason: string;
  proofMetadataJson?: string;
  file?: { id: string; url: string };
}

export interface CorrectiveAction {
  id: string;
  reportId: string;
  itemId: string;
  title: string;
  storeId: string;
  severity: Severity;
  assignedRole: Role;
  assignedByUserId: string;
  dueAt: string;
  status: CorrectiveStatus;
  evidenceNote: string;
  closedByUserId: string;
  closedAt: string;
  escalationLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface Shift {
  id: string;
  storeId: string;
  employeeUserId: string;
  role: Role;
  date: string;
  startTime: string;
  endTime: string;
  hourlyRate: number;
  status: ShiftStatus;
  swapRequestedByUserId: string;
  swapApprovedByUserId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  store?: Store;
  employee?: Profile;
}

export interface ClockEvent {
  id: string;
  shiftId: string;
  employeeUserId: string;
  storeId: string;
  type: ClockType;
  lat: number;
  lng: number;
  accuracy: number;
  photoCode: string;
  timestamp: string;
  gpsValid: boolean;
  createdAt: string;
}

export type LogbookEntryType = 'note' | 'announcement' | 'issue';

export type LogbookIssueStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_approval'
  | 'resolved'
  | 'recalled';

export type LogbookMediaPurpose = 'source_context' | 'resolution_proof';

export type IssueConfigurationState =
  | 'ready'
  | 'missing_assignment'
  | 'missing_deadline'
  | 'missing_resolution_requirement';

export interface LogbookFileRef {
  id: string;
  url: string;
  path?: string;
}

export interface LogbookEntry {
  id: string;
  storeId: string;
  authorUserId: string;
  date: string;
  shift: string;
  content: string;
  severity: LogSeverity;
  isAnnouncement: boolean;
  requiresAck: boolean;
  ackUserIdsJson: string;
  createdAt: string;
  updatedAt: string;
  /** IANA timezone at create; missing/empty = legacy entry */
  createdTimezone?: string;
  entryType?: LogbookEntryType | string;
  assigneeRole?: Role | string;
  /** JSON array of specific assignee user IDs; '[]' / missing = role-wide at store */
  assigneeUserIdsJson?: string;
  dueAt?: string;
  status?: LogbookIssueStatus | string;
  startedAt?: string;
  startedByUserId?: string;
  resolutionProofType?: ProofType | string;
  resolutionRequirement?: string;
  resolutionChecked?: boolean;
  resolutionNumber?: string;
  resolutionNote?: string;
  resolutionSubmittedAt?: string;
  resolutionSubmittedByUserId?: string;
  resolutionAttemptId?: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  reviewNote?: string;
  reopenedAt?: string;
  reopenedByUserId?: string;
  reopenReason?: string;
  recalledAt?: string;
  recalledByUserId?: string;
  recallReason?: string;
  dueSoonNotifiedAt?: string;
  overdueNotifiedAt?: string;
  /** Set by Admin remind path only — once-only Store Chat overdue remind. */
  overdueChatRemindedAt?: string;
  /** Instant id of the overdue remind Store Chat message; '' until stamped. */
  overdueChatRemindMessageId?: string;
  /** Checklist report that spawned this issue ('' when not from Finalise). */
  sourceReportId?: string;
  /** Checklist response that spawned this issue ('' when not from Finalise). */
  sourceResponseId?: string;
  store?: Store;
  /** Legacy single photo link ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â interpret via resolveLogbookMedia helpers */
  photo?: LogbookFileRef;
  sourceMedia?: LogbookFileRef[];
  resolutionMedia?: LogbookFileRef[];
  /** Append-only list of all submitted resolution proofs (including current). */
  resolutionProofHistory?: LogbookFileRef[];
}

export type ReviewEventType =
  | 'submitted'
  | 'resubmitted'
  | 'item_approved'
  | 'item_rejected'
  | 'item_correction'
  | 'report_finalized'
  | 'issue_created'
  | 'issue_assigned'
  | 'work_started'
  | 'due_date_changed'
  | 'resolution_submitted'
  | 'resolution_approved'
  | 'resolution_rejected'
  | 'issue_reopened'
  | 'issue_resolved'
  | 'issue_recalled'
  | 'creator_update'
  | 'acknowledged';

export type ReviewEventTargetType = 'report' | 'logbook';

export interface ReviewEvent {
  id: string;
  reportId: string;
  reportResponseId: string;
  storeId: string;
  eventType: ReviewEventType;
  itemTitle: string;
  templateItemId?: string;
  sectionSnapshot?: string;
  categorySnapshot?: string;
  statusAfter: string;
  previousStatus?: string;
  actorUserId: string;
  actorRole: string;
  actorDisplayNameSnapshot?: string;
  note: string;
  feedbackCode?: string;
  feedbackNote?: string;
  createdAt: string;
  logbookEntryId?: string;
  targetType?: ReviewEventTargetType | string;
}

export type NotificationType =
  | 'item_approved'
  | 'item_rejected'
  | 'item_correction'
  | 'report_finalized'
  | 'checklist_item_proposal_submitted'
  | 'checklist_item_proposal_first_approval_required'
  | 'checklist_item_proposal_first_approved'
  | 'checklist_item_proposal_final_approval_required'
  | 'checklist_item_proposal_changes_requested'
  | 'checklist_item_proposal_rejected'
  | 'checklist_item_proposal_approved'
  | 'checklist_item_proposal_published'
  | 'user_change_requested'
  | 'user_change_first_approved'
  | 'user_change_finalized'
  | 'user_change_rejected'
  | 'logbook_issue_assigned'
  | 'logbook_issue_due_soon'
  | 'logbook_issue_overdue'
  | 'logbook_resolution_submitted'
  | 'logbook_resolution_approved'
  | 'logbook_resolution_rejected'
  | 'logbook_resolution_correction_requested'
  | 'logbook_issue_reopened'
  | 'logbook_note_created'
  | 'logbook_announcement_created'
  | 'store_chat_mention'
  | 'store_chat_mention_all';

export interface Notification {
  id: string;
  recipientUserId: string;
  type: NotificationType | string;
  reportId: string;
  reportResponseId: string;
  storeId: string;
  title: string;
  body: string;
  itemTitle: string;
  completionPercent: number;
  compliancePercent: number;
  actionStatus: string;
  actorUserId: string;
  actorRole: string;
  readAt: string;
  createdAt: string;
  deliveryKey?: string;
  deepLinkJson?: string;
}

/** Per-user unread badge counter (notificationUnreadCounts entity). */
export interface NotificationUnreadCount {
  id: string;
  userId: string;
  unreadCount: number;
  updatedAt: string;
}

export type StoreChatMessageType =
  | 'text'
  | 'giphy_media'
  | 'text_giphy'
  | 'attachment'
  | 'text_attachment'
  | 'logbook_system'
  | 'report_system';
export type StoreChatMessageStatus = 'active' | 'deleted';
/** Phase 4 GIPHY kinds; '' when message has no media. */
export type StoreChatGiphyKind = 'gif' | 'sticker' | 'meme' | 'emoji' | '';
/** Chat attachment kinds; '' when none. */
export type StoreChatAttachmentKind = 'image' | 'file' | '';

/**
 * InstantDB storeChatMessages — room key is storeId.
 * Phase 4 giphy* / clientMutationId are additive (optional on read, '' on write).
 * Attachment fields are additive (optional on read, '' on write when unused).
 * Keep in sync with Phase 3 forwarded* fields when merging.
 */
export interface StoreChatMessage {
  id: string;
  storeId: string;
  senderUserId: string;
  senderProfileId: string;
  senderNameSnapshot: string;
  senderRoleSnapshot: string;
  messageType: StoreChatMessageType | string;
  body: string;
  createdAt: string;
  editedAt: string; // '' unused in v1
  deletedAt: string; // '' = active
  status: StoreChatMessageStatus | string;
  replyToMessageId: string; // '' unused in v1
  /** JSON string[] of Instant auth userIds; '[]' when none. */
  mentionedUserIdsJson?: string;
  /** True when the message @all'd everyone who can access the room. */
  mentionAll?: boolean;
  /** Phase 4 GIPHY — '' when text-only. */
  giphyId?: string;
  giphyKind?: StoreChatGiphyKind | string;
  giphyTitle?: string;
  giphyWidth?: string;
  giphyHeight?: string;
  giphyUrl?: string;
  giphyPreviewUrl?: string;
  /** Chat attachment — '' when unused. */
  attachmentKind?: StoreChatAttachmentKind | string;
  attachmentPath?: string;
  attachmentFileId?: string;
  attachmentUrl?: string;
  attachmentMimeType?: string;
  attachmentFileName?: string;
  attachmentBytes?: string;
  attachmentWidth?: string;
  attachmentHeight?: string;
  attachmentFile?: { id?: string; url?: string; path?: string };
  /** Source message id when this row is a forward; '' otherwise. */
  forwardedFromMessageId?: string;
  /** Original author userId when forwarded; '' otherwise. Forwarder is senderUserId. */
  forwardedFromUserId?: string;
  clientMutationId?: string;
  sourceType?: string;
  logbookEntryId?: string;
  /** Report id for report_system rows; '' otherwise. */
  reportId?: string;
  logbookEventType?: string;
  actionType?: string;
  /** Human CTA label when present on handoff rows; else derive from actionType. */
  requiredAction?: string;
  targetUserIdsJson?: string;
  deepLinkJson?: string;
  statusSnapshot?: string;
  chatDeliveryKey?: string;
  /** Linked sender profile when queried with `sender: { avatarFile: {} }`. */
  sender?: Pick<
    Profile,
    'id' | 'userId' | 'displayName' | 'email' | 'avatarUrl' | 'avatarPath' | 'avatarFile'
  >;
}

export type StoreChatReactionType = 'unicode' | 'giphy';

/** InstantDB storeChatReactions ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â room key is storeId. */
export interface StoreChatReaction {
  id: string;
  storeId: string;
  messageId: string;
  userId: string;
  reactionType: StoreChatReactionType | string;
  unicode: string;
  giphyId: string;
  giphyKind: string;
  giphyTitle: string;
  /** Display URL for animated reaction; '' when unicode. */
  giphyUrl?: string;
  giphyPreviewUrl?: string;
  createdAt: string;
  clientMutationId: string;
}

/** InstantDB storeChatBookmarks ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â per-viewer favorites; room key is storeId. */
export interface StoreChatBookmark {
  id: string;
  storeId: string;
  messageId: string;
  userId: string;
  createdAt: string;
}

export type GroupChatRoomKind = 'private' | 'store_ops_leadership';
export type GroupChatRoomStatus = 'active' | 'archived';
export type GroupChatRoomRole = 'owner' | 'admin' | 'member';
export type GroupChatInviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';
export type GroupChatMessageType =
  | 'text'
  | 'giphy_media'
  | 'text_giphy'
  | 'attachment'
  | 'text_attachment'
  | 'system';

/** InstantDB groupChatRooms — private invite-accept; room key is entity id. */
export interface GroupChatRoom {
  id: string;
  name: string;
  description: string;
  icon: string;
  privacy: 'private' | string;
  status: GroupChatRoomStatus | string;
  createdByUserId: string;
  createdByProfileId: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  similarNameKey: string;
  /** Missing or '' = private. Picker `kind` is unrelated. */
  roomKind?: GroupChatRoomKind | string;
  /** '' for private groups; store id for operations leadership rooms. */
  storeId?: string;
  store?: Store | Store[];
  members?: GroupChatMember[];
  invites?: GroupChatInvite[];
}

export interface GroupChatMember {
  id: string;
  roomId: string;
  userId: string;
  profileId: string;
  roomRole: GroupChatRoomRole | string;
  joinedAt: string;
  notificationMode: string;
  lastReadAt: string;
  muted: boolean;
  pinned: boolean;
  profile?: Pick<
    Profile,
    'id' | 'userId' | 'displayName' | 'email' | 'role' | 'avatarUrl' | 'avatarPath' | 'avatarFile' | 'stores'
  >;
  room?: GroupChatRoom;
}

export interface GroupChatInvite {
  id: string;
  roomId: string;
  inviteeUserId: string;
  inviteeProfileId: string;
  inviterUserId: string;
  inviterProfileId: string;
  status: GroupChatInviteStatus | string;
  historyMode: 'full' | string;
  roomNameSnapshot?: string;
  roomDescriptionSnapshot?: string;
  inviterNameSnapshot?: string;
  createdAt: string;
  respondedAt: string;
  expiresAt: string;
  room?: Pick<GroupChatRoom, 'id' | 'name' | 'description' | 'icon' | 'status' | 'privacy'>;
  invitee?: Pick<
    Profile,
    'id' | 'userId' | 'displayName' | 'email' | 'avatarUrl' | 'avatarPath' | 'avatarFile'
  >;
  inviter?: Pick<Profile, 'id' | 'userId' | 'displayName' | 'email'>;
}

export interface GroupChatMessage {
  id: string;
  roomId: string;
  senderUserId: string;
  senderProfileId: string;
  senderNameSnapshot: string;
  senderRoleSnapshot: string;
  messageType: GroupChatMessageType | string;
  body: string;
  createdAt: string;
  editedAt: string;
  deletedAt: string;
  status: string;
  replyToMessageId: string;
  mentionedUserIdsJson?: string;
  mentionAll?: boolean;
  giphyId?: string;
  giphyKind?: string;
  giphyTitle?: string;
  giphyWidth?: string;
  giphyHeight?: string;
  giphyUrl?: string;
  giphyPreviewUrl?: string;
  /** Chat attachment — '' when unused. */
  attachmentKind?: StoreChatAttachmentKind | string;
  attachmentPath?: string;
  attachmentFileId?: string;
  attachmentUrl?: string;
  attachmentMimeType?: string;
  attachmentFileName?: string;
  attachmentBytes?: string;
  attachmentWidth?: string;
  attachmentHeight?: string;
  attachmentFile?: { id?: string; url?: string; path?: string };
  /** Source message id when this row is a forward; '' otherwise. */
  forwardedFromMessageId?: string;
  /** Original author userId when forwarded; '' otherwise. Forwarder is senderUserId. */
  forwardedFromUserId?: string;
  clientMutationId?: string;
  sender?: Pick<
    Profile,
    'id' | 'userId' | 'displayName' | 'email' | 'avatarUrl' | 'avatarPath' | 'avatarFile'
  >;
}

/** InstantDB groupChatReactions — room key is roomId; membership-only. */
export interface GroupChatReaction {
  id: string;
  roomId: string;
  messageId: string;
  userId: string;
  reactionType: StoreChatReactionType | string;
  unicode: string;
  giphyId: string;
  giphyKind: string;
  giphyTitle: string;
  giphyUrl?: string;
  giphyPreviewUrl?: string;
  createdAt: string;
  clientMutationId: string;
}

/** InstantDB groupChatBookmarks — per-viewer favorites; room key is roomId. */
export interface GroupChatBookmark {
  id: string;
  roomId: string;
  messageId: string;
  userId: string;
  createdAt: string;
}

export type ExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ExportType = 'dashboard' | 'review_status' | 'failure_history';
export type ExportFormat = 'csv' | 'pdf';
export type ExportAuditStatus = 'requested' | 'completed' | 'failed' | 'downloaded';

export interface ExportJob {
  id: string;
  requesterUserId: string;
  exportType: ExportType;
  format: ExportFormat;
  status: ExportJobStatus;
  paramsJson: string;
  rowCount: number;
  truncated: boolean;
  warningHeader: string;
  filePath: string;
  downloadUrl: string;
  errorMessage: string;
  startedAt: string;
  completedAt: string;
  createdAt: string;
}

export interface ExportAuditLog {
  id: string;
  userId: string;
  role: Role;
  exportType: ExportType;
  format: ExportFormat;
  dateRangeJson: string;
  storeScopeJson: string;
  paramsJson: string;
  rowCount: number;
  truncated: boolean;
  jobId: string;
  status: ExportAuditStatus;
  downloadAt: string;
  createdAt: string;
}

// Local response state used during report submission wizard
export interface LocalResponse {
  ticked: boolean;
  numberValue: string;
  note: string;
  mediaItems: UploadedMedia[];
}

export interface UploadedMedia {
  mediaRecordId: string;
  fileId: string;
  url: string;
  fileName: string;
  photoCode: string;
  capturedAt: string;
  mimeType?: string;
}
