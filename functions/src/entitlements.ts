import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}
type EntitlementPlanId = 'free' | 'starter' | 'pro' | 'enterprise';
type EntitlementFeature = 'EXPORT_PDF' | 'AUDIT_TRAIL' | 'PREVENTIVES';

type EntitlementLimits = {
  maxSites: number;
  maxAssets: number;
  maxDepartments: number;
  maxUsers: number;
  maxActivePreventives: number;
  attachmentsMonthlyMB: number;
};

type EntitlementUsage = {
  sitesCount: number;
  assetsCount: number;
  departmentsCount: number;
  usersCount: number;
  activePreventivesCount: number;
  attachmentsThisMonthMB: number;
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
  starter: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
  pro: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
  enterprise: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
};

const DEFAULT_PLAN_LIMITS: Record<EntitlementPlanId, EntitlementLimits> = {
  free: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 3, attachmentsMonthlyMB: 1024 },
  starter: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 25, attachmentsMonthlyMB: 1024 },
  pro: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 100, attachmentsMonthlyMB: 1024 },
  enterprise: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 1000, attachmentsMonthlyMB: 1024 },
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
): EntitlementLimits => ({
  ...(DEFAULT_PLAN_LIMITS[planId] ?? DEFAULT_PLAN_LIMITS.free),
  ...(limits ?? {}),
});


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
