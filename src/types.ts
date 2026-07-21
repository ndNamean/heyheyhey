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

// Profile shape (from db.useQuery result — fields only, no links)
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
  /** Custom profile photo URL; empty/missing = initials avatar. */
  avatarUrl?: string;
  roleDefinition?: RoleDefinition;
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
  /** Additive schedule fields — blank when unscheduled */
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

export type LogbookIssueStatus = 'open' | 'in_progress' | 'waiting_approval' | 'resolved';

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
  entryType?: LogbookEntryType | string;
  assigneeRole?: Role | string;
  dueAt?: string;
  status?: LogbookIssueStatus | string;
  startedAt?: string;
  startedByUserId?: string;
  resolutionNote?: string;
  resolutionSubmittedAt?: string;
  resolutionSubmittedByUserId?: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
  reviewedAt?: string;
  reviewedByUserId?: string;
  reviewNote?: string;
  reopenedAt?: string;
  reopenedByUserId?: string;
  reopenReason?: string;
  dueSoonNotifiedAt?: string;
  overdueNotifiedAt?: string;
  store?: Store;
  photo?: { id: string; url: string };
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
  | 'logbook_issue_assigned'
  | 'logbook_issue_due_soon'
  | 'logbook_issue_overdue'
  | 'logbook_resolution_submitted'
  | 'logbook_resolution_approved'
  | 'logbook_resolution_rejected'
  | 'logbook_issue_reopened';

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
