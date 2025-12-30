import type { ReportEntry } from "@/types/report-entry";
import type { Timestamp } from "firebase/firestore";

export interface BaseEntity {
  id: string;
  organizationId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Organization extends BaseEntity {
  name: string;
  plan: {
    name: string;
    seats?: number;
    expiresAt?: Timestamp;
  };
  settings: {
    locale?: string;
    timezone?: string;
    logoUrl?: string;
  };
}

export interface User extends BaseEntity {
  displayName: string;
  email: string;
  role: "operario" | "mantenimiento" | "admin";
  departmentId?: string;
  isMaintenanceLead: boolean;
  active: boolean;
  siteIds?: string[];
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
  status: "Abierta" | "En curso" | "En espera" | "Resuelta" | "Cerrada";
  priority: "Baja" | "Media" | "Alta" | "Crítica";
  siteId: string;
  departmentId: string;
  assetId?: string;
  title: string;
  description: string;
  createdBy: string;
  assignedRole?: string;
  assignedTo?: string | null;
  photoUrls?: string[];
  closedAt?: Timestamp;
  closedBy?: string;
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
