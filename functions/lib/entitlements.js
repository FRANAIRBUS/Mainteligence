"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canCreate = exports.isFeatureEnabled = exports.getOrgEntitlement = void 0;
const admin = require("firebase-admin");
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const DEFAULT_PLAN_FEATURES = {
    free: { EXPORT_PDF: false, AUDIT_TRAIL: false, PREVENTIVES: false },
    starter: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
    pro: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
    enterprise: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
};
const DEFAULT_PLAN_LIMITS = {
    free: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 3, attachmentsMonthlyMB: 1024 },
    starter: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 25, attachmentsMonthlyMB: 1024 },
    pro: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 100, attachmentsMonthlyMB: 1024 },
    enterprise: { maxSites: 100, maxAssets: 5000, maxDepartments: 100, maxUsers: 50, maxActivePreventives: 1000, attachmentsMonthlyMB: 1024 },
};
const resolveEffectivePlanFeatures = (planId, features) => {
    var _a;
    return (Object.assign(Object.assign({}, ((_a = DEFAULT_PLAN_FEATURES[planId]) !== null && _a !== void 0 ? _a : DEFAULT_PLAN_FEATURES.free)), (features !== null && features !== void 0 ? features : {})));
};
const resolveEffectivePlanLimits = (planId, limits) => {
    var _a;
    return (Object.assign(Object.assign({}, ((_a = DEFAULT_PLAN_LIMITS[planId]) !== null && _a !== void 0 ? _a : DEFAULT_PLAN_LIMITS.free)), (limits !== null && limits !== void 0 ? limits : {})));
};
const getOrgEntitlement = async (orgId) => {
    var _a, _b, _c;
    if (!orgId)
        return null;
    const orgSnap = await db.collection('organizations').doc(orgId).get();
    if (!orgSnap.exists)
        return null;
    const orgData = orgSnap.data();
    const entitlement = (_a = orgData === null || orgData === void 0 ? void 0 : orgData.entitlement) !== null && _a !== void 0 ? _a : null;
    if (!entitlement)
        return null;
    const planCatalogSnap = await db.collection('planCatalog').doc(entitlement.planId).get();
    const planCatalogData = planCatalogSnap.exists ? planCatalogSnap.data() : null;
    return Object.assign(Object.assign({}, entitlement), { limits: resolveEffectivePlanLimits(entitlement.planId, (_b = planCatalogData === null || planCatalogData === void 0 ? void 0 : planCatalogData.limits) !== null && _b !== void 0 ? _b : entitlement.limits), features: resolveEffectivePlanFeatures(entitlement.planId, (_c = planCatalogData === null || planCatalogData === void 0 ? void 0 : planCatalogData.features) !== null && _c !== void 0 ? _c : undefined) });
};
exports.getOrgEntitlement = getOrgEntitlement;
const isFeatureEnabled = (entitlement, feature) => {
    var _a;
    if (!entitlement)
        return false;
    return ((_a = entitlement.features) === null || _a === void 0 ? void 0 : _a[feature]) === true;
};
exports.isFeatureEnabled = isFeatureEnabled;
const canCreate = (kind, usage, limits) => {
    if (!usage || !limits)
        return false;
    const withinLimit = (current, max) => Number.isFinite(max) ? current < max : true;
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
            const _exhaustive = kind;
            return _exhaustive;
        }
    }
};
exports.canCreate = canCreate;
//# sourceMappingURL=entitlements.js.map