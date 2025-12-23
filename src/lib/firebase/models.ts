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
