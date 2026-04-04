import type { Timestamp } from "firebase/firestore";

export interface BaseEntity {
  id: string;
  organizationId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type WorkOrderStatus = "open" | "in_progress" | "closed";
export type WorkOrderKind = "preventive";

export interface WorkOrder extends BaseEntity {
  kind: WorkOrderKind;
  status: WorkOrderStatus;
  isOpen: boolean;
  priority?: "Baja" | "Media" | "Alta" | "Crítica";
  siteId?: string | null;
  departmentId?: string | null;
  assetId?: string | null;
  title: string;
  description?: string;
  createdBy?: string;
  assignedTo?: string | null;
  preventiveTemplateId?: string;
  templateSnapshot?: {
    name: string;
    frequencyDays: number;
  };
  preventive?: {
    frequencyDays: number;
    scheduledFor: Timestamp;
  };
  checklistRequired?: boolean;
  startedAt?: Timestamp | null;
  startedBy?: string | null;
  closedAt?: Timestamp | null;
  closedBy?: string | null;
}

export interface WorkOrderChecklistItem {
  id: string;
  organizationId: string;
  label: string;
  required: boolean;
  order: number;
  done: boolean;
  doneAt?: Timestamp | null;
  doneBy?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}


export type OrganizationType = "demo" | "standard" | "enterprise" | "partner";
export type OrganizationStatus = "active" | "suspended" | "deleted";
export type SubscriptionPlan = "trial" | "standard" | "enterprise";
export type EntitlementPlanId = "free" | "basic" | "starter" | "pro" | "enterprise";
export type EntitlementStatus = "trialing" | "active" | "past_due" | "canceled";
export type EntitlementProvider = "stripe" | "google_play" | "apple_app_store" | "manual";
export type EntitlementFeature = "EXPORT_PDF" | "AUDIT_TRAIL" | "PREVENTIVES";
export type MembershipStatus = "active" | "pending" | "revoked";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface EntitlementLimits {
  maxSites: number;
  maxAssets: number;
  maxDepartments: number;
  maxUsers: number;
  maxActivePreventives: number;
  attachmentsMonthlyMB: number;
  maxOpenTickets: number;
  maxOpenTasks: number;
  maxAttachmentMB: number;
  maxAttachmentsPerTicket: number;
  retentionDays: number;
}

export interface EntitlementUsage {
  sitesCount: number;
  assetsCount: number;
  departmentsCount: number;
  usersCount: number;
  activePreventivesCount: number;
  attachmentsThisMonthMB: number;
  openTicketsCount: number;
  openTasksCount: number;
}

export interface Entitlement {
  planId: EntitlementPlanId;
  status: EntitlementStatus;
  provider: EntitlementProvider;
  trialEndsAt?: Timestamp;
  currentPeriodEnd?: Timestamp;
  updatedAt: Timestamp;
  limits: EntitlementLimits;
  usage: EntitlementUsage;
}

export interface BillingProviderEntitlement {
  planId: EntitlementPlanId;
  status: EntitlementStatus;
  trialEndsAt?: Timestamp;
  currentPeriodEnd?: Timestamp;
  updatedAt: Timestamp;
  conflict?: boolean;
  conflictReason?: string;
}

export interface PlanCatalogEntry {
  planId: EntitlementPlanId;
  limits: EntitlementLimits;
  features: Record<EntitlementFeature, boolean>;
  updatedAt: Timestamp;
}

export interface Organization extends BaseEntity {
  name: string;
  taxId?: string;
  subscriptionPlan: SubscriptionPlan;
  isActive: boolean;
  demoExpiresAt?: Timestamp;
  type?: OrganizationType;
  status?: OrganizationStatus;
  billingEmail?: string | null;
  modulesEnabled?: string[];
  entitlement?: Entitlement;
  billingProviders?: Partial<Record<EntitlementProvider, BillingProviderEntitlement>>;
  preventivesPausedByEntitlement?: boolean;
  preventivesPausedAt?: Timestamp;
  settings: {
    allowGuestAccess: boolean;
    maxUsers: number;
    locale?: string;
    timezone?: string;
    logoUrl?: string;
  };
}

export interface ReportEntry extends BaseEntity {
  description: string;
  createdBy?: string;
}

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'mantenimiento'
  | 'jefe_departamento'
  | 'jefe_ubicacion'
  | 'operario'
  | 'auditor'
  | 'maintenance'
  | 'dept_head_multi'
  | 'dept_head_single'
  | 'operator';

export interface User extends BaseEntity {
  displayName: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  departmentId?: string;
  departmentIds?: string[];
  locationId?: string;
  locationIds?: string[];
  siteId?: string;
  isMaintenanceLead: boolean;
  active: boolean;
  siteIds?: string[];
  adminRequestPending?: boolean;
}

export interface Membership extends BaseEntity {
  userId: string;
  role: User['role'];
  status: MembershipStatus;
  organizationName?: string;
  primary?: boolean;
  invitedBy?: string;
  invitedAt?: Timestamp;
  acceptedAt?: Timestamp;
}

export interface OrganizationMember {
  id: string;
  uid?: string;
  orgId?: string;
  organizationId?: string;
  email?: string | null;
  displayName?: string | null;
  role?: UserRole | null;
  departmentId?: string | null;
  departmentIds?: string[] | null;
  locationId?: string | null;
  locationIds?: string[] | null;
  siteId?: string | null;
  siteIds?: string[] | null;
  isMaintenanceLead?: boolean;
  active?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Invitation extends BaseEntity {
  invitedEmail: string;
  role: User['role'];
  status: InvitationStatus;
  invitedBy: string;
  expiresAt?: Timestamp | null;
  acceptedAt?: Timestamp | null;
}

export interface Site extends BaseEntity {
  name: string;
  code: string;
}

export interface Department extends BaseEntity {
  name: string;
  code: string;
}

export type IotPanelType = "thermostat" | "sensor" | "relay";
export type IotConnectionStatus = "online" | "offline" | "warning";

export interface AssetIotRelay {
  label: string;
  active: boolean;
}

export interface AssetIotReading {
  readingAt?: Timestamp | Date | string | number | null;
  temperature?: number | string | null;
  secondaryTemperature?: number | string | null;
  humidity?: number | string | null;
  setpoint?: number | string | null;
  power?: boolean | null;
  mode?: string | null;
  fan?: string | null;
  status?: IotConnectionStatus | null;
  alarms?: string[] | null;
  relays?: AssetIotRelay[] | null;
  raw?: Record<string, unknown> | null;
}

export interface AssetIotDesiredState {
  version?: number | null;
  requestedAt?: Timestamp | Date | string | number | null;
  requestedBy?: string | null;
  power?: boolean | null;
  mode?: string | null;
  fan?: string | null;
  setpoint?: number | null;
  setpoint2?: number | null;
  differentialX10?: number | null;
  highAlarmX10?: number | null;
  lowAlarmX10?: number | null;
  tempAlarmDelayMin?: number | null;
  controlPeriodMs?: number | null;
  defrostIntervalMin?: number | null;
  defrostDurationMin?: number | null;
  defrostStopX10?: number | null;
  stopRelay1OnDefrost?: boolean | null;
  stopRelay2OnDefrost?: boolean | null;
  relay2Mode?: number | null;
  relay3Mode?: number | null;
  relays?: Record<string, boolean> | null;
  note?: string | null;
}

export interface AssetIotReportedState extends AssetIotReading {
  firmwareVersion?: string | null;
  ipAddress?: string | null;
  uptimeSeconds?: number | null;
  appliedDesiredVersion?: number | null;
  applyStatus?: "idle" | "applied" | "partial" | "rejected" | "error" | null;
  applyMessage?: string | null;
}

export interface AssetIotProvisioning {
  bootstrapPending?: boolean;
  bootstrapExpiresAt?: Timestamp | Date | string | number | null;
  bootstrapIssuedAt?: Timestamp | Date | string | number | null;
  bootstrapIssuedBy?: string | null;
  bootstrappedAt?: Timestamp | Date | string | number | null;
  lastSyncAt?: Timestamp | Date | string | number | null;
}

export interface AssetIotPanelDisplayConfig {
  probeUnits?: [string, string, string, string] | string[];
  humidityUnit?: string;
  setpointUnit?: string;
  relayLabels?: Record<string, string>;
}

export interface AssetIotConfig {
  enabled: boolean;
  panelType: IotPanelType;
  deviceKey: string;
  locationLabel?: string;
  dataSource?: "firestore" | "mysql_bridge" | "maintelligence_api";
  capabilities?: string[];
  lastSeenAt?: Timestamp | Date | string | number | null;
  lastReading?: AssetIotReading | null;
  reportedState?: AssetIotReportedState | null;
  desiredState?: AssetIotDesiredState | null;
  provisioning?: AssetIotProvisioning | null;
  panelDisplayConfig?: AssetIotPanelDisplayConfig | null;
  panelDisplayConfigUpdatedAt?: Timestamp | Date | string | number | null;
}

export interface Asset extends BaseEntity {
  name: string;
  code: string;
  siteId: string;
  iot?: AssetIotConfig | null;
}

export type PreventiveScheduleType = "daily" | "weekly" | "monthly" | "date";
export type PreventiveTemplateStatus = "active" | "paused" | "archived";

export interface PreventiveSchedule {
  type: PreventiveScheduleType;
  timezone?: string;
  timeOfDay?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  date?: Timestamp;
  nextRunAt?: Timestamp;
  lastRunAt?: Timestamp;
}

export interface PreventiveChecklistItem {
  label: string;
  required: boolean;
  order?: number;
}

export interface PreventiveTemplate extends BaseEntity {
  name: string;
  description?: string;
  status: PreventiveTemplateStatus;
  pausedReason?: string;
  automatic: boolean;
  schedule: PreventiveSchedule;
  priority: Ticket["priority"];
  siteId?: string;
  departmentId?: string;
  assetId?: string;
  checklist?: PreventiveChecklistItem[];
  createdBy: string;
  updatedBy?: string;
}

export interface Ticket extends BaseEntity {
  displayId: string;
  type: "correctivo" | "preventivo";
  status:
    | "new"
    | "in_progress"
    | "resolved"
    | "canceled"
    | "assigned"
    | "closed"
    | "waiting_parts"
    | "waiting_external"
    | "reopened"
    | "Abierta"
    | "En curso"
    | "En espera"
    | "Resuelta"
    | "Cierre solicitado"
    | "Cerrada";
  priority: "Baja" | "Media" | "Alta" | "Crítica";
  siteId: string;
  locationId?: string;
  departmentId: string;
  originDepartmentId?: string;
  targetDepartmentId?: string;
  assetId?: string;
  title: string;
  description: string;
  createdBy: string;
  createdByName?: string;
  assignedRole?: string;
  assignedTo?: string | null;
  photoUrls?: string[];
  closedAt?: Timestamp;
  closedBy?: string;
  closedReason?: string;
  closureRequestedBy?: string;
  closureRequestedAt?: Timestamp;
  waiting?: {
    reason: string;
    detail: string;
    eta?: Timestamp;
  };
  lastCommentAt?: Timestamp;
  reportPdfUrl?: string;
  emailSentAt?: Timestamp;
  templateId?: string;
  preventiveTemplateId?: string;
  templateSnapshot?: {
    name: string;
    frequencyDays: number;
  };
  preventive?: {
    frequencyDays: number;
    scheduledFor: Timestamp;
    checklist: unknown[];
  };
  reports?: ReportEntry[];
  reopened?: boolean;
  reopenedBy?: string;
  reopenedAt?: Timestamp;
}




