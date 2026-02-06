import { doc, getDoc, type Firestore } from "firebase/firestore";
import type {
  Entitlement,
  EntitlementFeature,
  EntitlementLimits,
  EntitlementUsage,
  Organization,
  PlanCatalogEntry,
} from "@/lib/firebase/models";

const DEFAULT_PLAN_FEATURES: Record<
  Entitlement["planId"],
  Record<EntitlementFeature, boolean>
> = {
  free: {
    EXPORT_PDF: false,
    AUDIT_TRAIL: false,
    PREVENTIVES: false,
  },
  starter: {
    EXPORT_PDF: true,
    AUDIT_TRAIL: true,
    PREVENTIVES: true,
  },
  pro: {
    EXPORT_PDF: true,
    AUDIT_TRAIL: true,
    PREVENTIVES: true,
  },
  enterprise: {
    EXPORT_PDF: true,
    AUDIT_TRAIL: true,
    PREVENTIVES: true,
  },
};

const DEFAULT_PLAN_LIMITS: Record<Entitlement["planId"], EntitlementLimits> = {
  free: {
    maxSites: 100,
    maxAssets: 5000,
    maxDepartments: 100,
    maxUsers: 50,
    maxActivePreventives: 3,
    attachmentsMonthlyMB: 1024,
  },
  starter: {
    maxSites: 100,
    maxAssets: 5000,
    maxDepartments: 100,
    maxUsers: 50,
    maxActivePreventives: 25,
    attachmentsMonthlyMB: 1024,
  },
  pro: {
    maxSites: 100,
    maxAssets: 5000,
    maxDepartments: 100,
    maxUsers: 50,
    maxActivePreventives: 100,
    attachmentsMonthlyMB: 1024,
  },
  enterprise: {
    maxSites: 100,
    maxAssets: 5000,
    maxDepartments: 100,
    maxUsers: 50,
    maxActivePreventives: 1000,
    attachmentsMonthlyMB: 1024,
  },
};

export const getDefaultPlanFeatures = (
  planId?: Entitlement["planId"] | string
): Record<EntitlementFeature, boolean> => {
  const normalized = String(planId ?? "").trim() as Entitlement["planId"];
  return DEFAULT_PLAN_FEATURES[normalized] ?? DEFAULT_PLAN_FEATURES.free;
};

export const getDefaultPlanLimits = (
  planId?: Entitlement["planId"] | string
): EntitlementLimits => {
  const normalized = String(planId ?? "").trim() as Entitlement["planId"];
  return DEFAULT_PLAN_LIMITS[normalized] ?? DEFAULT_PLAN_LIMITS.free;
};

export const resolveEffectivePlanFeatures = (
  planId: Entitlement["planId"],
  rawFeatures?: Partial<Record<EntitlementFeature, boolean>> | null
): Record<EntitlementFeature, boolean> => ({
  ...getDefaultPlanFeatures(planId),
  ...(rawFeatures ?? {}),
});

export const resolveEffectivePlanLimits = (
  planId: Entitlement["planId"],
  rawLimits?: Partial<EntitlementLimits> | null
): EntitlementLimits => ({
  ...getDefaultPlanLimits(planId),
  ...(rawLimits ?? {}),
});

export type EntitlementWithFeatures = Entitlement & {
  features?: Record<EntitlementFeature, boolean>;
};

export type EntitlementCreateKind =
  | "assets"
  | "sites"
  | "departments"
  | "users"
  | "preventives";

export const getOrgEntitlement = async (
  db: Firestore,
  orgId: string
): Promise<EntitlementWithFeatures | null> => {
  if (!orgId) return null;

  const orgRef = doc(db, "organizations", orgId);
  const orgSnap = await getDoc(orgRef);
  if (!orgSnap.exists()) return null;

  const orgData = orgSnap.data() as Organization;
  const entitlement = orgData?.entitlement ?? null;
  if (!entitlement) return null;

  const planCatalogRef = doc(db, "planCatalog", entitlement.planId);
  const planCatalogSnap = await getDoc(planCatalogRef);
  const planCatalogData = planCatalogSnap.exists()
    ? (planCatalogSnap.data() as PlanCatalogEntry)
    : null;

  return {
    ...entitlement,
    limits: resolveEffectivePlanLimits(entitlement.planId, planCatalogData?.limits ?? entitlement.limits),
    features: resolveEffectivePlanFeatures(entitlement.planId, planCatalogData?.features ?? null),
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
    case "sites":
      return withinLimit(usage.sitesCount, limits.maxSites);
    case "assets":
      return withinLimit(usage.assetsCount, limits.maxAssets);
    case "departments":
      return withinLimit(usage.departmentsCount, limits.maxDepartments);
    case "users":
      return withinLimit(usage.usersCount, limits.maxUsers);
    case "preventives":
      return withinLimit(
        usage.activePreventivesCount,
        limits.maxActivePreventives
      );
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
};
