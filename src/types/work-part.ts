export type WorkPartEntry = {
  id: string;
  assetId?: string | null;
  assetName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  technicianId?: string | null;
  technicianName?: string | null;
  hours: number;
  cost: number;
  currency: string;
  loggedAt: Date;
  notes?: string | null;
};

export type WorkPartSummary = {
  totalHours: number;
  totalCost: number;
  byAsset: Array<{
    assetId: string;
    assetName?: string | null;
    hours: number;
    cost: number;
  }>;
  byDepartment: Array<{
    departmentId: string;
    departmentName?: string | null;
    hours: number;
    cost: number;
  }>;
};
