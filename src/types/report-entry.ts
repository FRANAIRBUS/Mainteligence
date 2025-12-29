import type { Timestamp } from "firebase/firestore";

export type ReportEntry = {
  description: string;
  createdAt: Timestamp;
  createdBy?: string;
};
