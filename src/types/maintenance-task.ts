import type { Timestamp } from "firebase/firestore";

export type TaskStatus = "pendiente" | "en_progreso" | "completada";
export type TaskPriority = "alta" | "media" | "baja";

export interface MaintenanceTask {
  id?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Timestamp | null;
  assignedTo?: string;
  location?: string;
  category?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type MaintenanceTaskInput = Omit<MaintenanceTask, "id" | "createdAt" | "updatedAt">;
