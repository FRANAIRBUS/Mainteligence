import type { Timestamp } from "firebase/firestore";

export interface BaseEntity {
  id: string;
  organizationId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Organization extends BaseEntity {
  name: string;
  taxId?: string;
  subscriptionPlan: "trial" | "standard" | "enterprise";
  isActive: boolean;
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
  | 'maintenance'
  | 'dept_head_multi'
  | 'dept_head_single'
  | 'operator'
  | 'operario'
  | 'mantenimiento';

export interface User extends BaseEntity {
  displayName: string;
  email: string;
  role: UserRole;
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
  status: 'active' | 'pending' | 'revoked';
  organizationName?: string;
  primary?: boolean;
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
