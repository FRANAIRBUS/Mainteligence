import type { Timestamp } from "firebase/firestore";

export interface BaseEntity {
  id: string;
  organizationId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type OrganizationType = "demo" | "standard" | "enterprise" | "partner";
export type OrganizationStatus = "active" | "suspended" | "deleted";
export type SubscriptionPlan = "trial" | "standard" | "enterprise";
export type EntitlementPlanId = "free" | "starter" | "pro" | "enterprise";
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
}

export interface EntitlementUsage {
  sitesCount: number;
  assetsCount: number;
  departmentsCount: number;
  usersCount: number;
  activePreventivesCount: number;
  attachmentsThisMonthMB: number;
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

export interface Asset extends BaseEntity {
  name: string;
  code: string;
  siteId: string;
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

export interface PreventiveTemplate extends BaseEntity {
  name: string;
  description?: string;
  status: PreventiveTemplateStatus;
  automatic: boolean;
  schedule: PreventiveSchedule;
  priority: Ticket["priority"];
  siteId?: string;
  departmentId?: string;
  assetId?: string;
  checklist?: unknown[];
  createdBy: string;
  updatedBy?: string;
}

export interface Ticket extends BaseEntity {
  displayId: string;
  type: "correctivo" | "preventivo";
  status:
    | "Abierta"
    | "En curso"
    | "En espera"
    | "Resuelta"
    | "Cierre solicitado"
    | "Cerrada";
  priority: "Baja" | "Media" | "Alta" | "Crítica";
  siteId: string;
  departmentId: string;
  originDepartmentId?: string;
  targetDepartmentId?: string;
  assetId?: string;
  title: string;
  description: string;
  createdBy: string;
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
