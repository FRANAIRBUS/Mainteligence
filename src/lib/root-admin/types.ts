'use client';

import type { FieldValue, Timestamp } from 'firebase/firestore';

export type OrganizationLifecycleStatus =
  | 'active'
  | 'suspended'
  | 'deleted_soft'
  | 'deleted_hard';

export interface RootOrganization {
  id: string;
  name: string;
  taxId?: string;
  subscriptionPlan?: 'trial' | 'standard' | 'enterprise';
  status: OrganizationLifecycleStatus;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  deletedAt?: Timestamp | FieldValue | null;
  suspendedAt?: Timestamp | FieldValue | null;
  ownerEmail?: string;
  userCount?: number;
  settings?: {
    allowGuestAccess?: boolean;
    maxUsers?: number;
    locale?: string;
    timezone?: string;
    logoUrl?: string;
  };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  targetId: string;
  targetType: 'organization' | 'impersonation_token' | 'user';
  actorId: string;
  actorEmail?: string | null;
  actorName?: string | null;
  message?: string;
  status: 'success' | 'error';
  createdAt?: Timestamp | FieldValue;
  metadata?: Record<string, unknown>;
}

export interface ImpersonationToken {
  id: string;
  organizationId: string;
  userId: string;
  expiresAt: Timestamp;
  createdAt?: Timestamp | FieldValue;
  createdBy: string;
  createdByEmail?: string | null;
  createdByName?: string | null;
  reason?: string;
  active: boolean;
}
