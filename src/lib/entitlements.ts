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
  basic: {
    EXPORT_PDF: false,
    AUDIT_TRAIL: false,
    PREVENTIVES: false,
  },
  starter: {
    EXPORT_PDF: true,
    AUDIT_TRAIL: false,
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
