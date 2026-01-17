"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canCreate = exports.isFeatureEnabled = exports.getOrgEntitlement = void 0;
const admin = require("firebase-admin");
const db = admin.firestore();
const getOrgEntitlement = async (orgId) => {
    if (!orgId)
        return null;
    const orgSnap = await db.collection('organizations').doc(orgId).get();
    if (!orgSnap.exists)
        return null;
    const orgData = orgSnap.data();
    const entitlement = (orgData === null || orgData === void 0 ? void 0 : orgData.entitlement) ?? null;
    if (!entitlement)
        return null;
    const planCatalogSnap = await db.collection('planCatalog').doc(entitlement.planId).get();
    const planCatalogData = planCatalogSnap.exists ? planCatalogSnap.data() : null;
    return Object.assign(Object.assign({}, entitlement), { features: (planCatalogData === null || planCatalogData === void 0 ? void 0 : planCatalogData.features) ?? undefined });
};
exports.getOrgEntitlement = getOrgEntitlement;
const isFeatureEnabled = (entitlement, feature) => {
    if (!entitlement)
        return false;
    return (entitlement === null || entitlement === void 0 ? void 0 : entitlement.features) ? entitlement.features[feature] === true : false;
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
            return false;
        }
    }
};
exports.canCreate = canCreate;
