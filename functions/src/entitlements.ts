import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}
type EntitlementPlanId = 'free' | 'basic' | 'starter' | 'pro' | 'enterprise';
type EntitlementFeature = 'EXPORT_PDF' | 'AUDIT_TRAIL' | 'PREVENTIVES';

type EntitlementLimits = {
  maxSites: number;
  maxAssets: number;
  maxDepartments: number;
  maxUsers: number;
  maxActivePreventives: number;
  attachmentsMonthlyMB: number;
  maxOpenTickets: number;
  maxOpenTasks: number;
  maxAttachmentMB: number;
  maxAttachmentsPerTicket: number;
  retentionDays: number;
};

type EntitlementUsage = {
  sitesCount: number;
  assetsCount: number;
  departmentsCount: number;
  usersCount: number;
  activePreventivesCount: number;
  attachmentsThisMonthMB: number;
  openTicketsCount: number;
  openTasksCount: number;
};

type Entitlement = {
  planId: EntitlementPlanId;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  provider: 'stripe' | 'google_play' | 'apple_app_store' | 'manual';
  trialEndsAt?: admin.firestore.Timestamp;
  currentPeriodEnd?: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  limits: EntitlementLimits;
  usage: EntitlementUsage;
};

export type BillingProviderEntitlement = {
  planId: EntitlementPlanId;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  trialEndsAt?: admin.firestore.Timestamp;
  currentPeriodEnd?: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  conflict?: boolean;
  conflictReason?: string;
};

type Organization = {
  entitlement?: Entitlement;
  billingProviders?: Partial<
    Record<'stripe' | 'google_play' | 'apple_app_store' | 'manual', BillingProviderEntitlement>
  >;
};

type PlanCatalogEntry = {
  planId: EntitlementPlanId;
  limits: EntitlementLimits;
  features: Record<EntitlementFeature, boolean>;
  updatedAt: admin.firestore.Timestamp;
};

export type EntitlementWithFeatures = Entitlement & {
  features?: Record<EntitlementFeature, boolean>;
};

export type EntitlementCreateKind =
  | 'assets'
  | 'sites'
  | 'departments'
  | 'users'
  | 'preventives';

const db = admin.firestore();

const DEFAULT_PLAN_FEATURES: Record<EntitlementPlanId, Record<EntitlementFeature, boolean>> = {
  free: { EXPORT_PDF: false, AUDIT_TRAIL: false, PREVENTIVES: false },
  basic: { EXPORT_PDF: false, AUDIT_TRAIL: false, PREVENTIVES: false },
  starter: { EXPORT_PDF: true, AUDIT_TRAIL: false, PREVENTIVES: true },
  pro: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
  enterprise: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
};

const DEFAULT_PLAN_LIMITS: Record<EntitlementPlanId, EntitlementLimits> = {
  free: {
    maxUsers: 2,
    maxSites: 1,
    maxDepartments: 3,
    maxAssets: 1,
    maxActivePreventives: 0,
    maxOpenTickets: 10,
    maxOpenTasks: 10,
    attachmentsMonthlyMB: 0,
    maxAttachmentMB: 0,
    maxAttachmentsPerTicket: 0,
    retentionDays: 0,
  },
  basic: {
    maxUsers: 5,
    maxSites: 2,
    maxDepartments: 5,
    maxAssets: 5,
    maxActivePreventives: 0,
    maxOpenTickets: 50,
    maxOpenTasks: 50,
    attachmentsMonthlyMB: 0,
    maxAttachmentMB: 0,
    maxAttachmentsPerTicket: 0,
    retentionDays: 0,
  },
  starter: {
    maxUsers: 10,
    maxSites: 5,
    maxDepartments: 15,
    maxAssets: 200,
    maxActivePreventives: 50,
    maxOpenTickets: 200,
    maxOpenTasks: 200,
    attachmentsMonthlyMB: 500,
    maxAttachmentMB: 10,
    maxAttachmentsPerTicket: 10,
    retentionDays: 180,
  },
  pro: {
    maxUsers: 25,
    maxSites: 15,
    maxDepartments: 50,
    maxAssets: 1000,
    maxActivePreventives: 250,
    maxOpenTickets: 1000,
    maxOpenTasks: 1000,
    attachmentsMonthlyMB: 5000,
    maxAttachmentMB: 25,
    maxAttachmentsPerTicket: 25,
    retentionDays: 365,
  },
  enterprise: {
    maxUsers: 10_000,
    maxSites: 10_000,
    maxDepartments: 10_000,
    maxAssets: 1_000_000,
    maxActivePreventives: 100_000,
    maxOpenTickets: 1_000_000,
    maxOpenTasks: 1_000_000,
    attachmentsMonthlyMB: 100_000,
    maxAttachmentMB: 100,
    maxAttachmentsPerTicket: 100,
    retentionDays: 3650,
  },
};

const resolveEffectivePlanFeatures = (
  planId: EntitlementPlanId,
  features?: Partial<Record<EntitlementFeature, boolean>> | null
): Record<EntitlementFeature, boolean> => ({
  ...(DEFAULT_PLAN_FEATURES[planId] ?? DEFAULT_PLAN_FEATURES.free),
  ...(features ?? {}),
});

const resolveEffectivePlanLimits = (
  planId: EntitlementPlanId,
  limits?: Partial<EntitlementLimits> | null
): EntitlementLimits => {
  const defaults = DEFAULT_PLAN_LIMITS[planId] ?? DEFAULT_PLAN_LIMITS.free;
  if (!limits) return defaults;

  const coalesceLimit = (key: keyof EntitlementLimits) => {
    const rawValue = limits[key];
    if (typeof rawValue !== 'number') {
      return defaults[key];
    }
    if (rawValue <= 0 && defaults[key] > 0 && !['free', 'basic'].includes(planId)) {
      return defaults[key];
    }
    if (rawValue < defaults[key] && !['free', 'basic'].includes(planId)) {
      return defaults[key];
    }
    return rawValue;
  };

  return {
    maxUsers: coalesceLimit('maxUsers'),
    maxSites: coalesceLimit('maxSites'),
    maxDepartments: coalesceLimit('maxDepartments'),
    maxAssets: coalesceLimit('maxAssets'),
    maxActivePreventives: coalesceLimit('maxActivePreventives'),
    maxOpenTickets: coalesceLimit('maxOpenTickets'),
    maxOpenTasks: coalesceLimit('maxOpenTasks'),
    attachmentsMonthlyMB: coalesceLimit('attachmentsMonthlyMB'),
    maxAttachmentMB: coalesceLimit('maxAttachmentMB'),
    maxAttachmentsPerTicket: coalesceLimit('maxAttachmentsPerTicket'),
    retentionDays: coalesceLimit('retentionDays'),
  };
};


export const getOrgEntitlement = async (orgId: string): Promise<EntitlementWithFeatures | null> => {
  if (!orgId) return null;

  const orgSnap = await db.collection('organizations').doc(orgId).get();
  if (!orgSnap.exists) return null;

  const orgData = orgSnap.data() as Organization;
  const entitlement = orgData?.entitlement ?? null;
  if (!entitlement) return null;

  const planCatalogSnap = await db.collection('planCatalog').doc(entitlement.planId).get();
  const planCatalogData = planCatalogSnap.exists ? (planCatalogSnap.data() as PlanCatalogEntry) : null;

  return {
    ...entitlement,
    limits: resolveEffectivePlanLimits(entitlement.planId, planCatalogData?.limits ?? entitlement.limits),
    features: resolveEffectivePlanFeatures(entitlement.planId, planCatalogData?.features ?? undefined),
  };
};

export const isFeatureEnabled = (
  entitlement: EntitlementWithFeatures | null | undefined,
  feature: EntitlementFeature
): boolean => {
  if (!entitlement) return false;
  return entitlement.features?.[feature] === true;
};

export const canCreate = (
  kind: EntitlementCreateKind,
  usage: EntitlementUsage | null | undefined,
  limits: EntitlementLimits | null | undefined
): boolean => {
  if (!usage || !limits) return false;

  const withinLimit = (current: number, max: number) =>
    Number.isFinite(max) ? current < max : true;

  switch (kind) {
    case 'sites':
      return withinLimit(usage.sitesCount, limits.maxSites);
    case 'assets':
      return withinLimit(usage.assetsCount, limits.maxAssets);
    case 'departments':
      return withinLimit(usage.departmentsCount, limits.maxDepartments);
    case 'users':
      return withinLimit(usage.usersCount, limits.maxUsers);
    case 'preventives':
      return withinLimit(usage.activePreventivesCount, limits.maxActivePreventives);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
};
