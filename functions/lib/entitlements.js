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
    basic: { EXPORT_PDF: false, AUDIT_TRAIL: false, PREVENTIVES: false },
    starter: { EXPORT_PDF: true, AUDIT_TRAIL: false, PREVENTIVES: true },
    pro: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
    enterprise: { EXPORT_PDF: true, AUDIT_TRAIL: true, PREVENTIVES: true },
};
const DEFAULT_PLAN_LIMITS = {
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
        maxUsers: 500,
        maxSites: 200,
        maxDepartments: 500,
        maxAssets: 100000,
        maxActivePreventives: 5000,
        maxOpenTickets: 10000,
        maxOpenTasks: 10000,
        attachmentsMonthlyMB: 20000,
        maxAttachmentMB: 50,
        maxAttachmentsPerTicket: 50,
        retentionDays: 3650,
    },
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