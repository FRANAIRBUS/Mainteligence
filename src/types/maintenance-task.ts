import type { Timestamp } from "firebase/firestore";
import type { BaseEntity, ReportEntry } from "@/lib/firebase/models";

export type TaskStatus = "pendiente" | "en_progreso" | "completada";
export type TaskPriority = "alta" | "media" | "baja";

export interface MaintenanceTask extends BaseEntity {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Timestamp | null;
  assignedTo?: string;
  location?: string;
  category?: string;
  createdBy?: string;
  reports?: ReportEntry[];
  reopened?: boolean;
  reopenedBy?: string;
  reopenedAt?: Timestamp;
}

export type MaintenanceTaskInput = Omit<
  MaintenanceTask,
  "id" | "createdAt" | "updatedAt" | "organizationId"
>;
