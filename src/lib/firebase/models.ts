export type User = {
  id: string;
  displayName: string;
  email: string;
  role: 'operario' | 'mantenimiento' | 'admin';
  isMaintenanceLead: boolean;
  active: boolean;
  siteIds?: string[];
  createdAt: any; // Timestamp
  updatedAt: any; // Timestamp
};
