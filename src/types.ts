// Shared domain types derived from the schema's shape.

export type Role = string;

export const OWNER_ROLE_KEY = 'owner';
export const AREA_MANAGER_ROLE_KEY = 'areaManager';

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

export interface CameraOptions {
  weatherEnabled: boolean;
  logoEnabled: boolean;
  flashlightLastUsed: boolean;
  watermarkStyle?: WatermarkStyle;
  watermarkConfig?: UltimateWatermarkConfig;
  timecardConfig?: TimecardWatermarkConfig;
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
  createdAt: string;
  updatedAt: string;
  cameraOptionsJson?: string;
  roleDefinition?: RoleDefinition;
  // Optional linked data from useQuery:
  stores?: Store[];
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
  store?: Store;
  photo?: { id: string; url: string };
}

export type ReviewEventType =
  | 'submitted'
  | 'resubmitted'
  | 'item_approved'
  | 'item_rejected'
  | 'item_correction'
  | 'report_finalized';

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
}

export type NotificationType =
  | 'item_approved'
  | 'item_rejected'
  | 'item_correction'
  | 'report_finalized';

export interface Notification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
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
