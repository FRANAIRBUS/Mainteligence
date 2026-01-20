import type { Timestamp } from "firebase/firestore";
import type { ReportEntry } from "./report-entry";
import type { TaskStatus } from "@/lib/status";

export type TaskType = "ops" | "maintenance";
export type TaskPriority = "alta" | "media" | "baja";

export interface MaintenanceTask {
  id?: string;
  organizationId: string; // <--- Campo obligatorio para multi-tenant
  title: string;
  description?: string;
  status: TaskStatus;
  taskType: TaskType;
  priority: TaskPriority;
  dueDate: Timestamp | null;
  assignedTo?: string;
  location?: string;
  locationId?: string;
  category?: string;
  createdBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  closedAt?: Timestamp;
  closedBy?: string;
  closedReason?: string;
  reports?: ReportEntry[];
}

export type MaintenanceTaskInput = Omit<MaintenanceTask, "id" | "createdAt" | "updatedAt">;
