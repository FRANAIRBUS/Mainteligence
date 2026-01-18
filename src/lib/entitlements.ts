import { doc, getDoc, type Firestore } from "firebase/firestore";
import type {
  Entitlement,
  EntitlementFeature,
  EntitlementLimits,
  EntitlementUsage,
  Organization,
  PlanCatalogEntry,
} from "@/lib/firebase/models";

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
    features: planCatalogData?.features ?? undefined,
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
