import type { Timestamp } from "firebase/firestore";
import type { ReportEntry } from "./report-entry";

export type TaskStatus = "pendiente" | "en_progreso" | "completada";
export type TaskPriority = "alta" | "media" | "baja";

export interface MaintenanceTask {
  id?: string;
  organizationId: string; // <--- Campo obligatorio para multi-tenant
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Timestamp | null;
  assignedTo?: string;
  location?: string;
  category?: string;
  createdBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  reports?: ReportEntry[];
}

export type MaintenanceTaskInput = Omit<MaintenanceTask, "id" | "createdAt" | "updatedAt">;
