import type { ReportEntry } from "@/types/report-entry";

export type User = {
  id: string;
  displayName: string;
  email: string;
  role: 'operario' | 'mantenimiento' | 'admin';
  departmentId?: string;
  isMaintenanceLead: boolean;
  active: boolean;
  siteIds?: string[];
  createdAt: any; // Timestamp
  updatedAt: any; // Timestamp
};

export type Site = {
  id: string;
  name: string;
  code: string;
};

export type Department = {
  id: string;
  name: string;
  code: string;
};

export type Asset = {
  id: string;
  name: string;
  code: string;
  siteId: string;
};

export type Ticket = {
  id: string;
  displayId: string;
  type: 'correctivo' | 'preventivo';
  status: 'Abierta' | 'En curso' | 'En espera' | 'Resuelta' | 'Cerrada';
  priority: 'Baja' | 'Media' | 'Alta' | 'Crítica';
  siteId: string;
  departmentId: string;
  assetId?: string;
  title: string;
  description: string;
  createdBy: string;
  assignedRole?: string;
  assignedTo?: string | null;
  photoUrls?: string[];
  createdAt: any; // Timestamp
  updatedAt: any; // Timestamp
  closedAt?: any; // Timestamp
  closedBy?: string;
  waiting?: {
    reason: string;
    detail: string;
    eta?: any; // Timestamp
  };
  lastCommentAt?: any; // Timestamp
  reportPdfUrl?: string;
  emailSentAt?: any; // Timestamp
  templateId?: string;
  templateSnapshot?: {
    name: string;
    frequencyDays: number;
  };
  preventive?: {
    frequencyDays: number;
    scheduledFor: any; // Timestamp
    checklist: any[];
  };
  reports?: ReportEntry[];
};
