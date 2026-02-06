"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhook = exports.appleAppStoreNotifications = exports.registerAppleAppAccountToken = exports.registerGooglePlayPurchase = exports.demoteToAdminWithinOrg = exports.promoteToSuperAdminWithinOrg = exports.setRoleWithinOrg = exports.orgRejectJoinRequest = exports.orgApproveJoinRequest = exports.orgUpdateUserProfileCallable = exports.orgUpdateUserProfile = exports.orgInviteUser = exports.generatePreventiveTickets = exports.pausePreventivesWithoutEntitlement = exports.pauseExpiredDemoPreventives = exports.inviteUserToOrg = exports.duplicatePreventiveTemplate = exports.updatePreventiveTemplate = exports.createPreventiveTemplate = exports.createPreventive = exports.createAsset = exports.createDepartment = exports.createSite = exports.setActiveOrganization = exports.finalizeOrganizationSignup = exports.bootstrapSignup = exports.bootstrapFromInvites = exports.checkOrganizationAvailability = exports.resolveOrganizationId = exports.rootPurgeOrganizationCollection = exports.rootDeleteOrganizationScaffold = exports.orgSetOrganizationStatus = exports.rootSetOrganizationPlan = exports.rootDeactivateOrganization = exports.rootUpsertUserToOrganization = exports.rootListUsersByOrg = exports.rootOrgSummary = exports.rootListOrganizations = exports.onTaskDeleted = exports.onTicketDeleted = exports.onTicketClosed = exports.onTaskCreate = exports.onTicketCreate = exports.onTaskAssign = exports.onTicketAssign = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const assignment_email_1 = require("./assignment-email");
const invite_email_1 = require("./invite-email");
const entitlements_1 = require("./entitlements");
const crypto = require("crypto");
const https = require("https");
admin.initializeApp();
const db = admin.firestore();
const DEFAULT_ACCOUNT_PLAN = 'free';
const DEFAULT_ENTERPRISE_LIMIT = 10;
const CREATED_ORG_LIMITS = {
    free: 1,
    personal_plus: 2,
    business_creator: 3,
    enterprise: DEFAULT_ENTERPRISE_LIMIT,
};
const DEFAULT_ENTITLEMENT_PROVIDER = 'manual';
const DEFAULT_ENTITLEMENT_LIMITS = {
    maxSites: 100,
    maxAssets: 5000,
    maxDepartments: 100,
    maxUsers: 50,
    maxActivePreventives: 3,
    attachmentsMonthlyMB: 1024,
};
const PLAN_DEFAULT_LIMITS = {
    free: Object.assign(Object.assign({}, DEFAULT_ENTITLEMENT_LIMITS), { maxActivePreventives: 3 }),
    starter: Object.assign(Object.assign({}, DEFAULT_ENTITLEMENT_LIMITS), { maxActivePreventives: 25 }),
    pro: Object.assign(Object.assign({}, DEFAULT_ENTITLEMENT_LIMITS), { maxActivePreventives: 100 }),
    enterprise: Object.assign(Object.assign({}, DEFAULT_ENTITLEMENT_LIMITS), { maxActivePreventives: 1000 }),
};
const PLAN_DEFAULT_FEATURES = {
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
const DEFAULT_ENTITLEMENT_USAGE = {
    sitesCount: 0,
    assetsCount: 0,
    departmentsCount: 0,
    usersCount: 0,
    activePreventivesCount: 0,
    attachmentsThisMonthMB: 0,
};
const DEMO_PREVENTIVE_TEMPLATES_LIMIT = 5;
// Basic rentable org settings (Pro-ready).
// Stored in organizations/{orgId}/settings/main.
const DEFAULT_ORG_SETTINGS_MAIN = {
    allowScopeMembersToViewOpsTasks: true,
    allowScopeMembersToCompleteOpsTasks: true,
    validationModeEnabled: false,
    reopenWindowHours: 48,
};
const ADMIN_LIKE_ROLES = new Set(['super_admin', 'admin', 'mantenimiento']);
const SCOPED_HEAD_ROLES = new Set(['jefe_departamento']);
const MASTER_DATA_ROLES = new Set([...ADMIN_LIKE_ROLES, ...SCOPED_HEAD_ROLES]);
const USAGE_FIELDS = {
    sites: 'sitesCount',
    assets: 'assetsCount',
    departments: 'departmentsCount',
    users: 'usersCount',
    preventives: 'activePreventivesCount',
};
const LIMIT_MESSAGES = {
    sites: 'Has alcanzado el límite de ubicaciones de tu plan. Contacta para ampliarlo.',
    assets: 'Has alcanzado el límite de activos de tu plan. Contacta para ampliarlo.',
    departments: 'Has alcanzado el límite de departamentos de tu plan. Contacta para ampliarlo.',
    users: 'Has alcanzado el límite de usuarios de tu plan. Contacta para ampliarlo.',
    preventives: 'Has alcanzado el límite de preventivos activos de tu plan. Contacta para ampliarlo.',
};
function buildEntitlementPayload({ planId, status, trialEndsAt, currentPeriodEnd, provider = DEFAULT_ENTITLEMENT_PROVIDER, now, limits, usage = DEFAULT_ENTITLEMENT_USAGE, }) {
    const resolvedLimits = resolveEffectiveLimitsForPlan(planId, limits !== null && limits !== void 0 ? limits : null);
    const payload = {
        planId,
        status,
        provider,
        updatedAt: now,
        limits: resolvedLimits,
        usage,
    };
    if (trialEndsAt) {
        payload.trialEndsAt = trialEndsAt;
    }
    if (currentPeriodEnd) {
        payload.currentPeriodEnd = currentPeriodEnd;
    }
    return payload;
}
function httpsError(code, message) {
    return new functions.https.HttpsError(code, message);
}
function resolveTemplateOrgId(docRef, data) {
    var _a, _b;
    const dataOrgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (dataOrgId)
        return dataOrgId;
    const match = docRef.path.match(/^organizations\/([^/]+)\//);
    return (_b = match === null || match === void 0 ? void 0 : match[1]) !== null && _b !== void 0 ? _b : '';
}
function resolveZonedDate(timeZone) {
    if (!timeZone)
        return new Date();
    try {
        return new Date(new Date().toLocaleString('en-US', { timeZone }));
    }
    catch (_a) {
        return new Date();
    }
}
function parseTimeOfDay(timeOfDay) {
    if (!timeOfDay)
        return { hours: 8, minutes: 0 };
    const [rawHours, rawMinutes] = timeOfDay.split(':');
    const hours = Number(rawHours);
    const minutes = Number(rawMinutes);
    return {
        hours: Number.isFinite(hours) ? hours : 8,
        minutes: Number.isFinite(minutes) ? minutes : 0,
    };
}
function computeNextRunAt(schedule, now) {
    var _a, _b;
    const { hours, minutes } = parseTimeOfDay(schedule.timeOfDay);
    const base = new Date(now);
    switch (schedule.type) {
        case 'daily': {
            const candidate = new Date(base);
            candidate.setHours(hours, minutes, 0, 0);
            if (candidate <= now) {
                candidate.setDate(candidate.getDate() + 1);
            }
            return candidate;
        }
        case 'weekly': {
            const days = ((_a = schedule.daysOfWeek) === null || _a === void 0 ? void 0 : _a.length) ? schedule.daysOfWeek : [base.getDay() || 7];
            const normalizedDays = days
                .map((day) => (day === 7 ? 7 : day))
                .filter((day) => day >= 1 && day <= 7);
            for (let offset = 0; offset <= 7; offset += 1) {
                const candidate = new Date(base);
                candidate.setDate(candidate.getDate() + offset);
                candidate.setHours(hours, minutes, 0, 0);
                const weekday = candidate.getDay() === 0 ? 7 : candidate.getDay();
                if (normalizedDays.includes(weekday) && candidate > now) {
                    return candidate;
                }
            }
            const fallback = new Date(base);
            fallback.setDate(fallback.getDate() + 7);
            fallback.setHours(hours, minutes, 0, 0);
            return fallback;
        }
        case 'monthly': {
            const day = (_b = schedule.dayOfMonth) !== null && _b !== void 0 ? _b : base.getDate();
            const candidate = new Date(base);
            candidate.setDate(day);
            candidate.setHours(hours, minutes, 0, 0);
            if (candidate <= now) {
                candidate.setMonth(candidate.getMonth() + 1);
                candidate.setDate(day);
            }
            return candidate;
        }
        case 'date': {
            if (!schedule.date)
                return null;
            return schedule.date.toDate();
        }
        default:
            return null;
    }
}
function resolveFrequencyDays(schedule) {
    switch (schedule.type) {
        case 'daily':
            return 1;
        case 'weekly':
            return 7;
        case 'monthly':
            return 30;
        default:
            return 0;
    }
}
const ALLOWED_CORS_ORIGINS = new Set([
    'https://multi.maintelligence.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
]);
const STRIPE_API_VERSION = '2023-10-16';
const APPLE_UPDATES_ENABLED = ((_a = process.env.APPLE_APP_STORE_APPLY_UPDATES) !== null && _a !== void 0 ? _a : 'false') === 'true';
function resolveStripeConfig() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secretKey || !webhookSecret)
        return null;
    return { secretKey, webhookSecret };
}
function resolveGooglePlayConfig() {
    var _a;
    const clientEmail = process.env.GOOGLE_PLAY_CLIENT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_PLAY_PRIVATE_KEY;
    const packageName = (_a = process.env.GOOGLE_PLAY_PACKAGE_NAME) !== null && _a !== void 0 ? _a : '';
    if (!clientEmail || !privateKeyRaw)
        return null;
    return {
        clientEmail,
        privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
        packageName,
    };
}
function resolveAppleAppStoreConfig() {
    var _a;
    const bundleId = (_a = process.env.APPLE_APP_STORE_BUNDLE_ID) !== null && _a !== void 0 ? _a : '';
    return { bundleId };
}
function resolveEntitlementStatusFromStripe(status) {
    switch (status) {
        case 'trialing':
            return 'trialing';
        case 'active':
            return 'active';
        case 'past_due':
        case 'unpaid':
        case 'incomplete':
        case 'incomplete_expired':
        case 'paused':
            return 'past_due';
        case 'canceled':
            return 'canceled';
        default:
            return 'past_due';
    }
}
function resolveEntitlementPlanId({ metadataPlanId, fallbackPlanId, }) {
    const normalized = String(metadataPlanId !== null && metadataPlanId !== void 0 ? metadataPlanId : '').trim();
    if (normalized === 'free' || normalized === 'starter' || normalized === 'pro' || normalized === 'enterprise') {
        return normalized;
    }
    if (fallbackPlanId === 'free' || fallbackPlanId === 'starter' || fallbackPlanId === 'pro' || fallbackPlanId === 'enterprise') {
        return fallbackPlanId;
    }
    return 'free';
}
function resolveDefaultLimitsForPlan(planId) {
    var _a;
    return (_a = PLAN_DEFAULT_LIMITS[planId]) !== null && _a !== void 0 ? _a : PLAN_DEFAULT_LIMITS.free;
}
function resolveDefaultFeaturesForPlan(planId) {
    var _a;
    return (_a = PLAN_DEFAULT_FEATURES[planId]) !== null && _a !== void 0 ? _a : PLAN_DEFAULT_FEATURES.free;
}
function resolveEffectiveLimitsForPlan(planId, limits) {
    return Object.assign(Object.assign({}, resolveDefaultLimitsForPlan(planId)), (limits !== null && limits !== void 0 ? limits : {}));
}
function resolveEffectiveFeaturesForPlan(planId, features) {
    return Object.assign(Object.assign({}, resolveDefaultFeaturesForPlan(planId)), (features !== null && features !== void 0 ? features : {}));
}
function resolveEntitlementStatusFromApple(notificationType, renewal) {
    switch (String(notificationType !== null && notificationType !== void 0 ? notificationType : '').toUpperCase()) {
        case 'DID_RENEW':
        case 'DID_RECOVER':
        case 'DID_CHANGE_RENEWAL_PREF':
            return 'active';
        case 'DID_FAIL_TO_RENEW':
            return 'past_due';
        case 'EXPIRED':
        case 'REFUND':
        case 'REVOKE':
            return 'canceled';
        case 'DID_CHANGE_RENEWAL_STATUS':
            if (renewal && renewal.autoRenewStatus === 0)
                return 'past_due';
            return 'active';
        default:
            return 'past_due';
    }
}
function resolveOrganizationStatus(input) {
    const normalized = String(input !== null && input !== void 0 ? input : '').trim().toLowerCase();
    if (normalized === 'active' || normalized === 'suspended' || normalized === 'deleted') {
        return normalized;
    }
    return null;
}
function resolveEntitlementStatus(input) {
    const normalized = String(input !== null && input !== void 0 ? input : '').trim().toLowerCase();
    if (normalized === 'trialing' || normalized === 'active' || normalized === 'past_due' || normalized === 'canceled') {
        return normalized;
    }
    return null;
}
function shouldBlockProviderUpdate(entitlement, incomingProvider) {
    if (!(entitlement === null || entitlement === void 0 ? void 0 : entitlement.provider))
        return false;
    if (entitlement.provider === incomingProvider)
        return false;
    return entitlement.status === 'active' || entitlement.status === 'trialing';
}
function buildConflictPayload({ planId, status, now, reason, }) {
    return {
        planId,
        status,
        updatedAt: now,
        conflict: true,
        conflictReason: reason,
    };
}
function toTimestampFromMillis(value) {
    if (value == null)
        return null;
    const millis = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(millis) || millis <= 0)
        return null;
    return admin.firestore.Timestamp.fromMillis(millis);
}
function decodeJwtPayload(token) {
    if (!token)
        return null;
    const parts = token.split('.');
    if (parts.length < 2)
        return null;
    const payload = parts[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const buffer = Buffer.from(`${normalized}${padding}`, 'base64');
    try {
        return JSON.parse(buffer.toString('utf8'));
    }
    catch (_a) {
        return null;
    }
}
function verifyStripeSignature({ payload, signatureHeader, webhookSecret, }) {
    const elements = signatureHeader.split(',');
    const timestampElement = elements.find((entry) => entry.startsWith('t='));
    const signatureElements = elements.filter((entry) => entry.startsWith('v1='));
    if (!timestampElement || signatureElements.length === 0)
        return false;
    const timestamp = timestampElement.replace('t=', '');
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(signedPayload, 'utf8')
        .digest('hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    return signatureElements.some((entry) => {
        const signature = entry.replace('v1=', '');
        const signatureBuffer = Buffer.from(signature, 'utf8');
        if (signatureBuffer.length !== expectedBuffer.length)
            return false;
        return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    });
}
async function fetchStripeSubscription(subscriptionId, secretKey) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.stripe.com',
            path: `/v1/subscriptions/${subscriptionId}`,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Stripe-Version': STRIPE_API_VERSION,
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            res.on('end', () => {
                var _a;
                const body = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    }
                    catch (error) {
                        reject(error);
                    }
                    return;
                }
                reject(new Error(`Stripe subscription fetch failed: ${(_a = res.statusCode) !== null && _a !== void 0 ? _a : 'unknown'} ${body}`));
            });
        });
        req.on('error', (error) => {
            reject(error);
        });
        req.end();
    });
}
async function updateOrganizationStripeEntitlement({ orgId, planId, status, trialEndsAt, currentPeriodEnd, }) {
    const orgRef = db.collection('organizations').doc(orgId);
    await db.runTransaction(async (tx) => {
        var _a, _b;
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists) {
            throw new Error(`Organization ${orgId} not found.`);
        }
        const orgData = orgSnap.data();
        const entitlement = orgData === null || orgData === void 0 ? void 0 : orgData.entitlement;
        const usage = (_a = entitlement === null || entitlement === void 0 ? void 0 : entitlement.usage) !== null && _a !== void 0 ? _a : DEFAULT_ENTITLEMENT_USAGE;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const resolvedPlanId = resolveEntitlementPlanId({
            metadataPlanId: planId !== null && planId !== void 0 ? planId : null,
            fallbackPlanId: entitlement === null || entitlement === void 0 ? void 0 : entitlement.planId,
        });
        const limits = resolveEffectiveLimitsForPlan(resolvedPlanId, entitlement === null || entitlement === void 0 ? void 0 : entitlement.limits);
        const shouldBlock = shouldBlockProviderUpdate(entitlement, 'stripe');
        const billingProviderPayload = shouldBlock
            ? buildConflictPayload({
                planId: resolvedPlanId,
                status,
                now,
                reason: `active_provider_${(_b = entitlement === null || entitlement === void 0 ? void 0 : entitlement.provider) !== null && _b !== void 0 ? _b : 'unknown'}`,
            })
            : {
                planId: resolvedPlanId,
                status,
                updatedAt: now,
            };
        if (trialEndsAt) {
            billingProviderPayload.trialEndsAt = trialEndsAt;
        }
        if (currentPeriodEnd) {
            billingProviderPayload.currentPeriodEnd = currentPeriodEnd;
        }
        const updatePayload = {
            billingProviders: {
                stripe: billingProviderPayload,
            },
            updatedAt: now,
        };
        if (!shouldBlock) {
            updatePayload.entitlement = buildEntitlementPayload({
                planId: resolvedPlanId,
                status,
                trialEndsAt,
                currentPeriodEnd,
                provider: 'stripe',
                now,
                limits,
                usage,
            });
        }
        tx.set(orgRef, updatePayload, { merge: true });
    });
}
function applyCors(req, res) {
    var _a;
    const origin = String((_a = req.headers.origin) !== null && _a !== void 0 ? _a : '');
    if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
    }
    else if (origin) {
        res.set('Access-Control-Allow-Origin', origin);
    }
    else {
        res.set('Access-Control-Allow-Origin', 'https://multi.maintelligence.app');
    }
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    const requestedHeaders = req.headers['access-control-request-headers'];
    res.set('Access-Control-Allow-Headers', typeof requestedHeaders === 'string' && requestedHeaders.trim()
        ? requestedHeaders
        : 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return true;
    }
    return false;
}
async function requireAuthFromRequest(req) {
    var _a;
    const authHeader = String((_a = req.headers.authorization) !== null && _a !== void 0 ? _a : '');
    const match = authHeader.match(/^Bearer (.+)$/i);
    if (!match)
        throw httpsError('unauthenticated', 'Debes iniciar sesión.');
    return admin.auth().verifyIdToken(match[1]);
}
async function updateOrganizationUserProfile({ actorUid, actorEmail, isRoot, orgId, targetUid, displayName, email, departmentId, locationId, }) {
    var _a, _b, _c, _d;
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!targetUid)
        throw httpsError('invalid-argument', 'uid requerido.');
    if (!isRoot) {
        await requireCallerSuperAdminInOrg(actorUid, orgId);
    }
    const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
    const membershipSnap = await membershipRef.get();
    if (!membershipSnap.exists) {
        throw httpsError('failed-precondition', 'El usuario objetivo no tiene membresía en esa organización.');
    }
    const membership = membershipSnap.data();
    const rawStatus = String((_a = membership === null || membership === void 0 ? void 0 : membership.status) !== null && _a !== void 0 ? _a : '').trim().toLowerCase();
    const membershipStatus = rawStatus || (typeof (membership === null || membership === void 0 ? void 0 : membership.active) === 'boolean' ? (membership.active ? 'active' : 'inactive') : '');
    if (membershipStatus !== 'active') {
        if (membershipStatus === 'pending' || membershipStatus === 'revoked') {
            console.warn('updateOrganizationUserProfile blocked for inactive membership', {
                orgId,
                targetUid,
                membershipStatus,
            });
        }
        throw httpsError('failed-precondition', 'El usuario objetivo no tiene membresía activa en esa organización.');
    }
    const userRef = db.collection('users').doc(targetUid);
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
    void memberRef;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const normalizedEmail = String(email !== null && email !== void 0 ? email : '').trim();
    const userSnap = await userRef.get();
    const currentEmail = String((_c = (_b = userSnap.data()) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : '').trim();
    if (normalizedEmail && normalizedEmail !== currentEmail) {
        try {
            await admin.auth().updateUser(targetUid, { email: normalizedEmail });
        }
        catch (err) {
            const code = String((_d = err === null || err === void 0 ? void 0 : err.code) !== null && _d !== void 0 ? _d : '');
            if (code === 'auth/email-already-exists') {
                throw httpsError('failed-precondition', 'El correo electrónico ya está en uso.');
            }
            if (code === 'auth/invalid-email') {
                throw httpsError('invalid-argument', 'El correo electrónico no es válido.');
            }
            if (code === 'auth/user-not-found') {
                throw httpsError('not-found', 'No se encontró el usuario en Auth.');
            }
            console.error('updateOrganizationUserProfile auth update failed', { targetUid, orgId, code, err });
            throw httpsError('internal', 'No se pudo actualizar el correo electrónico en Auth.');
        }
    }
    const normalizedLocationId = locationId || null;
    const userPayload = {
        displayName: displayName || null,
        email: normalizedEmail || null,
        departmentId: departmentId || null,
        locationId: normalizedLocationId,
        updatedAt: now,
        source: 'orgUpdateUserProfile_v1',
    };
    const memberPayload = {
        displayName: displayName || null,
        email: normalizedEmail || null,
        departmentId: departmentId || null,
        locationId: normalizedLocationId,
        updatedAt: now,
        source: 'orgUpdateUserProfile_v1',
    };
    const batch = db.batch();
    batch.set(userRef, userPayload, { merge: true });
    batch.set(memberRef, memberPayload, { merge: true });
    await batch.commit();
    await auditLog({
        action: 'orgUpdateUserProfile',
        actorUid,
        actorEmail,
        orgId,
        targetUid,
        targetEmail: normalizedEmail || null,
        after: {
            displayName: displayName || null,
            email: normalizedEmail || null,
            departmentId: departmentId || null,
            locationId: normalizedLocationId,
        },
    });
}
async function updateOrganizationAppleEntitlement({ orgId, planId, status, currentPeriodEnd, }) {
    const orgRef = db.collection('organizations').doc(orgId);
    await db.runTransaction(async (tx) => {
        var _a, _b;
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists) {
            throw new Error(`Organization ${orgId} not found.`);
        }
        const orgData = orgSnap.data();
        const entitlement = orgData === null || orgData === void 0 ? void 0 : orgData.entitlement;
        const usage = (_a = entitlement === null || entitlement === void 0 ? void 0 : entitlement.usage) !== null && _a !== void 0 ? _a : DEFAULT_ENTITLEMENT_USAGE;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const resolvedPlanId = resolveEntitlementPlanId({
            metadataPlanId: planId !== null && planId !== void 0 ? planId : null,
            fallbackPlanId: entitlement === null || entitlement === void 0 ? void 0 : entitlement.planId,
        });
        const limits = resolveEffectiveLimitsForPlan(resolvedPlanId, entitlement === null || entitlement === void 0 ? void 0 : entitlement.limits);
        const shouldBlock = shouldBlockProviderUpdate(entitlement, 'apple_app_store');
        const billingProviderPayload = shouldBlock
            ? buildConflictPayload({
                planId: resolvedPlanId,
                status,
                now,
                reason: `active_provider_${(_b = entitlement === null || entitlement === void 0 ? void 0 : entitlement.provider) !== null && _b !== void 0 ? _b : 'unknown'}`,
            })
            : {
                planId: resolvedPlanId,
                status,
                updatedAt: now,
            };
        if (currentPeriodEnd) {
            billingProviderPayload.currentPeriodEnd = currentPeriodEnd;
        }
        const updatePayload = {
            billingProviders: {
                apple_app_store: billingProviderPayload,
            },
            updatedAt: now,
        };
        if (!shouldBlock) {
            updatePayload.entitlement = buildEntitlementPayload({
                planId: resolvedPlanId,
                status,
                currentPeriodEnd,
                provider: 'apple_app_store',
                now,
                limits,
                usage,
            });
        }
        tx.set(orgRef, updatePayload, { merge: true });
    });
}
function sendHttpError(res, err) {
    var _a, _b;
    const code = String((_a = err === null || err === void 0 ? void 0 : err.code) !== null && _a !== void 0 ? _a : 'internal');
    const message = String((_b = err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : 'Error inesperado.');
    const status = (() => {
        switch (code) {
            case 'invalid-argument':
                return 400;
            case 'unauthenticated':
                return 401;
            case 'permission-denied':
                return 403;
            case 'not-found':
                return 404;
            case 'failed-precondition':
                return 400;
            default:
                return 500;
        }
    })();
    res.status(status).json({ error: message, code });
}
function requireAuth(context) {
    var _a;
    if (!((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid))
        throw httpsError('unauthenticated', 'Debes iniciar sesión.');
    return context.auth.uid;
}
function normalizeAccountPlan(value) {
    const plan = String(value !== null && value !== void 0 ? value : '').trim().toLowerCase();
    if (plan === 'personal_plus' || plan === 'business_creator' || plan === 'enterprise') {
        return plan;
    }
    return DEFAULT_ACCOUNT_PLAN;
}
function resolveCreatedOrganizationsLimit(plan, storedLimit) {
    var _a;
    if (plan === 'enterprise') {
        const limit = Number(storedLimit);
        if (Number.isFinite(limit) && limit > 0) {
            return Math.floor(limit);
        }
    }
    return (_a = CREATED_ORG_LIMITS[plan]) !== null && _a !== void 0 ? _a : CREATED_ORG_LIMITS[DEFAULT_ACCOUNT_PLAN];
}
function getUserOrgQuota(userData) {
    var _a, _b, _c;
    const accountPlan = normalizeAccountPlan(userData === null || userData === void 0 ? void 0 : userData.accountPlan);
    const createdOrganizationsCountRaw = Number((_a = userData === null || userData === void 0 ? void 0 : userData.createdOrganizationsCount) !== null && _a !== void 0 ? _a : 0);
    let createdOrganizationsCount = Number.isFinite(createdOrganizationsCountRaw) && createdOrganizationsCountRaw >= 0
        ? Math.floor(createdOrganizationsCountRaw)
        : 0;
    const createdOrganizationsLimit = resolveCreatedOrganizationsLimit(accountPlan, userData === null || userData === void 0 ? void 0 : userData.createdOrganizationsLimit);
    const demoUsedAt = (_b = userData === null || userData === void 0 ? void 0 : userData.demoUsedAt) !== null && _b !== void 0 ? _b : null;
    const primaryOrgId = String((_c = userData === null || userData === void 0 ? void 0 : userData.organizationId) !== null && _c !== void 0 ? _c : '');
    if (demoUsedAt && primaryOrgId.startsWith('demo-') && createdOrganizationsCount > 0) {
        createdOrganizationsCount -= 1;
    }
    return {
        accountPlan,
        createdOrganizationsCount,
        createdOrganizationsLimit,
        demoUsedAt,
    };
}
async function seedDemoOrganizationData({ organizationId, uid, }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const baseDate = new Date();
    const makeTimestamp = (offsetDays) => {
        const date = new Date(baseDate);
        date.setDate(date.getDate() + offsetDays);
        return admin.firestore.Timestamp.fromDate(date);
    };
    const sites = [
        { id: `${organizationId}_site_1`, name: 'Planta principal', code: 'PL-01' },
        { id: `${organizationId}_site_2`, name: 'Almacén central', code: 'ALM-01' },
        { id: `${organizationId}_site_3`, name: 'Oficina técnica', code: 'OFI-01' },
    ];
    const departments = [
        { id: `${organizationId}_dept_1`, name: 'Mantenimiento', code: 'MTTO' },
        { id: `${organizationId}_dept_2`, name: 'Producción', code: 'PROD' },
        { id: `${organizationId}_dept_3`, name: 'Calidad', code: 'CAL' },
    ];
    const tasks = [
        {
            id: `${organizationId}_task_1`,
            title: 'Revisión mensual de calderas',
            description: 'Verificar presión, válvulas de seguridad y registros de mantenimiento.',
            status: 'open',
            priority: 'alta',
            dueDate: makeTimestamp(3),
            location: (_a = departments[0]) === null || _a === void 0 ? void 0 : _a.id,
        },
        {
            id: `${organizationId}_task_2`,
            title: 'Inspección de línea de producción',
            description: 'Comprobar sensores y lubricación en la línea 2.',
            status: 'in_progress',
            priority: 'media',
            dueDate: makeTimestamp(7),
            location: (_b = departments[1]) === null || _b === void 0 ? void 0 : _b.id,
        },
        {
            id: `${organizationId}_task_3`,
            title: 'Actualizar checklist de seguridad',
            description: 'Revisar procedimientos y registrar cambios en el plan de seguridad.',
            status: 'done',
            priority: 'baja',
            dueDate: makeTimestamp(-2),
            location: (_c = departments[2]) === null || _c === void 0 ? void 0 : _c.id,
            closedAt: makeTimestamp(-1),
            closedBy: uid,
            closedReason: 'Checklist actualizado y validado.',
        },
    ];
    const year = new Date().getFullYear();
    const tickets = [
        {
            id: `${organizationId}_ticket_1`,
            displayId: `INC-${year}-1001`,
            type: 'correctivo',
            status: 'new',
            priority: 'Alta',
            siteId: (_d = sites[0]) === null || _d === void 0 ? void 0 : _d.id,
            departmentId: (_e = departments[0]) === null || _e === void 0 ? void 0 : _e.id,
            title: 'Fuga de agua en sala de bombas',
            description: 'Se detecta pérdida de agua en la bomba principal.',
        },
        {
            id: `${organizationId}_ticket_2`,
            displayId: `INC-${year}-1002`,
            type: 'correctivo',
            status: 'in_progress',
            priority: 'Media',
            siteId: (_f = sites[1]) === null || _f === void 0 ? void 0 : _f.id,
            departmentId: (_g = departments[1]) === null || _g === void 0 ? void 0 : _g.id,
            title: 'Vibración en motor de cinta',
            description: 'El motor presenta vibración excesiva durante el arranque.',
        },
        {
            id: `${organizationId}_ticket_3`,
            displayId: `INC-${year}-1003`,
            type: 'correctivo',
            status: 'resolved',
            priority: 'Baja',
            siteId: (_h = sites[2]) === null || _h === void 0 ? void 0 : _h.id,
            departmentId: (_j = departments[2]) === null || _j === void 0 ? void 0 : _j.id,
            title: 'Iluminación insuficiente en pasillo',
            description: 'Se sustituyeron luminarias y se verificó el nivel de lux.',
            closedAt: makeTimestamp(-1),
            closedBy: uid,
            closedReason: 'Luminarias reemplazadas.',
        },
    ];
    const batch = db.batch();
    const orgRef = db.collection('organizations').doc(organizationId);
    // Ensure org settings doc exists for client gating.
    batch.set(orgRef.collection('settings').doc('main'), Object.assign(Object.assign({ organizationId }, DEFAULT_ORG_SETTINGS_MAIN), { createdAt: now, updatedAt: now, source: 'demo_seed_v1' }), { merge: true });
    sites.forEach((site) => {
        const ref = orgRef.collection('sites').doc(site.id);
        batch.set(ref, {
            organizationId,
            name: site.name,
            code: site.code,
            createdAt: now,
            updatedAt: now,
            source: 'demo_seed_v1',
        }, { merge: true });
    });
    departments.forEach((department) => {
        const ref = orgRef.collection('departments').doc(department.id);
        batch.set(ref, {
            organizationId,
            name: department.name,
            code: department.code,
            createdAt: now,
            updatedAt: now,
            source: 'demo_seed_v1',
        }, { merge: true });
    });
    tasks.forEach((task) => {
        var _a, _b, _c;
        const ref = orgRef.collection('tasks').doc(task.id);
        batch.set(ref, {
            organizationId,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate,
            location: task.location,
            createdBy: uid,
            createdAt: now,
            updatedAt: now,
            closedAt: (_a = task.closedAt) !== null && _a !== void 0 ? _a : null,
            closedBy: (_b = task.closedBy) !== null && _b !== void 0 ? _b : null,
            closedReason: (_c = task.closedReason) !== null && _c !== void 0 ? _c : null,
            source: 'demo_seed_v1',
        }, { merge: true });
    });
    tickets.forEach((ticket) => {
        var _a, _b, _c;
        const ref = orgRef.collection('tickets').doc(ticket.id);
        batch.set(ref, {
            organizationId,
            displayId: ticket.displayId,
            type: ticket.type,
            status: ticket.status,
            priority: ticket.priority,
            siteId: ticket.siteId,
            departmentId: ticket.departmentId,
            title: ticket.title,
            description: ticket.description,
            createdBy: uid,
            assignedRole: 'mantenimiento',
            assignedTo: null,
            createdAt: now,
            updatedAt: now,
            closedAt: (_a = ticket.closedAt) !== null && _a !== void 0 ? _a : null,
            closedBy: (_b = ticket.closedBy) !== null && _b !== void 0 ? _b : null,
            closedReason: (_c = ticket.closedReason) !== null && _c !== void 0 ? _c : null,
            source: 'demo_seed_v1',
        }, { merge: true });
    });
    await batch.commit();
}
function isRootClaim(context) {
    var _a, _b;
    return Boolean(((_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.root) === true);
}
function normalizeRoleOrNull(input) {
    const r = String(input !== null && input !== void 0 ? input : '').trim().toLowerCase();
    if (!r)
        return null;
    if (r === 'super_admin')
        return 'super_admin';
    if (r === 'admin')
        return 'admin';
    if (r === 'mantenimiento')
        return 'mantenimiento';
    if (r === 'jefe_departamento')
        return 'jefe_departamento';
    if (r === 'jefe_ubicacion')
        return 'jefe_ubicacion';
    if (r === 'auditor')
        return 'auditor';
    if (r === 'operario')
        return 'operario';
    return null;
}
function normalizeRole(input) {
    var _a;
    return (_a = normalizeRoleOrNull(input)) !== null && _a !== void 0 ? _a : 'operario';
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => String(item !== null && item !== void 0 ? item : '').trim())
        .filter((item) => Boolean(item));
}
function resolveMembershipScope(userData) {
    var _a, _b;
    const departmentId = String((_a = userData === null || userData === void 0 ? void 0 : userData.departmentId) !== null && _a !== void 0 ? _a : '').trim();
    const locationId = String((_b = userData === null || userData === void 0 ? void 0 : userData.locationId) !== null && _b !== void 0 ? _b : '').trim();
    return {
        departmentId: departmentId || undefined,
        departmentIds: normalizeStringArray(userData === null || userData === void 0 ? void 0 : userData.departmentIds),
        locationId: locationId || undefined,
        locationIds: normalizeStringArray(userData === null || userData === void 0 ? void 0 : userData.locationIds),
    };
}
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function requireRoleAllowed(role, allowed, message) {
    if (!allowed.has(role)) {
        throw httpsError('permission-denied', message);
    }
}
function requireScopedAccessToDepartment(role, scope, departmentId) {
    if (!SCOPED_HEAD_ROLES.has(role))
        return;
    const allowedDepartmentIds = new Set([scope.departmentId, ...scope.departmentIds].filter(Boolean));
    if (!departmentId) {
        throw httpsError('invalid-argument', 'departmentId requerido para validar alcance.');
    }
    if (allowedDepartmentIds.size === 0 || !allowedDepartmentIds.has(departmentId)) {
        throw httpsError('permission-denied', 'No tienes acceso a ese departamento.');
    }
}
function requireScopedAccessToSite(role, scope, siteId) {
    if (!SCOPED_HEAD_ROLES.has(role))
        return;
    const allowedSiteIds = new Set([scope.locationId, ...scope.locationIds].filter(Boolean));
    if (!siteId) {
        throw httpsError('invalid-argument', 'siteId requerido para validar alcance.');
    }
    if (allowedSiteIds.size === 0 || !allowedSiteIds.has(siteId)) {
        throw httpsError('permission-denied', 'No tienes acceso a esa ubicación.');
    }
}
function requireStringField(value, field) {
    const normalized = String(value !== null && value !== void 0 ? value : '').trim();
    if (!normalized)
        throw httpsError('invalid-argument', `${field} requerido.`);
    return normalized;
}
async function requireActiveMembership(actorUid, orgId) {
    var _a;
    const membershipRef = db.collection('memberships').doc(`${actorUid}_${orgId}`);
    const userRef = db.collection('users').doc(actorUid);
    const [membershipSnap, userSnap] = await Promise.all([membershipRef.get(), userRef.get()]);
    if (!membershipSnap.exists) {
        throw httpsError('permission-denied', 'No perteneces a esa organización.');
    }
    const membershipData = membershipSnap.data();
    const status = String((_a = membershipData === null || membershipData === void 0 ? void 0 : membershipData.status) !== null && _a !== void 0 ? _a : '') ||
        ((membershipData === null || membershipData === void 0 ? void 0 : membershipData.active) === true ? 'active' : 'pending');
    if (status !== 'active') {
        throw httpsError('failed-precondition', 'Tu membresía no está activa.');
    }
    const role = normalizeRole(membershipData === null || membershipData === void 0 ? void 0 : membershipData.role);
    const userData = userSnap.exists ? userSnap.data() : null;
    return {
        role,
        status,
        scope: resolveMembershipScope(userData),
        membershipData,
        userData,
    };
}
async function resolvePlanFeaturesForTx(tx, planId) {
    const resolvedPlanId = resolveEntitlementPlanId({ metadataPlanId: planId !== null && planId !== void 0 ? planId : null });
    const planSnap = await tx.get(db.collection('planCatalog').doc(resolvedPlanId));
    const rawFeatures = planSnap.exists
        ? planSnap.get('features')
        : undefined;
    return resolveEffectiveFeaturesForPlan(resolvedPlanId, rawFeatures !== null && rawFeatures !== void 0 ? rawFeatures : null);
}
async function resolveFallbackPreventivesEntitlementForTx(tx, orgData, baseEntitlement) {
    var _a, _b, _c, _d;
    const providersRaw = ((_a = orgData === null || orgData === void 0 ? void 0 : orgData.billingProviders) !== null && _a !== void 0 ? _a : null);
    if (!providersRaw)
        return null;
    const activeProviders = Object.values(providersRaw)
        .filter((provider) => {
        if (!provider)
            return false;
        if (provider.conflict === true)
            return false;
        return provider.status === 'active' || provider.status === 'trialing';
    })
        .sort((a, b) => {
        const left = a.updatedAt instanceof admin.firestore.Timestamp ? a.updatedAt.toMillis() : 0;
        const right = b.updatedAt instanceof admin.firestore.Timestamp ? b.updatedAt.toMillis() : 0;
        return right - left;
    });
    for (const providerEntitlement of activeProviders) {
        const providerFeatures = await resolvePlanFeaturesForTx(tx, providerEntitlement.planId);
        const effectiveEntitlement = Object.assign(Object.assign({}, baseEntitlement), { planId: providerEntitlement.planId, status: providerEntitlement.status, trialEndsAt: (_b = providerEntitlement.trialEndsAt) !== null && _b !== void 0 ? _b : baseEntitlement.trialEndsAt, currentPeriodEnd: (_c = providerEntitlement.currentPeriodEnd) !== null && _c !== void 0 ? _c : baseEntitlement.currentPeriodEnd, updatedAt: (_d = providerEntitlement.updatedAt) !== null && _d !== void 0 ? _d : baseEntitlement.updatedAt });
        if ((0, entitlements_1.isFeatureEnabled)(Object.assign(Object.assign({}, effectiveEntitlement), { features: providerFeatures }), 'PREVENTIVES')) {
            return {
                entitlement: effectiveEntitlement,
                features: providerFeatures,
            };
        }
    }
    return null;
}
function ensureEntitlementAllowsCreate({ kind, entitlement, features, orgType, }) {
    var _a, _b;
    const status = String((_a = entitlement === null || entitlement === void 0 ? void 0 : entitlement.status) !== null && _a !== void 0 ? _a : '');
    if (status !== 'active' && status !== 'trialing') {
        throw httpsError('failed-precondition', 'Tu plan no está activo para crear nuevos elementos.');
    }
    if ((entitlement === null || entitlement === void 0 ? void 0 : entitlement.trialEndsAt) instanceof admin.firestore.Timestamp) {
        const now = admin.firestore.Timestamp.now();
        if (entitlement.trialEndsAt.toMillis() <= now.toMillis()) {
            throw httpsError('failed-precondition', 'Tu periodo de prueba expiró.');
        }
    }
    const isDemoOrg = orgType === 'demo';
    const normalizedPlanId = resolveEntitlementPlanId({
        metadataPlanId: (_b = entitlement === null || entitlement === void 0 ? void 0 : entitlement.planId) !== null && _b !== void 0 ? _b : null,
    });
    if (kind === 'preventives' && !isDemoOrg && normalizedPlanId === 'free') {
        throw httpsError('failed-precondition', 'Tu plan no incluye preventivos.');
    }
    if (kind === 'preventives' &&
        !isDemoOrg &&
        !(0, entitlements_1.isFeatureEnabled)(Object.assign(Object.assign({}, entitlement), { features }), 'PREVENTIVES')) {
        throw httpsError('failed-precondition', 'Tu plan no incluye preventivos.');
    }
    const effectiveLimits = resolveEffectiveLimitsForPlan(normalizedPlanId, entitlement === null || entitlement === void 0 ? void 0 : entitlement.limits);
    if (!(0, entitlements_1.canCreate)(kind, entitlement === null || entitlement === void 0 ? void 0 : entitlement.usage, effectiveLimits)) {
        throw httpsError('failed-precondition', LIMIT_MESSAGES[kind]);
    }
}
function resolveOrgIdFromData(data) {
    var _a, _b;
    const orgId = sanitizeOrganizationId(String((_b = (_a = data === null || data === void 0 ? void 0 : data.orgId) !== null && _a !== void 0 ? _a : data === null || data === void 0 ? void 0 : data.organizationId) !== null && _b !== void 0 ? _b : ''));
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    return orgId;
}
function isDemoOrganization(orgId, orgData) {
    var _a, _b;
    const type = String((_a = orgData === null || orgData === void 0 ? void 0 : orgData.type) !== null && _a !== void 0 ? _a : '').trim();
    if (type === 'demo')
        return true;
    const subscriptionPlan = String((_b = orgData === null || orgData === void 0 ? void 0 : orgData.subscriptionPlan) !== null && _b !== void 0 ? _b : '').trim();
    if (subscriptionPlan === 'trial')
        return true;
    return orgId.startsWith('demo-');
}
async function ensureDemoTemplateLimit(tx, orgRef, isDemoOrg) {
    if (!isDemoOrg)
        return;
    const existingTemplatesSnap = await tx.get(orgRef.collection('preventiveTemplates').limit(DEMO_PREVENTIVE_TEMPLATES_LIMIT));
    if (existingTemplatesSnap.size >= DEMO_PREVENTIVE_TEMPLATES_LIMIT) {
        throw httpsError('failed-precondition', `La demo permite hasta ${DEMO_PREVENTIVE_TEMPLATES_LIMIT} plantillas preventivas.`);
    }
}
async function pausePreventiveTicketsForOrg(orgId, now) {
    var _a;
    const ticketsRef = db.collection('organizations').doc(orgId).collection('tickets');
    let lastDoc = null;
    while (true) {
        let query = ticketsRef
            .where('type', '==', 'preventivo')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(200);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
        const ticketsSnap = await query.get();
        if (ticketsSnap.empty)
            break;
        const batch = db.batch();
        let updates = 0;
        ticketsSnap.docs.forEach((docSnap) => {
            var _a;
            const data = docSnap.data();
            if ((data === null || data === void 0 ? void 0 : data.preventivePausedByEntitlement) === true)
                return;
            const status = String((_a = data === null || data === void 0 ? void 0 : data.status) !== null && _a !== void 0 ? _a : '');
            if (status === 'resolved' || status === 'Resuelta' || status === 'Cerrada')
                return;
            batch.update(docSnap.ref, {
                status: 'in_progress',
                preventivePausedByEntitlement: true,
                preventivePausedAt: now,
                updatedAt: now,
            });
            updates += 1;
        });
        if (updates > 0) {
            await batch.commit();
        }
        lastDoc = (_a = ticketsSnap.docs[ticketsSnap.docs.length - 1]) !== null && _a !== void 0 ? _a : null;
        if (ticketsSnap.size < 200)
            break;
    }
    await db.collection('organizations').doc(orgId).set({
        preventivesPausedAt: now,
        preventivesPausedByEntitlement: true,
        updatedAt: now,
    }, { merge: true });
}
async function ensureDefaultOrganizationExists() {
    const ref = db.collection('organizations').doc('default');
    const snap = await ref.get();
    if (!snap.exists) {
        const now = admin.firestore.FieldValue.serverTimestamp();
        await ref.set({
            organizationId: 'default',
            name: 'default',
            isActive: true,
            entitlement: buildEntitlementPayload({
                planId: 'free',
                status: 'active',
                now,
            }),
            createdAt: now,
            updatedAt: now,
            source: 'ensure_default_org_v1',
        }, { merge: true });
    }
    else {
        const d = snap.data();
        // si no existe el campo, lo normalizamos para que nunca se "pierda" en queries futuras
        if ((d === null || d === void 0 ? void 0 : d.isActive) === undefined || !(d === null || d === void 0 ? void 0 : d.entitlement)) {
            const now = admin.firestore.FieldValue.serverTimestamp();
            await ref.set(Object.assign(Object.assign(Object.assign({}, ((d === null || d === void 0 ? void 0 : d.isActive) === undefined ? { isActive: true } : {})), (!(d === null || d === void 0 ? void 0 : d.entitlement)
                ? {
                    entitlement: buildEntitlementPayload({
                        planId: 'free',
                        status: 'active',
                        now,
                    }),
                }
                : {})), { updatedAt: now }), { merge: true });
        }
    }
}
async function countQuery(q) {
    var _a, _b;
    try {
        // @ts-ignore - count() existe en SDK modernos
        const agg = await q.count().get();
        // @ts-ignore
        return Number((_b = (_a = agg.data()) === null || _a === void 0 ? void 0 : _a.count) !== null && _b !== void 0 ? _b : 0);
    }
    catch (_c) {
        const snap = await q.get();
        return snap.size;
    }
}
async function auditLog(params) {
    const collectionRef = params.orgId
        ? db.collection('organizations').doc(params.orgId).collection('auditLogs')
        : db.collection('auditLogs');
    await collectionRef.add(Object.assign(Object.assign({}, params), { createdAt: admin.firestore.FieldValue.serverTimestamp() }));
}
/* ------------------------------
   FIRESTORE TRIGGERS (GEN1)
--------------------------------- */
exports.onTicketAssign = functions.firestore
    .document('organizations/{orgId}/tickets/{ticketId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after)
        return;
    if (!before.assignedTo || !after.assignedTo || before.assignedTo === after.assignedTo)
        return;
    if (after.assignmentEmailSource === 'client')
        return;
    try {
        const orgId = (_b = (_a = after.organizationId) !== null && _a !== void 0 ? _a : context.params.orgId) !== null && _b !== void 0 ? _b : null;
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: orgId,
            assignedTo: (_c = after.assignedTo) !== null && _c !== void 0 ? _c : null,
            departmentId: (_d = after.departmentId) !== null && _d !== void 0 ? _d : null,
            title: (_e = after.title) !== null && _e !== void 0 ? _e : '(sin título)',
            link: `https://multi.maintelligence.app/incidents/${context.params.ticketId}`,
            type: 'incidencia',
            identifier: (_f = after.displayId) !== null && _f !== void 0 ? _f : context.params.ticketId,
            description: (_g = after.description) !== null && _g !== void 0 ? _g : '',
            priority: (_h = after.priority) !== null && _h !== void 0 ? _h : '',
            status: (_j = after.status) !== null && _j !== void 0 ? _j : '',
            location: (_k = after.departmentId) !== null && _k !== void 0 ? _k : null,
        });
    }
    catch (error) {
        console.error('[onTicketAssign] Error enviando email de asignación', error);
    }
});
exports.onTaskAssign = functions.firestore
    .document('organizations/{orgId}/tasks/{taskId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after)
        return;
    if (!before.assignedTo || !after.assignedTo || before.assignedTo === after.assignedTo)
        return;
    if (after.assignmentEmailSource === 'client')
        return;
    try {
        const orgId = (_b = (_a = after.organizationId) !== null && _a !== void 0 ? _a : context.params.orgId) !== null && _b !== void 0 ? _b : null;
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: orgId,
            assignedTo: (_c = after.assignedTo) !== null && _c !== void 0 ? _c : null,
            departmentId: (_d = after.location) !== null && _d !== void 0 ? _d : null,
            title: (_e = after.title) !== null && _e !== void 0 ? _e : '(sin título)',
            link: `https://multi.maintelligence.app/tasks/${context.params.taskId}`,
            type: 'tarea',
            identifier: context.params.taskId,
            description: (_f = after.description) !== null && _f !== void 0 ? _f : '',
            priority: (_g = after.priority) !== null && _g !== void 0 ? _g : '',
            status: (_h = after.status) !== null && _h !== void 0 ? _h : '',
            dueDate: (_j = after.dueDate) !== null && _j !== void 0 ? _j : null,
            location: (_k = after.location) !== null && _k !== void 0 ? _k : null,
            category: (_l = after.category) !== null && _l !== void 0 ? _l : null,
        });
    }
    catch (error) {
        console.error('[onTaskAssign] Error enviando email de asignación', error);
    }
});
exports.onTicketCreate = functions.firestore
    .document('organizations/{orgId}/tickets/{ticketId}')
    .onCreate(async (snap, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const data = snap.data();
    if (!(data === null || data === void 0 ? void 0 : data.assignedTo))
        return;
    if (data.assignmentEmailSource === 'client')
        return;
    try {
        const orgId = (_b = (_a = data.organizationId) !== null && _a !== void 0 ? _a : context.params.orgId) !== null && _b !== void 0 ? _b : null;
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: orgId,
            assignedTo: (_c = data.assignedTo) !== null && _c !== void 0 ? _c : null,
            departmentId: (_d = data.departmentId) !== null && _d !== void 0 ? _d : null,
            title: (_e = data.title) !== null && _e !== void 0 ? _e : '(sin título)',
            link: `https://multi.maintelligence.app/incidents/${context.params.ticketId}`,
            type: 'incidencia',
            identifier: (_f = data.displayId) !== null && _f !== void 0 ? _f : context.params.ticketId,
            description: (_g = data.description) !== null && _g !== void 0 ? _g : '',
            priority: (_h = data.priority) !== null && _h !== void 0 ? _h : '',
            status: (_j = data.status) !== null && _j !== void 0 ? _j : '',
            location: (_k = data.departmentId) !== null && _k !== void 0 ? _k : null,
        });
    }
    catch (error) {
        console.error('[onTicketCreate] Error enviando email de asignación', error);
    }
});
exports.onTaskCreate = functions.firestore
    .document('organizations/{orgId}/tasks/{taskId}')
    .onCreate(async (snap, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const data = snap.data();
    if (!(data === null || data === void 0 ? void 0 : data.assignedTo))
        return;
    if (data.assignmentEmailSource === 'client')
        return;
    try {
        const orgId = (_b = (_a = data.organizationId) !== null && _a !== void 0 ? _a : context.params.orgId) !== null && _b !== void 0 ? _b : null;
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: orgId,
            assignedTo: (_c = data.assignedTo) !== null && _c !== void 0 ? _c : null,
            departmentId: (_d = data.location) !== null && _d !== void 0 ? _d : null,
            title: (_e = data.title) !== null && _e !== void 0 ? _e : '(sin título)',
            link: `https://multi.maintelligence.app/tasks/${context.params.taskId}`,
            type: 'tarea',
            identifier: context.params.taskId,
            description: (_f = data.description) !== null && _f !== void 0 ? _f : '',
            priority: (_g = data.priority) !== null && _g !== void 0 ? _g : '',
            status: (_h = data.status) !== null && _h !== void 0 ? _h : '',
            dueDate: (_j = data.dueDate) !== null && _j !== void 0 ? _j : null,
            location: (_k = data.location) !== null && _k !== void 0 ? _k : null,
            category: (_l = data.category) !== null && _l !== void 0 ? _l : null,
        });
    }
    catch (error) {
        console.error('[onTaskCreate] Error enviando email de asignación', error);
    }
});
exports.onTicketClosed = functions.firestore
    .document('organizations/{orgId}/tickets/{ticketId}')
    .onUpdate(async (change, context) => {
    var _a;
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after)
        return;
    if (before.status === after.status)
        return;
    const s = String((_a = after.status) !== null && _a !== void 0 ? _a : '').toLowerCase();
    if (s !== 'cerrada' && s !== 'closed')
        return;
    console.log('[onTicketClosed]', context.params.ticketId, 'status ->', after.status);
});
exports.onTicketDeleted = functions.firestore
    .document('organizations/{orgId}/tickets/{ticketId}')
    .onDelete(async (_snap, context) => {
    console.log('[onTicketDeleted]', context.params.ticketId);
});
exports.onTaskDeleted = functions.firestore
    .document('organizations/{orgId}/tasks/{taskId}')
    .onDelete(async (_snap, context) => {
    console.log('[onTaskDeleted]', context.params.taskId);
});
/* ------------------------------
   ROOT (custom claim) CALLABLES
--------------------------------- */
function requireRoot(context) {
    const uid = requireAuth(context);
    if (!isRootClaim(context))
        throw httpsError('permission-denied', 'Solo ROOT (claim) puede hacer esto.');
    return uid;
}
exports.rootListOrganizations = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f;
    requireRoot(context);
    const limit = Math.min(Number((_a = data === null || data === void 0 ? void 0 : data.limit) !== null && _a !== void 0 ? _a : 25), 200);
    const cursor = String((_b = data === null || data === void 0 ? void 0 : data.cursor) !== null && _b !== void 0 ? _b : '').trim(); // last docId
    const qTerm = String((_c = data === null || data === void 0 ? void 0 : data.q) !== null && _c !== void 0 ? _c : '').trim();
    const includeDefault = (data === null || data === void 0 ? void 0 : data.includeDefault) !== false; // default true
    const includeInactive = (data === null || data === void 0 ? void 0 : data.includeInactive) !== false; // default true
    if (includeDefault)
        await ensureDefaultOrganizationExists();
    // OJO: NO usar where('isActive','!=',false) porque excluye docs sin el campo isActive (como default)
    let query = db
        .collection('organizations')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit + 1);
    if (qTerm) {
        query = db
            .collection('organizations')
            .orderBy(admin.firestore.FieldPath.documentId())
            .startAt(qTerm)
            .endAt(qTerm + '\uf8ff')
            .limit(limit + 1);
    }
    else if (cursor) {
        query = db
            .collection('organizations')
            .orderBy(admin.firestore.FieldPath.documentId())
            .startAfter(cursor)
            .limit(limit + 1);
    }
    const snap = await query.get();
    const docs = snap.docs;
    const hasMore = docs.length > limit;
    const sliced = hasMore ? docs.slice(0, limit) : docs;
    let rows = sliced.map((d) => {
        var _a, _b, _c;
        const v = d.data();
        const isActive = (v === null || v === void 0 ? void 0 : v.isActive) !== false; // missing => true
        return {
            id: d.id,
            name: (_a = v === null || v === void 0 ? void 0 : v.name) !== null && _a !== void 0 ? _a : null,
            isActive,
            createdAt: (_b = v === null || v === void 0 ? void 0 : v.createdAt) !== null && _b !== void 0 ? _b : null,
            updatedAt: (_c = v === null || v === void 0 ? void 0 : v.updatedAt) !== null && _c !== void 0 ? _c : null,
        };
    });
    if (!includeInactive)
        rows = rows.filter((o) => o.isActive);
    // fuerza default visible si por lo que sea no vino (y el caller lo pidió)
    if (includeDefault && !rows.some((r) => r.id === 'default')) {
        const def = await db.collection('organizations').doc('default').get();
        if (def.exists) {
            const v = def.data();
            rows.unshift({
                id: 'default',
                name: (_d = v === null || v === void 0 ? void 0 : v.name) !== null && _d !== void 0 ? _d : 'default',
                isActive: (v === null || v === void 0 ? void 0 : v.isActive) !== false,
                createdAt: (_e = v === null || v === void 0 ? void 0 : v.createdAt) !== null && _e !== void 0 ? _e : null,
                updatedAt: (_f = v === null || v === void 0 ? void 0 : v.updatedAt) !== null && _f !== void 0 ? _f : null,
            });
        }
    }
    const nextCursor = hasMore ? docs[limit].id : null;
    return { ok: true, organizations: rows, nextCursor };
});
exports.rootOrgSummary = functions.https.onCall(async (data, context) => {
    var _a;
    requireRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const membersQ = db.collection('organizations').doc(orgId).collection('members');
    const usersQ = db.collection('organizations').doc(orgId).collection('members');
    const ticketsQ = db.collection('organizations').doc(orgId).collection('tickets');
    const tasksQ = db.collection('organizations').doc(orgId).collection('tasks');
    const sitesQ = db.collection('organizations').doc(orgId).collection('sites');
    const assetsQ = db.collection('organizations').doc(orgId).collection('assets');
    const depsQ = db.collection('organizations').doc(orgId).collection('departments');
    const [members, users, tickets, tasks, sites, assets, departments] = await Promise.all([
        countQuery(membersQ),
        countQuery(usersQ),
        countQuery(ticketsQ),
        countQuery(tasksQ),
        countQuery(sitesQ),
        countQuery(assetsQ),
        countQuery(depsQ),
    ]);
    return {
        ok: true,
        organizationId: orgId,
        summary: { members, users, tickets, tasks, sites, assets, departments },
    };
});
exports.rootListUsersByOrg = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f;
    requireRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const limit = Math.min(Number((_b = data === null || data === void 0 ? void 0 : data.limit) !== null && _b !== void 0 ? _b : 25), 200);
    const cursorEmail = String((_c = data === null || data === void 0 ? void 0 : data.cursorEmail) !== null && _c !== void 0 ? _c : '').trim();
    const cursorUid = String((_d = data === null || data === void 0 ? void 0 : data.cursorUid) !== null && _d !== void 0 ? _d : '').trim();
    const qTerm = String((_e = data === null || data === void 0 ? void 0 : data.q) !== null && _e !== void 0 ? _e : '').trim();
    let query = db
        .collection('organizations')
        .doc(orgId)
        .collection('members')
        .orderBy('email')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit + 1);
    if (qTerm) {
        query = db
            .collection('organizations')
            .doc(orgId)
            .collection('members')
            .orderBy('email')
            .startAt(qTerm)
            .endAt(qTerm + '\uf8ff')
            .limit(limit + 1);
    }
    else if (cursorEmail && cursorUid) {
        query = db
            .collection('organizations')
            .doc(orgId)
            .collection('members')
            .orderBy('email')
            .orderBy(admin.firestore.FieldPath.documentId())
            .startAfter(cursorEmail, cursorUid)
            .limit(limit + 1);
    }
    const snap = await query.get();
    const docs = snap.docs;
    const hasMore = docs.length > limit;
    const sliced = hasMore ? docs.slice(0, limit) : docs;
    const users = sliced.map((d) => {
        var _a, _b, _c, _d, _e, _f;
        const v = d.data();
        return {
            uid: d.id,
            email: (_a = v === null || v === void 0 ? void 0 : v.email) !== null && _a !== void 0 ? _a : null,
            displayName: (_b = v === null || v === void 0 ? void 0 : v.displayName) !== null && _b !== void 0 ? _b : null,
            active: (v === null || v === void 0 ? void 0 : v.active) !== false,
            role: (_c = v === null || v === void 0 ? void 0 : v.role) !== null && _c !== void 0 ? _c : null,
            departmentId: (_d = v === null || v === void 0 ? void 0 : v.departmentId) !== null && _d !== void 0 ? _d : null,
            createdAt: (_e = v === null || v === void 0 ? void 0 : v.createdAt) !== null && _e !== void 0 ? _e : null,
            updatedAt: (_f = v === null || v === void 0 ? void 0 : v.updatedAt) !== null && _f !== void 0 ? _f : null,
        };
    });
    const nextCursor = hasMore ? docs[limit] : null;
    return {
        ok: true,
        organizationId: orgId,
        users,
        nextCursorEmail: nextCursor ? String((_f = nextCursor.get('email')) !== null && _f !== void 0 ? _f : '') : null,
        nextCursorUid: nextCursor ? nextCursor.id : null,
    };
});
exports.rootUpsertUserToOrganization = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const actorUid = requireRoot(context);
    const email = String((_a = data === null || data === void 0 ? void 0 : data.email) !== null && _a !== void 0 ? _a : '').trim().toLowerCase();
    const orgId = String((_b = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _b !== void 0 ? _b : '').trim();
    const roleIn = String((_c = data === null || data === void 0 ? void 0 : data.role) !== null && _c !== void 0 ? _c : '').trim();
    if (!email)
        throw httpsError('invalid-argument', 'Email requerido.');
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const role = normalizeRole(roleIn);
    const authUser = await admin.auth().getUserByEmail(email).catch(() => null);
    if (!(authUser === null || authUser === void 0 ? void 0 : authUser.uid))
        throw httpsError('not-found', 'No existe ese usuario en Auth.');
    const uid = authUser.uid;
    const orgRef = db.collection('organizations').doc(orgId);
    const orgSnap = await orgRef.get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const entitlementPayload = !orgSnap.exists || !orgSnap.get('entitlement')
        ? buildEntitlementPayload({
            planId: 'free',
            status: 'active',
            now,
        })
        : null;
    await orgRef.set(Object.assign(Object.assign({ organizationId: orgId, name: orgId, isActive: true, updatedAt: now }, (entitlementPayload ? { entitlement: entitlementPayload } : {})), { source: 'root_upsert_user_v1' }), { merge: true });
    const userRef = db.collection('users').doc(uid);
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(uid);
    void memberRef;
    const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);
    const beforeSnap = await userRef.get();
    const before = beforeSnap.exists ? beforeSnap.data() : null;
    const batch = db.batch();
    batch.set(userRef, {
        email: (_d = authUser.email) !== null && _d !== void 0 ? _d : email,
        displayName: (_e = authUser.displayName) !== null && _e !== void 0 ? _e : null,
        organizationId: orgId,
        role,
        active: true,
        updatedAt: now,
        createdAt: beforeSnap.exists ? (_f = beforeSnap.get('createdAt')) !== null && _f !== void 0 ? _f : now : now,
        source: 'root_upsert_user_v1',
    }, { merge: true });
    batch.set(memberRef, {
        uid,
        orgId,
        email: (_g = authUser.email) !== null && _g !== void 0 ? _g : email,
        displayName: (_h = authUser.displayName) !== null && _h !== void 0 ? _h : null,
        active: true,
        role,
        updatedAt: now,
        createdAt: now,
        source: 'root_upsert_user_v1',
    }, { merge: true });
    batch.set(membershipRef, {
        userId: uid,
        organizationId: orgId,
        role,
        active: true,
        updatedAt: now,
        createdAt: now,
        source: 'root_upsert_user_v1',
    }, { merge: true });
    await batch.commit();
    await auditLog({
        action: 'rootUpsertUserToOrganization',
        actorUid,
        actorEmail: (_l = (_k = (_j = context.auth) === null || _j === void 0 ? void 0 : _j.token) === null || _k === void 0 ? void 0 : _k.email) !== null && _l !== void 0 ? _l : null,
        orgId,
        targetUid: uid,
        targetEmail: email,
        before,
        after: { organizationId: orgId, role },
    });
    return { ok: true, uid, email, organizationId: orgId, role };
});
exports.rootDeactivateOrganization = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    const actorUid = requireRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    const isActive = Boolean((_b = data === null || data === void 0 ? void 0 : data.isActive) !== null && _b !== void 0 ? _b : false);
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const status = isActive ? 'active' : 'suspended';
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.collection('organizations').doc(orgId), {
        isActive,
        status,
        updatedAt: now,
        source: 'rootDeactivateOrganization_v1',
    }, { merge: true });
    batch.set(db.collection('organizationsPublic').doc(orgId), {
        isActive,
        status,
        updatedAt: now,
        source: 'rootDeactivateOrganization_v1',
    }, { merge: true });
    await batch.commit();
    await auditLog({
        action: 'rootDeactivateOrganization',
        actorUid,
        actorEmail: (_e = (_d = (_c = context.auth) === null || _c === void 0 ? void 0 : _c.token) === null || _d === void 0 ? void 0 : _d.email) !== null && _e !== void 0 ? _e : null,
        orgId,
        after: { isActive, status },
    });
    return { ok: true, organizationId: orgId, isActive, status };
});
exports.rootSetOrganizationPlan = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const actorUid = requireRoot(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = sanitizeOrganizationId(String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : ''));
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const reason = String((_e = data === null || data === void 0 ? void 0 : data.reason) !== null && _e !== void 0 ? _e : '').trim();
    if (!reason)
        throw httpsError('invalid-argument', 'reason requerido.');
    const requestedPlanIdRaw = String((_f = data === null || data === void 0 ? void 0 : data.planId) !== null && _f !== void 0 ? _f : '').trim();
    const requestedEntitlementStatusRaw = String((_h = (_g = data === null || data === void 0 ? void 0 : data.entitlementStatus) !== null && _g !== void 0 ? _g : data === null || data === void 0 ? void 0 : data.status) !== null && _h !== void 0 ? _h : '').trim();
    const requestedOrgStatusRaw = String((_j = data === null || data === void 0 ? void 0 : data.organizationStatus) !== null && _j !== void 0 ? _j : '').trim();
    const providerRaw = String((_k = data === null || data === void 0 ? void 0 : data.provider) !== null && _k !== void 0 ? _k : '').trim().toLowerCase();
    const provider = providerRaw === 'manual' ? 'manual' : DEFAULT_ENTITLEMENT_PROVIDER;
    const applyPlan = Boolean(requestedPlanIdRaw) || Boolean(requestedEntitlementStatusRaw);
    const applyOrgStatus = Boolean(requestedOrgStatusRaw);
    if (!applyPlan && !applyOrgStatus) {
        throw httpsError('invalid-argument', 'Debes enviar plan/status de entitlement y/o organizationStatus.');
    }
    const orgStatus = applyOrgStatus ? resolveOrganizationStatus(requestedOrgStatusRaw) : null;
    if (applyOrgStatus && !orgStatus) {
        throw httpsError('invalid-argument', 'organizationStatus inválido.');
    }
    const orgRef = db.collection('organizations').doc(orgId);
    const orgPublicRef = db.collection('organizationsPublic').doc(orgId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    let auditBefore = null;
    let auditAfter = null;
    let planCatalogFound = null;
    await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f;
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'La organización no existe.');
        const orgData = orgSnap.data();
        const currentEntitlement = orgData === null || orgData === void 0 ? void 0 : orgData.entitlement;
        const resolvedPlanId = resolveEntitlementPlanId({
            metadataPlanId: requestedPlanIdRaw || null,
            fallbackPlanId: currentEntitlement === null || currentEntitlement === void 0 ? void 0 : currentEntitlement.planId,
        });
        if (requestedPlanIdRaw) {
            const planSnap = await tx.get(db.collection('planCatalog').doc(resolvedPlanId));
            planCatalogFound = planSnap.exists;
            if (!planSnap.exists) {
                console.warn('rootSetOrganizationPlan: plan missing in planCatalog, applying manual override', {
                    orgId,
                    planId: resolvedPlanId,
                    actorUid,
                });
            }
        }
        const resolvedEntitlementStatus = requestedEntitlementStatusRaw
            ? resolveEntitlementStatus(requestedEntitlementStatusRaw)
            : (_a = currentEntitlement === null || currentEntitlement === void 0 ? void 0 : currentEntitlement.status) !== null && _a !== void 0 ? _a : 'active';
        if (!resolvedEntitlementStatus) {
            throw httpsError('invalid-argument', 'entitlementStatus inválido.');
        }
        const limits = resolveEffectiveLimitsForPlan(resolvedPlanId, currentEntitlement === null || currentEntitlement === void 0 ? void 0 : currentEntitlement.limits);
        const usage = (_b = currentEntitlement === null || currentEntitlement === void 0 ? void 0 : currentEntitlement.usage) !== null && _b !== void 0 ? _b : DEFAULT_ENTITLEMENT_USAGE;
        const nextEntitlement = buildEntitlementPayload({
            planId: resolvedPlanId,
            status: resolvedEntitlementStatus,
            provider,
            now,
            limits,
            usage,
        });
        const updatePayload = {
            updatedAt: now,
            source: 'rootSetOrganizationPlan_v1',
        };
        const publicUpdatePayload = {
            updatedAt: now,
            source: 'rootSetOrganizationPlan_v1',
        };
        if (applyPlan) {
            updatePayload.entitlement = nextEntitlement;
            updatePayload.billingProviders = Object.assign(Object.assign({}, (isPlainObject(orgData === null || orgData === void 0 ? void 0 : orgData.billingProviders) ? orgData.billingProviders : {})), { manual: {
                    planId: resolvedPlanId,
                    status: resolvedEntitlementStatus,
                    updatedAt: now,
                    conflict: false,
                    conflictReason: null,
                    reason,
                } });
        }
        if (orgStatus) {
            const isActive = orgStatus === 'active';
            updatePayload.status = orgStatus;
            updatePayload.isActive = isActive;
            publicUpdatePayload.status = orgStatus;
            publicUpdatePayload.isActive = isActive;
        }
        tx.set(orgRef, updatePayload, { merge: true });
        if (orgStatus) {
            tx.set(orgPublicRef, publicUpdatePayload, { merge: true });
        }
        auditBefore = {
            organizationStatus: (_c = orgData === null || orgData === void 0 ? void 0 : orgData.status) !== null && _c !== void 0 ? _c : null,
            isActive: (_d = orgData === null || orgData === void 0 ? void 0 : orgData.isActive) !== null && _d !== void 0 ? _d : null,
            entitlement: currentEntitlement !== null && currentEntitlement !== void 0 ? currentEntitlement : null,
        };
        auditAfter = {
            organizationStatus: (_e = orgStatus !== null && orgStatus !== void 0 ? orgStatus : orgData === null || orgData === void 0 ? void 0 : orgData.status) !== null && _e !== void 0 ? _e : null,
            isActive: orgStatus ? orgStatus === 'active' : (_f = orgData === null || orgData === void 0 ? void 0 : orgData.isActive) !== null && _f !== void 0 ? _f : null,
            entitlement: applyPlan
                ? {
                    planId: resolvedPlanId,
                    status: resolvedEntitlementStatus,
                    provider,
                }
                : currentEntitlement !== null && currentEntitlement !== void 0 ? currentEntitlement : null,
        };
    });
    await auditLog({
        action: 'rootSetOrganizationPlan',
        actorUid,
        actorEmail,
        orgId,
        before: auditBefore,
        after: auditAfter,
        meta: {
            reason,
            source: 'rootSetOrganizationPlan_v1',
            applyPlan,
            applyOrgStatus,
            planCatalogFound,
        },
    });
    return {
        ok: true,
        organizationId: orgId,
        updated: {
            plan: applyPlan,
            organizationStatus: applyOrgStatus,
        },
    };
});
exports.orgSetOrganizationStatus = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e;
    const actorUid = requireAuth(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    const status = String((_b = data === null || data === void 0 ? void 0 : data.status) !== null && _b !== void 0 ? _b : '').trim().toLowerCase();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!status || !['active', 'suspended', 'deleted'].includes(status)) {
        throw httpsError('invalid-argument', 'status inválido.');
    }
    await requireCallerSuperAdminInOrg(actorUid, orgId);
    const isActive = status === 'active';
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(db.collection('organizations').doc(orgId), {
        isActive,
        status,
        updatedAt: now,
        source: 'orgSetOrganizationStatus_v1',
    }, { merge: true });
    batch.set(db.collection('organizationsPublic').doc(orgId), {
        isActive,
        status,
        updatedAt: now,
        source: 'orgSetOrganizationStatus_v1',
    }, { merge: true });
    await batch.commit();
    await auditLog({
        action: 'orgSetOrganizationStatus',
        actorUid,
        actorEmail: (_e = (_d = (_c = context.auth) === null || _c === void 0 ? void 0 : _c.token) === null || _d === void 0 ? void 0 : _d.email) !== null && _e !== void 0 ? _e : null,
        orgId,
        after: { isActive, status },
    });
    return { ok: true, organizationId: orgId, isActive, status };
});
exports.rootDeleteOrganizationScaffold = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const actorUid = requireRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const batch = db.batch();
    batch.delete(db.collection('organizations').doc(orgId));
    batch.delete(db.collection('organizationsPublic').doc(orgId));
    await batch.commit();
    await auditLog({
        action: 'rootDeleteOrganizationScaffold',
        actorUid,
        actorEmail: (_d = (_c = (_b = context.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.email) !== null && _d !== void 0 ? _d : null,
        orgId,
    });
    return { ok: true, organizationId: orgId };
});
exports.rootPurgeOrganizationCollection = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f;
    const actorUid = requireRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    const collection = String((_b = data === null || data === void 0 ? void 0 : data.collection) !== null && _b !== void 0 ? _b : '').trim();
    const batchSize = Math.min(Math.max(Number((_c = data === null || data === void 0 ? void 0 : data.batchSize) !== null && _c !== void 0 ? _c : 200), 50), 500);
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!collection)
        throw httpsError('invalid-argument', 'collection requerida.');
    const allowed = new Set(['tickets', 'tasks', 'sites', 'assets', 'departments', 'members', 'joinRequests']);
    if (!allowed.has(collection))
        throw httpsError('invalid-argument', 'Colección no permitida para purge.');
    let totalDeleted = 0;
    while (true) {
        const q = db.collection('organizations').doc(orgId).collection(collection).limit(batchSize);
        const snap = await q.get();
        if (snap.empty)
            break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        totalDeleted += snap.size;
        if (snap.size < batchSize)
            break;
    }
    await auditLog({
        action: 'rootPurgeOrganizationCollection',
        actorUid,
        actorEmail: (_f = (_e = (_d = context.auth) === null || _d === void 0 ? void 0 : _d.token) === null || _e === void 0 ? void 0 : _e.email) !== null && _f !== void 0 ? _f : null,
        orgId,
        meta: { collection, totalDeleted, batchSize },
    });
    return { ok: true, organizationId: orgId, collection, deleted: totalDeleted };
});
/* ------------------------------
   ORG-SCOPED ROLE MGMT (callable)
   (para que el cliente NO toque roles)
--------------------------------- */
async function requireCallerSuperAdminInOrg(actorUid, orgId) {
    var _a;
    const mRef = db.collection('memberships').doc(`${actorUid}_${orgId}`);
    const mSnap = await mRef.get();
    if (!mSnap.exists)
        throw httpsError('permission-denied', 'No perteneces a esa organización.');
    // Backward-compat: some older docs used `active: true` instead of `status: 'active'`.
    const status = String((_a = mSnap.get('status')) !== null && _a !== void 0 ? _a : '') ||
        (mSnap.get('active') === true ? 'active' : 'pending');
    const role = normalizeRole(mSnap.get('role'));
    if (status !== 'active')
        throw httpsError('permission-denied', 'Tu membresía no está activa.');
    if (role !== 'super_admin')
        throw httpsError('permission-denied', 'Solo super_admin puede gestionar usuarios.');
}
async function resolveTargetUidByEmailOrUid(email, uid) {
    const u = String(uid !== null && uid !== void 0 ? uid : '').trim();
    if (u)
        return u;
    const e = String(email !== null && email !== void 0 ? email : '').trim().toLowerCase();
    if (!e)
        throw httpsError('invalid-argument', 'Debes indicar uid o email del usuario objetivo.');
    const authUser = await admin.auth().getUserByEmail(e).catch(() => null);
    if (!(authUser === null || authUser === void 0 ? void 0 : authUser.uid))
        throw httpsError('not-found', 'No existe ese usuario en Auth.');
    return authUser.uid;
}
async function setRoleWithinOrgImpl(params) {
    var _a, _b, _c;
    const { actorUid, actorEmail, isRoot, orgId, targetUid, role } = params;
    if (!isRoot) {
        await requireCallerSuperAdminInOrg(actorUid, orgId);
    }
    // Target must have a membership in this org
    const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
    const membershipSnap = await membershipRef.get();
    if (!membershipSnap.exists) {
        throw httpsError('failed-precondition', 'El usuario objetivo no tiene membresía en esa organización. Debe registrarse y solicitar acceso primero.');
    }
    const beforeRole = String((_a = membershipSnap.get('role')) !== null && _a !== void 0 ? _a : 'operario');
    const beforeStatus = String((_b = membershipSnap.get('status')) !== null && _b !== void 0 ? _b : '') ||
        (membershipSnap.get('active') === true ? 'active' : 'pending');
    if (beforeStatus !== 'active') {
        throw httpsError('failed-precondition', 'La membresía del usuario objetivo no está activa.');
    }
    if (beforeRole === role) {
        return { ok: true, uid: targetUid, organizationId: orgId, role, noChange: true };
    }
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
    void memberRef;
    const userRef = db.collection('users').doc(targetUid);
    const userSnap = await userRef.get();
    const userBefore = userSnap.exists ? userSnap.data() : null;
    const batch = db.batch();
    batch.set(userRef, {
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'setRoleWithinOrg_v1',
    }, { merge: true });
    batch.set(memberRef, {
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'setRoleWithinOrg_v1',
    }, { merge: true });
    batch.set(membershipRef, {
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'setRoleWithinOrg_v1',
    }, { merge: true });
    await batch.commit();
    await auditLog({
        action: 'setRoleWithinOrg',
        actorUid,
        actorEmail,
        orgId,
        targetUid,
        targetEmail: String((_c = userBefore === null || userBefore === void 0 ? void 0 : userBefore.email) !== null && _c !== void 0 ? _c : null),
        before: { role: beforeRole },
        after: { role },
    });
    return { ok: true, uid: targetUid, organizationId: orgId, role };
}
/* ------------------------------
   ONBOARDING / JOIN REQUESTS
--------------------------------- */
function sanitizeOrganizationId(input) {
    const raw = String(input !== null && input !== void 0 ? input : '').trim().toLowerCase();
    // allow a-z0-9, dash, underscore. Convert spaces to dashes, drop others.
    const spaced = raw.replace(/\s+/g, '-');
    const cleaned = spaced.replace(/[^a-z0-9_-]/g, '');
    return cleaned;
}
exports.resolveOrganizationId = functions.https.onCall(async (data) => {
    var _a, _b;
    const input = String((_a = data === null || data === void 0 ? void 0 : data.input) !== null && _a !== void 0 ? _a : '').trim();
    if (!input)
        throw httpsError('invalid-argument', 'input requerido.');
    const normalizedId = sanitizeOrganizationId(input);
    if (normalizedId) {
        const orgPublicRef = db.collection('organizationsPublic').doc(normalizedId);
        const orgSnap = await orgPublicRef.get();
        if (orgSnap.exists) {
            const orgData = orgSnap.data();
            return {
                organizationId: normalizedId,
                name: (_b = orgData === null || orgData === void 0 ? void 0 : orgData.name) !== null && _b !== void 0 ? _b : normalizedId,
                matchedBy: 'id',
                matches: [],
            };
        }
    }
    const nameLower = input.toLowerCase();
    const matches = [];
    const byNameLower = await db
        .collection('organizationsPublic')
        .where('nameLower', '==', nameLower)
        .limit(5)
        .get();
    byNameLower.forEach((docSnap) => {
        var _a;
        const data = docSnap.data();
        matches.push({ organizationId: docSnap.id, name: (_a = data === null || data === void 0 ? void 0 : data.name) !== null && _a !== void 0 ? _a : docSnap.id });
    });
    if (matches.length === 0) {
        const byNameExact = await db
            .collection('organizationsPublic')
            .where('name', '==', input)
            .limit(5)
            .get();
        byNameExact.forEach((docSnap) => {
            var _a;
            const data = docSnap.data();
            matches.push({ organizationId: docSnap.id, name: (_a = data === null || data === void 0 ? void 0 : data.name) !== null && _a !== void 0 ? _a : docSnap.id });
        });
    }
    if (matches.length === 1) {
        return {
            organizationId: matches[0].organizationId,
            name: matches[0].name,
            matchedBy: 'name',
            matches: [],
        };
    }
    return {
        organizationId: null,
        name: null,
        matchedBy: null,
        matches,
    };
});
exports.checkOrganizationAvailability = functions.https.onCall(async (data) => {
    var _a, _b, _c;
    const input = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (!input)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const normalizedId = sanitizeOrganizationId(input);
    if (!normalizedId)
        throw httpsError('invalid-argument', 'organizationId inválido.');
    const orgPublicRef = db.collection('organizationsPublic').doc(normalizedId);
    const orgSnap = await orgPublicRef.get();
    if (!orgSnap.exists) {
        return {
            normalizedId,
            available: true,
            suggestions: [],
            existingName: null,
        };
    }
    const existingName = String((_c = (_b = orgSnap.data()) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : normalizedId);
    const candidates = Array.from({ length: 5 }, (_, idx) => idx === 0 ? normalizedId : `${normalizedId}-${idx + 1}`);
    const taken = new Set();
    const snap = await db
        .collection('organizationsPublic')
        .where(admin.firestore.FieldPath.documentId(), 'in', candidates)
        .get();
    snap.forEach((docSnap) => taken.add(docSnap.id));
    const suggestions = candidates.filter((candidate) => !taken.has(candidate));
    return {
        normalizedId,
        available: false,
        suggestions,
        existingName,
    };
});
exports.bootstrapFromInvites = functions.https.onCall(async (_data, context) => {
    var _a, _b, _c, _d;
    const uid = requireAuth(context);
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    const email = ((_a = authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _a !== void 0 ? _a : '').trim().toLowerCase();
    if (!email) {
        throw httpsError('failed-precondition', 'Email requerido.');
    }
    const joinReqByEmail = db
        .collectionGroup('joinRequests')
        .where('email', '==', email)
        .where('status', '==', 'pending');
    const joinReqByUid = db
        .collectionGroup('joinRequests')
        .where('userId', '==', uid)
        .where('status', '==', 'pending');
    const [emailSnap, uidSnap] = await Promise.all([joinReqByEmail.get(), joinReqByUid.get()]);
    const joinReqDocs = new Map();
    emailSnap.docs.forEach((docSnap) => joinReqDocs.set(docSnap.ref.path, docSnap));
    uidSnap.docs.forEach((docSnap) => joinReqDocs.set(docSnap.ref.path, docSnap));
    if (joinReqDocs.size === 0) {
        return { ok: true, created: 0 };
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    let created = 0;
    for (const docSnap of joinReqDocs.values()) {
        const data = docSnap.data();
        const orgId = sanitizeOrganizationId(String((_b = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _b !== void 0 ? _b : ''));
        if (!orgId)
            continue;
        const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);
        const membershipSnap = await membershipRef.get();
        if (membershipSnap.exists)
            continue;
        batch.set(membershipRef, {
            userId: uid,
            organizationId: orgId,
            organizationName: String((_c = data === null || data === void 0 ? void 0 : data.organizationName) !== null && _c !== void 0 ? _c : orgId),
            role: (_d = normalizeRole(data === null || data === void 0 ? void 0 : data.requestedRole)) !== null && _d !== void 0 ? _d : 'operario',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapFromInvites_v1',
        }, { merge: true });
        batch.set(docSnap.ref, {
            userId: uid,
            updatedAt: now,
            source: 'bootstrapFromInvites_v1',
        }, { merge: true });
        created += 1;
    }
    if (created > 0) {
        await batch.commit();
    }
    return { ok: true, created };
});
exports.bootstrapSignup = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    const uid = requireAuth(context);
    const orgIdIn = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '');
    const organizationId = sanitizeOrganizationId(orgIdIn);
    if (!organizationId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const requestedRoleRaw = data === null || data === void 0 ? void 0 : data.requestedRole;
    const requestedRole = requestedRoleRaw ? normalizeRoleOrNull(requestedRoleRaw) : 'operario';
    if (!requestedRole)
        throw httpsError('invalid-argument', 'requestedRole inválido.');
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    const email = ((_b = authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _b !== void 0 ? _b : String((_c = data === null || data === void 0 ? void 0 : data.email) !== null && _c !== void 0 ? _c : '')).trim().toLowerCase();
    const displayName = ((_d = authUser === null || authUser === void 0 ? void 0 : authUser.displayName) !== null && _d !== void 0 ? _d : String((_e = data === null || data === void 0 ? void 0 : data.displayName) !== null && _e !== void 0 ? _e : '').trim()) || null;
    const orgRef = db.collection('organizations').doc(organizationId);
    const orgPublicRef = db.collection('organizationsPublic').doc(organizationId);
    const userRef = db.collection('users').doc(uid);
    const memberRef = orgRef.collection('members').doc(uid);
    void memberRef;
    const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    let orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
        const details = ((_f = data === null || data === void 0 ? void 0 : data.organizationDetails) !== null && _f !== void 0 ? _f : {});
        const orgName = String((_g = details === null || details === void 0 ? void 0 : details.name) !== null && _g !== void 0 ? _g : '').trim() || organizationId;
        const orgLegalName = String((_h = details === null || details === void 0 ? void 0 : details.legalName) !== null && _h !== void 0 ? _h : '').trim() || null;
        const isDemoOrg = organizationId.startsWith('demo-');
        const organizationType = isDemoOrg ? 'demo' : 'standard';
        if (!(authUser === null || authUser === void 0 ? void 0 : authUser.emailVerified)) {
            await db.collection('organizationSignupRequests').doc(uid).set({
                userId: uid,
                email: email || null,
                organizationId,
                organizationName: orgName,
                organizationLegalName: orgLegalName,
                organizationDetails: {
                    name: orgName,
                    legalName: orgLegalName,
                    taxId: String((_j = details === null || details === void 0 ? void 0 : details.taxId) !== null && _j !== void 0 ? _j : '').trim() || null,
                    country: String((_k = details === null || details === void 0 ? void 0 : details.country) !== null && _k !== void 0 ? _k : '').trim() || null,
                    address: String((_l = details === null || details === void 0 ? void 0 : details.address) !== null && _l !== void 0 ? _l : '').trim() || null,
                    billingEmail: String((_m = details === null || details === void 0 ? void 0 : details.billingEmail) !== null && _m !== void 0 ? _m : '').trim() || email || null,
                    phone: String((_o = details === null || details === void 0 ? void 0 : details.phone) !== null && _o !== void 0 ? _o : '').trim() || null,
                    teamSize: Number.isFinite(Number(details === null || details === void 0 ? void 0 : details.teamSize)) ? Number(details === null || details === void 0 ? void 0 : details.teamSize) : null,
                },
                status: 'verification_pending',
                createdAt: now,
                updatedAt: now,
                source: 'bootstrapSignup_v1',
            }, { merge: true });
            return { ok: true, mode: 'verification_required', organizationId };
        }
        const demoExpiresAt = isDemoOrg
            ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000))
            : null;
        const creationResult = await db.runTransaction(async (tx) => {
            var _a, _b, _c, _d, _e, _f;
            const [userSnapTx, orgSnapTx] = await tx.getAll(userRef, orgRef);
            if (orgSnapTx.exists) {
                return { created: false };
            }
            const userData = userSnapTx.exists ? userSnapTx.data() : null;
            const { accountPlan, createdOrganizationsCount, createdOrganizationsLimit, demoUsedAt } = getUserOrgQuota(userData);
            if (!isDemoOrg && createdOrganizationsCount >= createdOrganizationsLimit) {
                throw httpsError('failed-precondition', 'Has alcanzado el límite de organizaciones permitidas.');
            }
            if (isDemoOrg && demoUsedAt) {
                throw httpsError('failed-precondition', 'Ya utilizaste tu organización demo. No es posible crear otra.');
            }
            const userCreatedAt = userSnapTx.exists
                ? (_a = userSnapTx.get('createdAt')) !== null && _a !== void 0 ? _a : now
                : now;
            tx.create(orgRef, {
                organizationId,
                name: orgName,
                legalName: orgLegalName,
                taxId: String((_b = details === null || details === void 0 ? void 0 : details.taxId) !== null && _b !== void 0 ? _b : '').trim() || null,
                country: String((_c = details === null || details === void 0 ? void 0 : details.country) !== null && _c !== void 0 ? _c : '').trim() || null,
                address: String((_d = details === null || details === void 0 ? void 0 : details.address) !== null && _d !== void 0 ? _d : '').trim() || null,
                billingEmail: String((_e = details === null || details === void 0 ? void 0 : details.billingEmail) !== null && _e !== void 0 ? _e : '').trim() || email || null,
                contactPhone: String((_f = details === null || details === void 0 ? void 0 : details.phone) !== null && _f !== void 0 ? _f : '').trim() || null,
                teamSize: Number.isFinite(Number(details === null || details === void 0 ? void 0 : details.teamSize)) ? Number(details === null || details === void 0 ? void 0 : details.teamSize) : null,
                subscriptionPlan: 'trial',
                isActive: true,
                type: organizationType,
                status: 'active',
                entitlement: buildEntitlementPayload({
                    planId: 'free',
                    status: 'trialing',
                    trialEndsAt: demoExpiresAt !== null && demoExpiresAt !== void 0 ? demoExpiresAt : undefined,
                    now,
                }),
                settings: {
                    allowGuestAccess: false,
                    maxUsers: 50,
                    inviteOnly: false,
                },
                demoExpiresAt,
                createdByUserId: uid,
                createdAt: now,
                updatedAt: now,
                source: 'bootstrapSignup_v1',
            });
            // Create/update the org settings document (basic rentable defaults).
            tx.set(orgRef.collection('settings').doc('main'), Object.assign(Object.assign({ organizationId }, DEFAULT_ORG_SETTINGS_MAIN), { createdAt: now, updatedAt: now, source: 'bootstrapSignup_v1' }), { merge: true });
            tx.create(orgPublicRef, {
                organizationId,
                name: orgName,
                nameLower: orgName.toLowerCase(),
                isActive: true,
                type: organizationType,
                status: 'active',
                createdAt: now,
                updatedAt: now,
                source: 'bootstrapSignup_v1',
            });
            tx.set(userRef, {
                organizationId,
                email: email || null,
                displayName: displayName || email || 'Usuario',
                role: 'super_admin',
                active: true,
                accountPlan,
                createdOrganizationsCount: createdOrganizationsCount + (isDemoOrg ? 0 : 1),
                createdOrganizationsLimit,
                demoUsedAt: isDemoOrg ? now : demoUsedAt !== null && demoUsedAt !== void 0 ? demoUsedAt : null,
                updatedAt: now,
                createdAt: userCreatedAt,
                source: 'bootstrapSignup_v1',
            }, { merge: true });
            tx.create(membershipRef, {
                userId: uid,
                organizationId,
                organizationName: orgName,
                role: 'super_admin',
                status: 'active',
                primary: true,
                createdAt: now,
                updatedAt: now,
                source: 'bootstrapSignup_v1',
            });
            tx.create(memberRef, {
                uid,
                orgId: organizationId,
                email: email || null,
                displayName: displayName || email || 'Usuario',
                role: 'super_admin',
                active: true,
                createdAt: now,
                updatedAt: now,
                source: 'bootstrapSignup_v1',
            });
            return { created: true, isDemoOrg };
        });
        if (creationResult.created) {
            await auditLog({
                action: 'bootstrapSignup_create_org',
                actorUid: uid,
                actorEmail: email || null,
                orgId: organizationId,
                after: { organizationId, role: 'super_admin', status: 'active' },
            });
            if (isDemoOrg) {
                await seedDemoOrganizationData({ organizationId, uid });
            }
            return { ok: true, mode: 'created', organizationId };
        }
        orgSnap = await orgRef.get();
        if (!orgSnap.exists) {
            throw httpsError('internal', 'No se pudo crear la organización.');
        }
    }
    const orgData = orgSnap.data();
    const orgName = String((_p = orgData === null || orgData === void 0 ? void 0 : orgData.name) !== null && _p !== void 0 ? _p : organizationId);
    const inviteOnly = Boolean(((_q = orgData === null || orgData === void 0 ? void 0 : orgData.settings) === null || _q === void 0 ? void 0 : _q.inviteOnly) === true);
    const existingMembershipSnap = await membershipRef.get();
    if (existingMembershipSnap.exists) {
        const membershipData = existingMembershipSnap.data();
        const membershipStatus = String((_r = membershipData === null || membershipData === void 0 ? void 0 : membershipData.status) !== null && _r !== void 0 ? _r : '') ||
            ((membershipData === null || membershipData === void 0 ? void 0 : membershipData.active) === true ? 'active' : 'pending');
        return {
            ok: true,
            mode: membershipStatus === 'active' ? 'already_member' : 'pending',
            organizationId,
        };
    }
    const inviteByUidRef = orgRef.collection('joinRequests').doc(uid);
    const inviteByEmailRef = email ? orgRef.collection('joinRequests').doc(`invite_${email}`) : null;
    const [inviteByUidSnap, inviteByEmailSnap] = await Promise.all([
        inviteByUidRef.get(),
        inviteByEmailRef ? inviteByEmailRef.get() : Promise.resolve(null),
    ]);
    const existingInviteSnap = inviteByUidSnap.exists ? inviteByUidSnap : (inviteByEmailSnap === null || inviteByEmailSnap === void 0 ? void 0 : inviteByEmailSnap.exists) ? inviteByEmailSnap : null;
    if (inviteOnly && !existingInviteSnap) {
        throw httpsError('failed-precondition', 'Esta organización solo admite altas por invitación.');
    }
    const joinReqRef = (_s = existingInviteSnap === null || existingInviteSnap === void 0 ? void 0 : existingInviteSnap.ref) !== null && _s !== void 0 ? _s : inviteByUidRef;
    const batch = db.batch();
    batch.set(userRef, {
        organizationId,
        email: email || null,
        displayName: displayName || email || 'Usuario',
        role: 'pending',
        active: false,
        updatedAt: now,
        createdAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
    batch.set(membershipRef, {
        userId: uid,
        organizationId,
        organizationName: orgName,
        // El rol solicitado queda pendiente hasta aprobación.
        role: requestedRole,
        status: 'pending',
        primary: false,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
    const joinReqPayload = {
        userId: uid,
        organizationId,
        organizationName: orgName,
        email: email || null,
        displayName: displayName || email || 'Usuario',
        requestedRole,
        status: 'pending',
        updatedAt: now,
    };
    if (!existingInviteSnap) {
        joinReqPayload.createdAt = now;
        joinReqPayload.source = 'bootstrapSignup_v1';
    }
    batch.set(joinReqRef, joinReqPayload, { merge: true });
    await batch.commit();
    await auditLog({
        action: 'bootstrapSignup_join_request',
        actorUid: uid,
        actorEmail: email || null,
        orgId: organizationId,
        after: { organizationId, requestedRole, status: 'pending' },
    });
    return { ok: true, mode: 'pending', organizationId };
});
exports.finalizeOrganizationSignup = functions.https.onCall(async (_data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    const uid = requireAuth(context);
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    if (!(authUser === null || authUser === void 0 ? void 0 : authUser.emailVerified))
        throw httpsError('failed-precondition', 'Email no verificado.');
    const requestRef = db.collection('organizationSignupRequests').doc(uid);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
        return { ok: true, mode: 'noop' };
    }
    const requestData = requestSnap.data();
    const organizationId = sanitizeOrganizationId(String((_a = requestData === null || requestData === void 0 ? void 0 : requestData.organizationId) !== null && _a !== void 0 ? _a : ''));
    if (!organizationId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const orgRef = db.collection('organizations').doc(organizationId);
    const orgPublicRef = db.collection('organizationsPublic').doc(organizationId);
    const orgSnap = await orgRef.get();
    if (orgSnap.exists) {
        await requestRef.delete();
        return { ok: true, mode: 'already_exists', organizationId };
    }
    const orgDetails = (_b = requestData === null || requestData === void 0 ? void 0 : requestData.organizationDetails) !== null && _b !== void 0 ? _b : {};
    const orgName = String((_d = (_c = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.name) !== null && _c !== void 0 ? _c : requestData === null || requestData === void 0 ? void 0 : requestData.organizationName) !== null && _d !== void 0 ? _d : organizationId).trim() || organizationId;
    const orgLegalName = String((_f = (_e = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.legalName) !== null && _e !== void 0 ? _e : requestData === null || requestData === void 0 ? void 0 : requestData.organizationLegalName) !== null && _f !== void 0 ? _f : '').trim() || null;
    const isDemoOrg = organizationId.startsWith('demo-');
    const organizationType = isDemoOrg ? 'demo' : 'standard';
    const demoExpiresAt = isDemoOrg
        ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000))
        : null;
    const userRef = db.collection('users').doc(uid);
    const memberRef = orgRef.collection('members').doc(uid);
    const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const [userSnapTx, orgSnapTx] = await tx.getAll(userRef, orgRef);
        if (orgSnapTx.exists) {
            return;
        }
        const userData = userSnapTx.exists ? userSnapTx.data() : null;
        const { accountPlan, createdOrganizationsCount, createdOrganizationsLimit, demoUsedAt } = getUserOrgQuota(userData);
        if (!isDemoOrg && createdOrganizationsCount >= createdOrganizationsLimit) {
            throw httpsError('failed-precondition', 'Has alcanzado el límite de organizaciones permitidas.');
        }
        if (isDemoOrg && demoUsedAt) {
            throw httpsError('failed-precondition', 'Ya utilizaste tu organización demo. No es posible crear otra.');
        }
        const userCreatedAt = userSnapTx.exists
            ? (_a = userSnapTx.get('createdAt')) !== null && _a !== void 0 ? _a : now
            : now;
        tx.create(orgRef, {
            organizationId,
            name: orgName,
            legalName: orgLegalName,
            taxId: String((_b = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.taxId) !== null && _b !== void 0 ? _b : '').trim() || null,
            country: String((_c = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.country) !== null && _c !== void 0 ? _c : '').trim() || null,
            address: String((_d = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.address) !== null && _d !== void 0 ? _d : '').trim() || null,
            billingEmail: String((_e = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.billingEmail) !== null && _e !== void 0 ? _e : '').trim() || (authUser === null || authUser === void 0 ? void 0 : authUser.email) || null,
            contactPhone: String((_f = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.phone) !== null && _f !== void 0 ? _f : '').trim() || null,
            teamSize: Number.isFinite(Number(orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.teamSize)) ? Number(orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.teamSize) : null,
            subscriptionPlan: 'trial',
            isActive: true,
            type: organizationType,
            status: 'active',
            entitlement: buildEntitlementPayload({
                planId: 'free',
                status: 'trialing',
                trialEndsAt: demoExpiresAt !== null && demoExpiresAt !== void 0 ? demoExpiresAt : undefined,
                now,
            }),
            settings: {
                allowGuestAccess: false,
                maxUsers: 50,
                inviteOnly: false,
            },
            demoExpiresAt,
            createdByUserId: uid,
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        });
        tx.create(orgPublicRef, {
            organizationId,
            name: orgName,
            nameLower: orgName.toLowerCase(),
            isActive: true,
            type: organizationType,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        });
        tx.set(userRef, {
            organizationId,
            email: (_g = authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _g !== void 0 ? _g : null,
            displayName: (_j = (_h = authUser === null || authUser === void 0 ? void 0 : authUser.displayName) !== null && _h !== void 0 ? _h : authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _j !== void 0 ? _j : 'Usuario',
            role: 'super_admin',
            active: true,
            accountPlan,
            createdOrganizationsCount: createdOrganizationsCount + (isDemoOrg ? 0 : 1),
            createdOrganizationsLimit,
            demoUsedAt: isDemoOrg ? now : demoUsedAt !== null && demoUsedAt !== void 0 ? demoUsedAt : null,
            updatedAt: now,
            createdAt: userCreatedAt,
            source: 'bootstrapSignup_v1',
        }, { merge: true });
        tx.create(membershipRef, {
            userId: uid,
            organizationId,
            organizationName: orgName,
            role: 'super_admin',
            status: 'active',
            primary: true,
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        });
        tx.create(memberRef, {
            uid,
            orgId: organizationId,
            email: (_k = authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _k !== void 0 ? _k : null,
            displayName: (_m = (_l = authUser === null || authUser === void 0 ? void 0 : authUser.displayName) !== null && _l !== void 0 ? _l : authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _m !== void 0 ? _m : 'Usuario',
            role: 'super_admin',
            active: true,
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        });
        tx.delete(requestRef);
    });
    await requestRef.delete().catch(() => null);
    await auditLog({
        action: 'bootstrapSignup_create_org',
        actorUid: uid,
        actorEmail: (_g = authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _g !== void 0 ? _g : null,
        orgId: organizationId,
        after: { organizationId, role: 'super_admin', status: 'active' },
    });
    return { ok: true, mode: 'created', organizationId };
});
exports.setActiveOrganization = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const uid = requireAuth(context);
    const orgId = sanitizeOrganizationId(String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : ''));
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);
    const mSnap = await membershipRef.get();
    if (!mSnap.exists)
        throw httpsError('permission-denied', 'No perteneces a esa organización.');
    const status = String((_b = mSnap.get('status')) !== null && _b !== void 0 ? _b : '') ||
        (mSnap.get('active') === true ? 'active' : 'pending');
    if (status !== 'active')
        throw httpsError('failed-precondition', 'La membresía no está activa.');
    const role = normalizeRole(mSnap.get('role'));
    const email = ((_e = (_d = (_c = context.auth) === null || _c === void 0 ? void 0 : _c.token) === null || _d === void 0 ? void 0 : _d.email) !== null && _e !== void 0 ? _e : null);
    const displayName = (_j = ((_h = (_g = (_f = context.auth) === null || _f === void 0 ? void 0 : _f.token) === null || _g === void 0 ? void 0 : _g.name) !== null && _h !== void 0 ? _h : null)) !== null && _j !== void 0 ? _j : email;
    const now = admin.firestore.FieldValue.serverTimestamp();
    // 1) Persist active org on the user
    // 2) Make selected membership primary
    // 3) Ensure org-scoped member doc exists (used by UI list + rules)
    const batch = db.batch();
    batch.set(db.collection('users').doc(uid), {
        organizationId: orgId,
        updatedAt: now,
        source: 'setActiveOrganization_v2',
    }, { merge: true });
    batch.set(membershipRef, {
        primary: true,
        updatedAt: now,
        source: 'setActiveOrganization_v2',
    }, { merge: true });
    batch.set(db.collection('organizations').doc(orgId).collection('members').doc(uid), {
        uid,
        orgId,
        active: true,
        role,
        email,
        displayName,
        updatedAt: now,
        source: 'setActiveOrganization_v2',
    }, { merge: true });
    await batch.commit();
    // Best-effort: unset primary on other memberships for this user.
    // Not critical for correctness; avoids UI drift where an old org stays primary.
    try {
        const others = await db.collection('memberships').where('userId', '==', uid).get();
        const batch2 = db.batch();
        let writes = 0;
        for (const d of others.docs) {
            if (d.id !== `${uid}_${orgId}` && d.get('primary') === true) {
                batch2.set(d.ref, {
                    primary: false,
                    updatedAt: now,
                    source: 'setActiveOrganization_v2',
                }, { merge: true });
                writes += 1;
            }
        }
        if (writes > 0) {
            await batch2.commit();
        }
    }
    catch (_k) {
        // ignore
    }
    return { ok: true, organizationId: orgId };
});
/* ------------------------------
   ENTITLEMENT-LIMITED CREATION
--------------------------------- */
exports.createSite = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = resolveOrgIdFromData(data);
    const { role } = await requireActiveMembership(actorUid, orgId);
    requireRoleAllowed(role, ADMIN_LIKE_ROLES, 'No tienes permisos para crear ubicaciones.');
    if (!isPlainObject(data === null || data === void 0 ? void 0 : data.payload))
        throw httpsError('invalid-argument', 'payload requerido.');
    const name = requireStringField(data.payload.name, 'name');
    const code = requireStringField(data.payload.code, 'code');
    const orgRef = db.collection('organizations').doc(orgId);
    const siteRef = orgRef.collection('sites').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'Organización no encontrada.');
        const entitlement = orgSnap.get('entitlement');
        if (!entitlement)
            throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        ensureEntitlementAllowsCreate({ kind: 'sites', entitlement, features });
        tx.create(siteRef, {
            name,
            code,
            organizationId: orgId,
            createdAt: now,
            updatedAt: now,
            source: 'createSite_v1',
        });
        tx.update(orgRef, {
            [`entitlement.usage.${USAGE_FIELDS.sites}`]: admin.firestore.FieldValue.increment(1),
            'entitlement.updatedAt': now,
        });
    });
    await auditLog({
        action: 'createSite',
        actorUid,
        actorEmail,
        orgId,
        after: { siteId: siteRef.id, name, code },
    });
    return { ok: true, organizationId: orgId, siteId: siteRef.id };
});
exports.createDepartment = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = resolveOrgIdFromData(data);
    const { role } = await requireActiveMembership(actorUid, orgId);
    requireRoleAllowed(role, ADMIN_LIKE_ROLES, 'No tienes permisos para crear departamentos.');
    if (!isPlainObject(data === null || data === void 0 ? void 0 : data.payload))
        throw httpsError('invalid-argument', 'payload requerido.');
    const name = requireStringField(data.payload.name, 'name');
    const code = requireStringField(data.payload.code, 'code');
    const orgRef = db.collection('organizations').doc(orgId);
    const departmentRef = orgRef.collection('departments').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'Organización no encontrada.');
        const entitlement = orgSnap.get('entitlement');
        if (!entitlement)
            throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        ensureEntitlementAllowsCreate({ kind: 'departments', entitlement, features });
        tx.create(departmentRef, {
            name,
            code,
            organizationId: orgId,
            createdAt: now,
            updatedAt: now,
            source: 'createDepartment_v1',
        });
        tx.update(orgRef, {
            [`entitlement.usage.${USAGE_FIELDS.departments}`]: admin.firestore.FieldValue.increment(1),
            'entitlement.updatedAt': now,
        });
    });
    await auditLog({
        action: 'createDepartment',
        actorUid,
        actorEmail,
        orgId,
        after: { departmentId: departmentRef.id, name, code },
    });
    return { ok: true, organizationId: orgId, departmentId: departmentRef.id };
});
exports.createAsset = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = resolveOrgIdFromData(data);
    const { role, scope } = await requireActiveMembership(actorUid, orgId);
    requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para crear activos.');
    if (!isPlainObject(data === null || data === void 0 ? void 0 : data.payload))
        throw httpsError('invalid-argument', 'payload requerido.');
    const name = requireStringField(data.payload.name, 'name');
    const code = requireStringField(data.payload.code, 'code');
    const siteId = requireStringField(data.payload.siteId, 'siteId');
    requireScopedAccessToSite(role, scope, siteId);
    const orgRef = db.collection('organizations').doc(orgId);
    const siteRef = orgRef.collection('sites').doc(siteId);
    const assetRef = orgRef.collection('assets').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        var _a;
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'Organización no encontrada.');
        const entitlement = orgSnap.get('entitlement');
        if (!entitlement)
            throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
        const siteSnap = await tx.get(siteRef);
        if (!siteSnap.exists || String((_a = siteSnap.get('organizationId')) !== null && _a !== void 0 ? _a : '') !== orgId) {
            throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
        }
        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        ensureEntitlementAllowsCreate({ kind: 'assets', entitlement, features });
        tx.create(assetRef, {
            name,
            code,
            siteId,
            organizationId: orgId,
            createdAt: now,
            updatedAt: now,
            source: 'createAsset_v1',
        });
        tx.update(orgRef, {
            [`entitlement.usage.${USAGE_FIELDS.assets}`]: admin.firestore.FieldValue.increment(1),
            'entitlement.updatedAt': now,
        });
    });
    await auditLog({
        action: 'createAsset',
        actorUid,
        actorEmail,
        orgId,
        after: { assetId: assetRef.id, name, code, siteId },
    });
    return { ok: true, organizationId: orgId, assetId: assetRef.id };
});
exports.createPreventive = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = resolveOrgIdFromData(data);
    const { role, scope } = await requireActiveMembership(actorUid, orgId);
    requireRoleAllowed(role, new Set([...ADMIN_LIKE_ROLES, ...SCOPED_HEAD_ROLES]), 'No tienes permisos para crear preventivos.');
    if (!isPlainObject(data === null || data === void 0 ? void 0 : data.payload))
        throw httpsError('invalid-argument', 'payload requerido.');
    const payload = data.payload;
    const title = requireStringField(payload.title, 'title');
    const siteId = requireStringField(payload.siteId, 'siteId');
    const departmentId = requireStringField(payload.departmentId, 'departmentId');
    requireScopedAccessToDepartment(role, scope, departmentId);
    requireScopedAccessToSite(role, scope, siteId);
    const orgRef = db.collection('organizations').doc(orgId);
    const siteRef = orgRef.collection('sites').doc(siteId);
    const departmentRef = orgRef.collection('departments').doc(departmentId);
    const assetId = String((_d = payload.assetId) !== null && _d !== void 0 ? _d : '').trim();
    const assetRef = assetId ? orgRef.collection('assets').doc(assetId) : null;
    const ticketRef = orgRef.collection('tickets').doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d;
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'Organización no encontrada.');
        const entitlement = orgSnap.get('entitlement');
        if (!entitlement)
            throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
        const [siteSnap, departmentSnap] = await Promise.all([tx.get(siteRef), tx.get(departmentRef)]);
        if (!siteSnap.exists || String((_a = siteSnap.get('organizationId')) !== null && _a !== void 0 ? _a : '') !== orgId) {
            throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
        }
        if (!departmentSnap.exists || String((_b = departmentSnap.get('organizationId')) !== null && _b !== void 0 ? _b : '') !== orgId) {
            throw httpsError('failed-precondition', 'El departamento indicado no existe en esta organización.');
        }
        if (assetRef) {
            const assetSnap = await tx.get(assetRef);
            if (!assetSnap.exists || String((_c = assetSnap.get('organizationId')) !== null && _c !== void 0 ? _c : '') !== orgId) {
                throw httpsError('failed-precondition', 'El activo indicado no existe en esta organización.');
            }
        }
        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        ensureEntitlementAllowsCreate({ kind: 'preventives', entitlement, features });
        const sanitizedPayload = Object.assign(Object.assign({}, payload), { title,
            siteId,
            departmentId, assetId: assetId || null, status: String((_d = payload.status) !== null && _d !== void 0 ? _d : 'new'), type: 'preventivo', organizationId: orgId, createdBy: actorUid, createdAt: now, updatedAt: now, source: 'createPreventive_v1' });
        tx.create(ticketRef, sanitizedPayload);
        tx.update(orgRef, {
            [`entitlement.usage.${USAGE_FIELDS.preventives}`]: admin.firestore.FieldValue.increment(1),
            'entitlement.updatedAt': now,
        });
    });
    await auditLog({
        action: 'createPreventive',
        actorUid,
        actorEmail,
        orgId,
        after: { ticketId: ticketRef.id, title, siteId, departmentId },
    });
    return { ok: true, organizationId: orgId, ticketId: ticketRef.id };
});
exports.createPreventiveTemplate = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    try {
        const actorUid = requireAuth(context);
        const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
        const orgId = resolveOrgIdFromData(data);
        const { role, scope } = await requireActiveMembership(actorUid, orgId);
        requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para crear plantillas preventivas.');
        if (!isPlainObject(data))
            throw httpsError('invalid-argument', 'payload requerido.');
        const name = requireStringField(data.name, 'name');
        const description = String((_d = data.description) !== null && _d !== void 0 ? _d : '').trim();
        const status = String((_e = data.status) !== null && _e !== void 0 ? _e : 'active').trim();
        const automatic = Boolean(data.automatic);
        const priority = String((_f = data.priority) !== null && _f !== void 0 ? _f : 'Media').trim();
        const siteId = String((_g = data.siteId) !== null && _g !== void 0 ? _g : '').trim();
        const departmentId = String((_h = data.departmentId) !== null && _h !== void 0 ? _h : '').trim();
        const assetId = String((_j = data.assetId) !== null && _j !== void 0 ? _j : '').trim();
        if (!isPlainObject(data.schedule))
            throw httpsError('invalid-argument', 'schedule requerido.');
        const scheduleType = String((_k = data.schedule.type) !== null && _k !== void 0 ? _k : '').trim();
        if (!['daily', 'weekly', 'monthly', 'date'].includes(scheduleType)) {
            throw httpsError('invalid-argument', 'schedule.type inválido.');
        }
        if (automatic && status === 'active') {
            if (!siteId)
                throw httpsError('invalid-argument', 'siteId requerido para preventivos automáticos activos.');
            if (!departmentId)
                throw httpsError('invalid-argument', 'departmentId requerido para preventivos automáticos activos.');
        }
        requireScopedAccessToSite(role, scope, siteId);
        requireScopedAccessToDepartment(role, scope, departmentId);
        const timeOfDay = String((_l = data.schedule.timeOfDay) !== null && _l !== void 0 ? _l : '').trim();
        const timezone = String((_m = data.schedule.timezone) !== null && _m !== void 0 ? _m : '').trim();
        const daysOfWeekRaw = Array.isArray(data.schedule.daysOfWeek) ? data.schedule.daysOfWeek : [];
        const daysOfWeek = daysOfWeekRaw
            .map((d) => Number(d))
            .filter((d) => Number.isFinite(d) && d >= 1 && d <= 7);
        const dayOfMonthRaw = data.schedule.dayOfMonth;
        const dayOfMonth = Number.isFinite(Number(dayOfMonthRaw)) ? Number(dayOfMonthRaw) : undefined;
        let dateTs;
        if (scheduleType === 'date') {
            const dateStr = String((_o = data.schedule.date) !== null && _o !== void 0 ? _o : '').trim();
            if (!dateStr)
                throw httpsError('invalid-argument', 'schedule.date requerido para tipo date.');
            const parsed = new Date(dateStr);
            if (Number.isNaN(parsed.getTime())) {
                throw httpsError('invalid-argument', 'schedule.date inválido.');
            }
            dateTs = admin.firestore.Timestamp.fromDate(parsed);
        }
        const schedule = {
            type: scheduleType,
            timezone: timezone || undefined,
            timeOfDay: timeOfDay || undefined,
            daysOfWeek: daysOfWeek.length ? daysOfWeek : undefined,
            dayOfMonth: scheduleType === 'monthly' ? dayOfMonth : undefined,
            date: scheduleType === 'date' ? dateTs : undefined,
        };
        const now = admin.firestore.FieldValue.serverTimestamp();
        const orgRef = db.collection('organizations').doc(orgId);
        const templateRef = orgRef.collection('preventiveTemplates').doc();
        await db.runTransaction(async (tx) => {
            var _a, _b, _c, _d;
            const orgSnap = await tx.get(orgRef);
            if (!orgSnap.exists)
                throw httpsError('not-found', 'Organización no encontrada.');
            const orgData = orgSnap.data();
            const entitlement = orgSnap.get('entitlement');
            if (!entitlement)
                throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
            const isDemoOrg = isDemoOrganization(orgId, orgData);
            let features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
            let effectiveEntitlement = entitlement;
            if (!(0, entitlements_1.isFeatureEnabled)(Object.assign(Object.assign({}, entitlement), { features }), 'PREVENTIVES')) {
                const fallbackEntitlement = await resolveFallbackPreventivesEntitlementForTx(tx, orgData, entitlement);
                if (fallbackEntitlement) {
                    effectiveEntitlement = fallbackEntitlement.entitlement;
                    features = fallbackEntitlement.features;
                }
            }
            ensureEntitlementAllowsCreate({
                kind: 'preventives',
                entitlement: effectiveEntitlement,
                features,
                orgType: String((_a = orgData === null || orgData === void 0 ? void 0 : orgData.type) !== null && _a !== void 0 ? _a : ''),
            });
            await ensureDemoTemplateLimit(tx, orgRef, isDemoOrg);
            // Validate referenced master data exists when provided.
            if (siteId) {
                const siteSnap = await tx.get(orgRef.collection('sites').doc(siteId));
                if (!siteSnap.exists || String((_b = siteSnap.get('organizationId')) !== null && _b !== void 0 ? _b : '') !== orgId) {
                    throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
                }
            }
            if (departmentId) {
                const deptSnap = await tx.get(orgRef.collection('departments').doc(departmentId));
                if (!deptSnap.exists || String((_c = deptSnap.get('organizationId')) !== null && _c !== void 0 ? _c : '') !== orgId) {
                    throw httpsError('failed-precondition', 'El departamento indicado no existe en esta organización.');
                }
            }
            if (assetId) {
                const assetSnap = await tx.get(orgRef.collection('assets').doc(assetId));
                if (!assetSnap.exists || String((_d = assetSnap.get('organizationId')) !== null && _d !== void 0 ? _d : '') !== orgId) {
                    throw httpsError('failed-precondition', 'El activo indicado no existe en esta organización.');
                }
            }
            const zonedNow = resolveZonedDate(schedule.timezone);
            const computed = automatic && status === 'active' ? computeNextRunAt(schedule, zonedNow) : null;
            const storedSchedule = Object.assign(Object.assign({}, schedule), { nextRunAt: computed ? admin.firestore.Timestamp.fromDate(computed) : undefined, lastRunAt: undefined });
            tx.create(templateRef, {
                name,
                description: description || undefined,
                status,
                automatic,
                schedule: storedSchedule,
                priority,
                siteId: siteId || undefined,
                departmentId: departmentId || undefined,
                assetId: assetId || undefined,
                createdBy: actorUid,
                updatedBy: actorUid,
                organizationId: orgId,
                createdAt: now,
                updatedAt: now,
                source: 'createPreventiveTemplate_v1',
            });
        });
        await auditLog({
            action: 'createPreventiveTemplate',
            actorUid,
            actorEmail,
            orgId,
            after: { templateId: templateRef.id, name, status, automatic },
        });
        return { ok: true, organizationId: orgId, templateId: templateRef.id };
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        console.error('createPreventiveTemplate: unexpected error', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        throw httpsError('failed-precondition', 'No se pudo crear la plantilla preventiva. Revisa plan, permisos y datos de programación.');
    }
});
exports.updatePreventiveTemplate = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = resolveOrgIdFromData(data);
    const templateId = requireStringField(data.templateId, 'templateId');
    const { role, scope } = await requireActiveMembership(actorUid, orgId);
    requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para editar plantillas preventivas.');
    if (!isPlainObject(data))
        throw httpsError('invalid-argument', 'payload requerido.');
    const name = requireStringField(data.name, 'name');
    const description = String((_d = data.description) !== null && _d !== void 0 ? _d : '').trim();
    const status = String((_e = data.status) !== null && _e !== void 0 ? _e : 'active').trim();
    const automatic = Boolean(data.automatic);
    const priority = String((_f = data.priority) !== null && _f !== void 0 ? _f : 'Media').trim();
    const siteId = String((_g = data.siteId) !== null && _g !== void 0 ? _g : '').trim();
    const departmentId = String((_h = data.departmentId) !== null && _h !== void 0 ? _h : '').trim();
    const assetId = String((_j = data.assetId) !== null && _j !== void 0 ? _j : '').trim();
    if (!isPlainObject(data.schedule))
        throw httpsError('invalid-argument', 'schedule requerido.');
    const scheduleType = String((_k = data.schedule.type) !== null && _k !== void 0 ? _k : '').trim();
    if (!['daily', 'weekly', 'monthly', 'date'].includes(scheduleType)) {
        throw httpsError('invalid-argument', 'schedule.type inválido.');
    }
    if (automatic && status === 'active') {
        if (!siteId)
            throw httpsError('invalid-argument', 'siteId requerido para preventivos automáticos activos.');
        if (!departmentId)
            throw httpsError('invalid-argument', 'departmentId requerido para preventivos automáticos activos.');
    }
    requireScopedAccessToSite(role, scope, siteId);
    requireScopedAccessToDepartment(role, scope, departmentId);
    const timeOfDay = String((_l = data.schedule.timeOfDay) !== null && _l !== void 0 ? _l : '').trim();
    const timezone = String((_m = data.schedule.timezone) !== null && _m !== void 0 ? _m : '').trim();
    const daysOfWeekRaw = Array.isArray(data.schedule.daysOfWeek) ? data.schedule.daysOfWeek : [];
    const daysOfWeek = daysOfWeekRaw
        .map((d) => Number(d))
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= 7);
    const dayOfMonthRaw = data.schedule.dayOfMonth;
    const dayOfMonth = Number.isFinite(Number(dayOfMonthRaw)) ? Number(dayOfMonthRaw) : undefined;
    let dateTs;
    if (scheduleType === 'date') {
        const dateStr = String((_o = data.schedule.date) !== null && _o !== void 0 ? _o : '').trim();
        if (!dateStr)
            throw httpsError('invalid-argument', 'schedule.date requerido para tipo date.');
        const parsed = new Date(dateStr);
        if (Number.isNaN(parsed.getTime())) {
            throw httpsError('invalid-argument', 'schedule.date inválido.');
        }
        dateTs = admin.firestore.Timestamp.fromDate(parsed);
    }
    const schedule = {
        type: scheduleType,
        timezone: timezone || undefined,
        timeOfDay: timeOfDay || undefined,
        daysOfWeek: daysOfWeek.length ? daysOfWeek : undefined,
        dayOfMonth: scheduleType === 'monthly' ? dayOfMonth : undefined,
        date: scheduleType === 'date' ? dateTs : undefined,
    };
    const now = admin.firestore.FieldValue.serverTimestamp();
    const orgRef = db.collection('organizations').doc(orgId);
    const templateRef = orgRef.collection('preventiveTemplates').doc(templateId);
    await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'Organización no encontrada.');
        const templateSnap = await tx.get(templateRef);
        if (!templateSnap.exists)
            throw httpsError('not-found', 'Plantilla no encontrada.');
        if (String((_a = templateSnap.get('organizationId')) !== null && _a !== void 0 ? _a : '') !== orgId) {
            throw httpsError('permission-denied', 'Plantilla fuera de la organización.');
        }
        const orgData = orgSnap.data();
        const entitlement = orgSnap.get('entitlement');
        if (!entitlement)
            throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        ensureEntitlementAllowsCreate({
            kind: 'preventives',
            entitlement,
            features,
            orgType: String((_b = orgData === null || orgData === void 0 ? void 0 : orgData.type) !== null && _b !== void 0 ? _b : ''),
        });
        if (siteId) {
            const siteSnap = await tx.get(orgRef.collection('sites').doc(siteId));
            if (!siteSnap.exists || String((_c = siteSnap.get('organizationId')) !== null && _c !== void 0 ? _c : '') !== orgId) {
                throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
            }
        }
        if (departmentId) {
            const deptSnap = await tx.get(orgRef.collection('departments').doc(departmentId));
            if (!deptSnap.exists || String((_d = deptSnap.get('organizationId')) !== null && _d !== void 0 ? _d : '') !== orgId) {
                throw httpsError('failed-precondition', 'El departamento indicado no existe en esta organización.');
            }
        }
        if (assetId) {
            const assetSnap = await tx.get(orgRef.collection('assets').doc(assetId));
            if (!assetSnap.exists || String((_e = assetSnap.get('organizationId')) !== null && _e !== void 0 ? _e : '') !== orgId) {
                throw httpsError('failed-precondition', 'El activo indicado no existe en esta organización.');
            }
        }
        const zonedNow = resolveZonedDate(schedule.timezone);
        const computed = automatic && status === 'active' ? computeNextRunAt(schedule, zonedNow) : null;
        const storedSchedule = Object.assign(Object.assign({}, schedule), { nextRunAt: computed ? admin.firestore.Timestamp.fromDate(computed) : undefined, lastRunAt: schedule.type === 'date' ? undefined : templateSnap.get('schedule.lastRunAt') });
        tx.update(templateRef, {
            name,
            description: description || undefined,
            status,
            automatic,
            schedule: storedSchedule,
            priority,
            siteId: siteId || undefined,
            departmentId: departmentId || undefined,
            assetId: assetId || undefined,
            updatedBy: actorUid,
            updatedAt: now,
            source: 'updatePreventiveTemplate_v1',
        });
    });
    await auditLog({
        action: 'updatePreventiveTemplate',
        actorUid,
        actorEmail,
        orgId,
        after: { templateId, name, status, automatic },
    });
    return { ok: true, organizationId: orgId, templateId };
});
exports.duplicatePreventiveTemplate = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = resolveOrgIdFromData(data);
    const templateId = requireStringField(data.templateId, 'templateId');
    const { role } = await requireActiveMembership(actorUid, orgId);
    requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para duplicar plantillas preventivas.');
    const now = admin.firestore.FieldValue.serverTimestamp();
    const orgRef = db.collection('organizations').doc(orgId);
    const sourceRef = orgRef.collection('preventiveTemplates').doc(templateId);
    const targetRef = orgRef.collection('preventiveTemplates').doc();
    let newName = '';
    await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d;
        const [orgSnap, sourceSnap] = await Promise.all([tx.get(orgRef), tx.get(sourceRef)]);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'Organización no encontrada.');
        if (!sourceSnap.exists)
            throw httpsError('not-found', 'Plantilla no encontrada.');
        if (String((_a = sourceSnap.get('organizationId')) !== null && _a !== void 0 ? _a : '') !== orgId) {
            throw httpsError('permission-denied', 'Plantilla fuera de la organización.');
        }
        const orgData = orgSnap.data();
        const entitlement = orgSnap.get('entitlement');
        if (!entitlement)
            throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
        const isDemoOrg = isDemoOrganization(orgId, orgData);
        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        ensureEntitlementAllowsCreate({
            kind: 'preventives',
            entitlement,
            features,
            orgType: String((_b = orgData === null || orgData === void 0 ? void 0 : orgData.type) !== null && _b !== void 0 ? _b : ''),
        });
        await ensureDemoTemplateLimit(tx, orgRef, isDemoOrg);
        const sourceData = sourceSnap.data();
        const baseName = String((_c = sourceData === null || sourceData === void 0 ? void 0 : sourceData.name) !== null && _c !== void 0 ? _c : '').trim() || 'Plantilla';
        newName = `Copia de ${baseName}`;
        const schedule = ((_d = sourceData === null || sourceData === void 0 ? void 0 : sourceData.schedule) !== null && _d !== void 0 ? _d : {});
        const storedSchedule = Object.assign(Object.assign({}, schedule), { nextRunAt: undefined, lastRunAt: undefined });
        tx.create(targetRef, Object.assign(Object.assign({}, sourceData), { name: newName, status: 'paused', schedule: storedSchedule, createdBy: actorUid, updatedBy: actorUid, createdAt: now, updatedAt: now, source: 'duplicatePreventiveTemplate_v1' }));
    });
    await auditLog({
        action: 'duplicatePreventiveTemplate',
        actorUid,
        actorEmail,
        orgId,
        after: { templateId: targetRef.id, sourceTemplateId: templateId, name: newName },
    });
    return { ok: true, organizationId: orgId, templateId: targetRef.id };
});
exports.inviteUserToOrg = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = resolveOrgIdFromData(data);
    const email = requireStringField(data === null || data === void 0 ? void 0 : data.email, 'email').toLowerCase();
    const displayName = String((_d = data === null || data === void 0 ? void 0 : data.displayName) !== null && _d !== void 0 ? _d : '').trim();
    const requestedRole = (_e = normalizeRole(data === null || data === void 0 ? void 0 : data.role)) !== null && _e !== void 0 ? _e : 'operario';
    const departmentId = String((_f = data === null || data === void 0 ? void 0 : data.departmentId) !== null && _f !== void 0 ? _f : '').trim();
    await requireCallerSuperAdminInOrg(actorUid, orgId);
    let targetUid = '';
    try {
        const authUser = await admin.auth().getUserByEmail(email);
        targetUid = authUser.uid;
    }
    catch (_g) {
        targetUid = '';
    }
    const inviteId = targetUid || `invite_${email}`;
    const orgRef = db.collection('organizations').doc(orgId);
    const joinReqRef = orgRef.collection('joinRequests').doc(inviteId);
    const now = admin.firestore.FieldValue.serverTimestamp();
    let alreadyPending = false;
    let orgName = orgId;
    await db.runTransaction(async (tx) => {
        var _a, _b, _c, _d;
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw httpsError('not-found', 'Organización no encontrada.');
        orgName = String((_b = (_a = orgSnap.data()) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : orgId);
        const entitlement = orgSnap.get('entitlement');
        if (!entitlement)
            throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        ensureEntitlementAllowsCreate({ kind: 'users', entitlement, features });
        if (targetUid) {
            const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
            const membershipSnap = await tx.get(membershipRef);
            if (membershipSnap.exists) {
                const status = String((_c = membershipSnap.get('status')) !== null && _c !== void 0 ? _c : '') ||
                    (membershipSnap.get('active') === true ? 'active' : 'pending');
                if (status === 'active') {
                    throw httpsError('failed-precondition', 'El usuario ya pertenece a la organización.');
                }
            }
        }
        const existingJoinReq = await tx.get(joinReqRef);
        if (existingJoinReq.exists && String((_d = existingJoinReq.get('status')) !== null && _d !== void 0 ? _d : '') === 'pending') {
            alreadyPending = true;
            return;
        }
        tx.set(joinReqRef, {
            userId: targetUid || null,
            organizationId: orgId,
            organizationName: orgName,
            email,
            displayName: displayName || email,
            requestedRole,
            status: 'pending',
            departmentId: departmentId || null,
            invitedBy: actorUid,
            invitedByEmail: actorEmail,
            invitedAt: now,
            createdAt: now,
            updatedAt: now,
            source: 'inviteUserToOrg_v1',
        }, { merge: true });
        tx.update(orgRef, {
            [`entitlement.usage.${USAGE_FIELDS.users}`]: admin.firestore.FieldValue.increment(1),
            'entitlement.updatedAt': now,
        });
    });
    if (!alreadyPending) {
        try {
            await (0, invite_email_1.sendInviteEmail)({
                recipientEmail: email,
                orgName,
                role: requestedRole,
                inviteLink: 'https://multi.maintelligence.app/login',
            });
        }
        catch (error) {
            console.warn('Error enviando email de invitación.', error);
        }
    }
    await auditLog({
        action: 'inviteUserToOrg',
        actorUid,
        actorEmail,
        orgId,
        targetUid: targetUid || null,
        targetEmail: email,
        after: { status: 'pending', role: requestedRole, requestId: inviteId },
    });
    return { ok: true, organizationId: orgId, uid: targetUid || null, requestId: inviteId, alreadyPending };
});
exports.pauseExpiredDemoPreventives = functions.pubsub
    .schedule('every 24 hours')
    .timeZone('UTC')
    .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const orgsSnap = await db
        .collection('organizations')
        .where('demoExpiresAt', '<=', now)
        .get();
    if (orgsSnap.empty)
        return null;
    for (const orgDoc of orgsSnap.docs) {
        await pausePreventiveTicketsForOrg(orgDoc.id, now);
    }
    return null;
});
exports.pausePreventivesWithoutEntitlement = functions.pubsub
    .schedule('every 24 hours')
    .timeZone('UTC')
    .onRun(async () => {
    const planCatalogSnap = await db.collection('planCatalog').get();
    if (planCatalogSnap.empty)
        return null;
    const blockedPlanIds = planCatalogSnap.docs
        .filter((planDoc) => {
        const features = planDoc.get('features');
        return (features === null || features === void 0 ? void 0 : features.PREVENTIVES) !== true;
    })
        .map((planDoc) => planDoc.id);
    if (blockedPlanIds.length === 0)
        return null;
    const now = admin.firestore.Timestamp.now();
    for (let i = 0; i < blockedPlanIds.length; i += 10) {
        const chunk = blockedPlanIds.slice(i, i + 10);
        const orgsSnap = await db
            .collection('organizations')
            .where('entitlement.planId', 'in', chunk)
            .get();
        if (orgsSnap.empty)
            continue;
        for (const orgDoc of orgsSnap.docs) {
            await pausePreventiveTicketsForOrg(orgDoc.id, now);
        }
    }
    return null;
});
exports.generatePreventiveTickets = functions.pubsub
    .schedule('every 60 minutes')
    .timeZone('UTC')
    .onRun(async () => {
    var _a;
    const templatesSnap = await db
        .collectionGroup('preventiveTemplates')
        .where('status', '==', 'active')
        .where('automatic', '==', true)
        .get();
    if (templatesSnap.empty)
        return null;
    for (const templateDoc of templatesSnap.docs) {
        const template = templateDoc.data();
        const orgId = resolveTemplateOrgId(templateDoc.ref, template);
        if (!orgId)
            continue;
        if (!((_a = template.schedule) === null || _a === void 0 ? void 0 : _a.type))
            continue;
        if (!template.siteId || !template.departmentId)
            continue;
        const orgRef = db.collection('organizations').doc(orgId);
        const templateRef = templateDoc.ref;
        let createdTicketId = null;
        await db.runTransaction(async (tx) => {
            var _a, _b, _c, _d, _e, _f, _g;
            const [orgSnap, templateSnap] = await Promise.all([tx.get(orgRef), tx.get(templateRef)]);
            if (!orgSnap.exists || !templateSnap.exists)
                return;
            const orgData = orgSnap.data();
            if ((orgData === null || orgData === void 0 ? void 0 : orgData.preventivesPausedByEntitlement) === true)
                return;
            const entitlement = orgData === null || orgData === void 0 ? void 0 : orgData.entitlement;
            if (!entitlement)
                return;
            const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
            if (!(0, entitlements_1.isFeatureEnabled)(Object.assign(Object.assign({}, entitlement), { features }), 'PREVENTIVES'))
                return;
            const freshTemplate = templateSnap.data();
            if (!freshTemplate.automatic || freshTemplate.status !== 'active')
                return;
            if (!freshTemplate.siteId || !freshTemplate.departmentId)
                return;
            const schedule = freshTemplate.schedule;
            if (!(schedule === null || schedule === void 0 ? void 0 : schedule.type))
                return;
            if (schedule.type === 'date' && schedule.lastRunAt)
                return;
            const nowZoned = resolveZonedDate(schedule.timezone);
            const nextRunDate = (_b = (_a = schedule.nextRunAt) === null || _a === void 0 ? void 0 : _a.toDate()) !== null && _b !== void 0 ? _b : computeNextRunAt(schedule, nowZoned);
            if (!nextRunDate) {
                tx.update(templateRef, {
                    'schedule.nextRunAt': null,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                return;
            }
            if (nextRunDate > nowZoned) {
                if (!schedule.nextRunAt) {
                    tx.update(templateRef, {
                        'schedule.nextRunAt': admin.firestore.Timestamp.fromDate(nextRunDate),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                return;
            }
            const runAtTimestamp = admin.firestore.Timestamp.fromDate(nextRunDate);
            const ticketId = `prev_${templateRef.id}_${runAtTimestamp.toMillis()}`;
            const ticketRef = orgRef.collection('tickets').doc(ticketId);
            const existingTicket = await tx.get(ticketRef);
            const nextBase = new Date(nextRunDate.getTime() + 60 * 1000);
            const followingRunDate = schedule.type === 'date' ? null : computeNextRunAt(schedule, nextBase);
            const frequencyDays = resolveFrequencyDays(schedule);
            if (!existingTicket.exists) {
                const now = admin.firestore.FieldValue.serverTimestamp();
                const ticketPayload = {
                    organizationId: orgId,
                    type: 'preventivo',
                    status: 'new',
                    priority: (_c = freshTemplate.priority) !== null && _c !== void 0 ? _c : 'Media',
                    siteId: freshTemplate.siteId,
                    departmentId: freshTemplate.departmentId,
                    assetId: (_d = freshTemplate.assetId) !== null && _d !== void 0 ? _d : null,
                    title: freshTemplate.name,
                    description: (_e = freshTemplate.description) !== null && _e !== void 0 ? _e : '',
                    createdBy: (_f = freshTemplate.createdBy) !== null && _f !== void 0 ? _f : 'system',
                    assignedRole: 'mantenimiento',
                    assignedTo: null,
                    createdAt: now,
                    updatedAt: now,
                    preventiveTemplateId: templateRef.id,
                    templateSnapshot: {
                        name: freshTemplate.name,
                        frequencyDays,
                    },
                    preventive: {
                        frequencyDays,
                        scheduledFor: runAtTimestamp,
                        checklist: (_g = freshTemplate.checklist) !== null && _g !== void 0 ? _g : [],
                    },
                    source: 'generatePreventiveTickets_v1',
                };
                tx.create(ticketRef, ticketPayload);
                ensureEntitlementAllowsCreate({ kind: 'preventives', entitlement, features });
                tx.update(orgRef, {
                    [`entitlement.usage.${USAGE_FIELDS.preventives}`]: admin.firestore.FieldValue.increment(1),
                    'entitlement.updatedAt': now,
                });
                createdTicketId = ticketRef.id;
            }
            tx.update(templateRef, {
                'schedule.lastRunAt': runAtTimestamp,
                'schedule.nextRunAt': followingRunDate
                    ? admin.firestore.Timestamp.fromDate(followingRunDate)
                    : null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });
        if (createdTicketId) {
            await auditLog({
                action: 'generatePreventiveTicket',
                actorUid: 'system',
                orgId,
                after: {
                    templateId: templateDoc.id,
                    ticketId: createdTicketId,
                },
            });
        }
    }
    return null;
});
exports.orgInviteUser = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    if (applyCors(req, res))
        return;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }
    try {
        const decoded = await requireAuthFromRequest(req);
        const actorUid = decoded.uid;
        const actorEmail = ((_a = decoded.email) !== null && _a !== void 0 ? _a : null);
        const orgId = sanitizeOrganizationId(String((_c = (_b = req.body) === null || _b === void 0 ? void 0 : _b.organizationId) !== null && _c !== void 0 ? _c : ''));
        const email = String((_e = (_d = req.body) === null || _d === void 0 ? void 0 : _d.email) !== null && _e !== void 0 ? _e : '').trim().toLowerCase();
        const displayName = String((_g = (_f = req.body) === null || _f === void 0 ? void 0 : _f.displayName) !== null && _g !== void 0 ? _g : '').trim();
        const requestedRole = (_j = normalizeRole((_h = req.body) === null || _h === void 0 ? void 0 : _h.role)) !== null && _j !== void 0 ? _j : 'operario';
        const departmentId = String((_l = (_k = req.body) === null || _k === void 0 ? void 0 : _k.departmentId) !== null && _l !== void 0 ? _l : '').trim();
        if (!orgId)
            throw httpsError('invalid-argument', 'organizationId requerido.');
        if (!email)
            throw httpsError('invalid-argument', 'email requerido.');
        await requireCallerSuperAdminInOrg(actorUid, orgId);
        const orgRef = db.collection('organizations').doc(orgId);
        const orgSnap = await orgRef.get();
        const orgName = String((_o = (_m = orgSnap.data()) === null || _m === void 0 ? void 0 : _m.name) !== null && _o !== void 0 ? _o : orgId);
        let targetUid = '';
        try {
            const authUser = await admin.auth().getUserByEmail(email);
            targetUid = authUser.uid;
        }
        catch (_q) {
            targetUid = '';
        }
        if (targetUid) {
            const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
            const membershipSnap = await membershipRef.get();
            if (membershipSnap.exists) {
                const status = String((_p = membershipSnap.get('status')) !== null && _p !== void 0 ? _p : '') ||
                    (membershipSnap.get('active') === true ? 'active' : 'pending');
                if (status === 'active') {
                    throw httpsError('failed-precondition', 'El usuario ya pertenece a la organización.');
                }
            }
        }
        const inviteId = targetUid || `invite_${email}`;
        const joinReqRef = orgRef.collection('joinRequests').doc(inviteId);
        const now = admin.firestore.FieldValue.serverTimestamp();
        await joinReqRef.set({
            userId: targetUid || null,
            organizationId: orgId,
            organizationName: orgName,
            email,
            displayName: displayName || email,
            requestedRole,
            status: 'pending',
            departmentId: departmentId || null,
            invitedBy: actorUid,
            invitedByEmail: actorEmail,
            invitedAt: now,
            createdAt: now,
            updatedAt: now,
            source: 'orgInviteUser_v1',
        }, { merge: true });
        try {
            await (0, invite_email_1.sendInviteEmail)({
                recipientEmail: email,
                orgName,
                role: requestedRole,
                inviteLink: 'https://multi.maintelligence.app/login',
            });
        }
        catch (error) {
            console.warn('Error enviando email de invitación.', error);
        }
        await auditLog({
            action: 'orgInviteUser',
            actorUid,
            actorEmail,
            orgId,
            targetUid: targetUid || null,
            targetEmail: email,
            after: { status: 'pending', role: requestedRole },
        });
        res.status(200).json({ ok: true, organizationId: orgId, uid: targetUid || null, requestId: inviteId });
    }
    catch (err) {
        sendHttpError(res, err);
    }
});
exports.orgUpdateUserProfile = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    if (applyCors(req, res))
        return;
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }
    try {
        const decoded = await requireAuthFromRequest(req);
        const actorUid = decoded.uid;
        const actorEmail = ((_a = decoded.email) !== null && _a !== void 0 ? _a : null);
        const isRoot = Boolean((decoded === null || decoded === void 0 ? void 0 : decoded.root) === true || (decoded === null || decoded === void 0 ? void 0 : decoded.role) === 'root');
        const orgId = sanitizeOrganizationId(String((_c = (_b = req.body) === null || _b === void 0 ? void 0 : _b.organizationId) !== null && _c !== void 0 ? _c : ''));
        const targetUid = String((_e = (_d = req.body) === null || _d === void 0 ? void 0 : _d.uid) !== null && _e !== void 0 ? _e : '').trim();
        const displayName = String((_g = (_f = req.body) === null || _f === void 0 ? void 0 : _f.displayName) !== null && _g !== void 0 ? _g : '').trim();
        const email = String((_j = (_h = req.body) === null || _h === void 0 ? void 0 : _h.email) !== null && _j !== void 0 ? _j : '').trim().toLowerCase();
        const departmentId = String((_l = (_k = req.body) === null || _k === void 0 ? void 0 : _k.departmentId) !== null && _l !== void 0 ? _l : '').trim();
        const locationId = String((_o = (_m = req.body) === null || _m === void 0 ? void 0 : _m.locationId) !== null && _o !== void 0 ? _o : '').trim();
        await updateOrganizationUserProfile({
            actorUid,
            actorEmail,
            isRoot,
            orgId,
            targetUid,
            displayName,
            email,
            departmentId,
            locationId,
        });
        res.status(200).json({ ok: true, organizationId: orgId, uid: targetUid });
    }
    catch (err) {
        sendHttpError(res, err);
    }
});
exports.orgUpdateUserProfileCallable = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const isRoot = isRootClaim(context);
    const orgId = sanitizeOrganizationId(String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : ''));
    const targetUid = String((_e = data === null || data === void 0 ? void 0 : data.uid) !== null && _e !== void 0 ? _e : '').trim();
    const displayName = String((_f = data === null || data === void 0 ? void 0 : data.displayName) !== null && _f !== void 0 ? _f : '').trim();
    const email = String((_g = data === null || data === void 0 ? void 0 : data.email) !== null && _g !== void 0 ? _g : '').trim().toLowerCase();
    const departmentId = String((_h = data === null || data === void 0 ? void 0 : data.departmentId) !== null && _h !== void 0 ? _h : '').trim();
    const locationId = String((_j = data === null || data === void 0 ? void 0 : data.locationId) !== null && _j !== void 0 ? _j : '').trim();
    await updateOrganizationUserProfile({
        actorUid,
        actorEmail,
        isRoot,
        orgId,
        targetUid,
        displayName,
        email,
        departmentId,
        locationId,
    });
    return { ok: true, organizationId: orgId, uid: targetUid };
});
exports.orgApproveJoinRequest = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = sanitizeOrganizationId(String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : ''));
    const requestId = String((_f = (_e = data === null || data === void 0 ? void 0 : data.uid) !== null && _e !== void 0 ? _e : data === null || data === void 0 ? void 0 : data.requestId) !== null && _f !== void 0 ? _f : '').trim();
    const role = (_g = normalizeRole(data === null || data === void 0 ? void 0 : data.role)) !== null && _g !== void 0 ? _g : 'operario';
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!requestId)
        throw httpsError('invalid-argument', 'uid requerido.');
    await requireCallerSuperAdminInOrg(actorUid, orgId);
    const orgRef = db.collection('organizations').doc(orgId);
    const joinReqRef = orgRef.collection('joinRequests').doc(requestId);
    const joinReqSnap = await joinReqRef.get();
    if (!joinReqSnap.exists)
        throw httpsError('not-found', 'No existe la solicitud.');
    const jr = joinReqSnap.data();
    if (String((_h = jr === null || jr === void 0 ? void 0 : jr.status) !== null && _h !== void 0 ? _h : '') !== 'pending') {
        throw httpsError('failed-precondition', 'La solicitud no está pendiente.');
    }
    let targetUid = String((_j = jr === null || jr === void 0 ? void 0 : jr.userId) !== null && _j !== void 0 ? _j : '').trim();
    if (!targetUid && (jr === null || jr === void 0 ? void 0 : jr.email)) {
        try {
            targetUid = await resolveTargetUidByEmailOrUid(jr.email);
        }
        catch (err) {
            throw httpsError('failed-precondition', 'El usuario invitado aún no está registrado.');
        }
    }
    if (!targetUid)
        throw httpsError('failed-precondition', 'No se pudo resolver el usuario objetivo.');
    const orgSnap = await orgRef.get();
    const orgName = String((_l = (_k = orgSnap.data()) === null || _k === void 0 ? void 0 : _k.name) !== null && _l !== void 0 ? _l : orgId);
    const userRef = db.collection('users').doc(targetUid);
    const memberRef = orgRef.collection('members').doc(targetUid);
    void memberRef;
    const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(joinReqRef, {
        status: 'approved',
        approvedAt: now,
        approvedBy: actorUid,
        updatedAt: now,
        source: 'orgApproveJoinRequest_v1',
    }, { merge: true });
    batch.set(membershipRef, {
        userId: targetUid,
        organizationId: orgId,
        role,
        status: 'active',
        organizationName: orgName,
        updatedAt: now,
        source: 'orgApproveJoinRequest_v1',
    }, { merge: true });
    batch.set(memberRef, {
        uid: targetUid,
        orgId,
        email: String((_m = jr === null || jr === void 0 ? void 0 : jr.email) !== null && _m !== void 0 ? _m : null),
        displayName: String((_o = jr === null || jr === void 0 ? void 0 : jr.displayName) !== null && _o !== void 0 ? _o : null),
        role,
        active: true,
        updatedAt: now,
        createdAt: (_p = jr === null || jr === void 0 ? void 0 : jr.createdAt) !== null && _p !== void 0 ? _p : now,
        source: 'orgApproveJoinRequest_v1',
    }, { merge: true });
    batch.set(userRef, Object.assign({ organizationId: orgId, role, active: true, updatedAt: now, source: 'orgApproveJoinRequest_v1' }, ((jr === null || jr === void 0 ? void 0 : jr.departmentId) !== undefined ? { departmentId: jr.departmentId || null } : {})), { merge: true });
    await batch.commit();
    await auditLog({
        action: 'orgApproveJoinRequest',
        actorUid,
        actorEmail,
        orgId,
        targetUid,
        targetEmail: String((_q = jr === null || jr === void 0 ? void 0 : jr.email) !== null && _q !== void 0 ? _q : null),
        before: { status: 'pending', role: String((_r = jr === null || jr === void 0 ? void 0 : jr.requestedRole) !== null && _r !== void 0 ? _r : null) },
        after: { status: 'active', role },
    });
    return { ok: true, organizationId: orgId, uid: targetUid, role };
});
exports.orgRejectJoinRequest = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = sanitizeOrganizationId(String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : ''));
    const requestId = String((_f = (_e = data === null || data === void 0 ? void 0 : data.uid) !== null && _e !== void 0 ? _e : data === null || data === void 0 ? void 0 : data.requestId) !== null && _f !== void 0 ? _f : '').trim();
    const reason = String((_g = data === null || data === void 0 ? void 0 : data.reason) !== null && _g !== void 0 ? _g : '').trim().slice(0, 2000);
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!requestId)
        throw httpsError('invalid-argument', 'uid requerido.');
    await requireCallerSuperAdminInOrg(actorUid, orgId);
    const orgRef = db.collection('organizations').doc(orgId);
    const joinReqRef = orgRef.collection('joinRequests').doc(requestId);
    const joinReqSnap = await joinReqRef.get();
    if (!joinReqSnap.exists)
        throw httpsError('not-found', 'No existe la solicitud.');
    const jr = joinReqSnap.data();
    let targetUid = String((_h = jr === null || jr === void 0 ? void 0 : jr.userId) !== null && _h !== void 0 ? _h : '').trim();
    if (!targetUid && (jr === null || jr === void 0 ? void 0 : jr.email)) {
        try {
            targetUid = await resolveTargetUidByEmailOrUid(jr.email);
        }
        catch (_o) {
            targetUid = '';
        }
    }
    const membershipRef = targetUid ? db.collection('memberships').doc(`${targetUid}_${orgId}`) : null;
    const userRef = targetUid ? db.collection('users').doc(targetUid) : null;
    const userSnap = userRef ? await userRef.get() : null;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(joinReqRef, {
        status: 'rejected',
        rejectedAt: now,
        rejectedBy: actorUid,
        rejectReason: reason || null,
        updatedAt: now,
        source: 'orgRejectJoinRequest_v1',
    }, { merge: true });
    if (membershipRef) {
        batch.set(membershipRef, {
            status: 'revoked',
            updatedAt: now,
            source: 'orgRejectJoinRequest_v1',
        }, { merge: true });
    }
    if (userRef && (userSnap === null || userSnap === void 0 ? void 0 : userSnap.exists)) {
        const userOrgId = String((_k = (_j = userSnap.data()) === null || _j === void 0 ? void 0 : _j.organizationId) !== null && _k !== void 0 ? _k : '');
        if (userOrgId === orgId) {
            batch.set(userRef, {
                organizationId: null,
                role: 'pending',
                active: false,
                updatedAt: now,
                source: 'orgRejectJoinRequest_v1',
            }, { merge: true });
        }
    }
    await batch.commit();
    await auditLog({
        action: 'orgRejectJoinRequest',
        actorUid,
        actorEmail,
        orgId,
        targetUid: targetUid || null,
        targetEmail: String((_l = jr === null || jr === void 0 ? void 0 : jr.email) !== null && _l !== void 0 ? _l : null),
        before: { status: String((_m = jr === null || jr === void 0 ? void 0 : jr.status) !== null && _m !== void 0 ? _m : 'pending') },
        after: { status: 'rejected', reason: reason || null },
    });
    return { ok: true, organizationId: orgId, uid: targetUid || null };
});
exports.setRoleWithinOrg = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const isRoot = isRootClaim(context);
    const targetUid = await resolveTargetUidByEmailOrUid(data === null || data === void 0 ? void 0 : data.email, data === null || data === void 0 ? void 0 : data.uid);
    const role = normalizeRole(data === null || data === void 0 ? void 0 : data.role);
    return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role });
});
exports.promoteToSuperAdminWithinOrg = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const isRoot = isRootClaim(context);
    const targetUid = await resolveTargetUidByEmailOrUid(data === null || data === void 0 ? void 0 : data.email, data === null || data === void 0 ? void 0 : data.uid);
    return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role: 'super_admin' });
});
exports.demoteToAdminWithinOrg = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const isRoot = isRootClaim(context);
    const targetUid = await resolveTargetUidByEmailOrUid(data === null || data === void 0 ? void 0 : data.email, data === null || data === void 0 ? void 0 : data.uid);
    return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role: 'admin' });
});
exports.registerGooglePlayPurchase = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : '').trim();
    const purchaseToken = String((_e = data === null || data === void 0 ? void 0 : data.purchaseToken) !== null && _e !== void 0 ? _e : '').trim();
    const subscriptionId = String((_f = data === null || data === void 0 ? void 0 : data.subscriptionId) !== null && _f !== void 0 ? _f : '').trim();
    const planIdRaw = String((_g = data === null || data === void 0 ? void 0 : data.planId) !== null && _g !== void 0 ? _g : '').trim();
    const packageNameRaw = String((_h = data === null || data === void 0 ? void 0 : data.packageName) !== null && _h !== void 0 ? _h : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!purchaseToken)
        throw httpsError('invalid-argument', 'purchaseToken requerido.');
    if (!subscriptionId)
        throw httpsError('invalid-argument', 'subscriptionId requerido.');
    await requireCallerSuperAdminInOrg(actorUid, orgId);
    const googleCfg = resolveGooglePlayConfig();
    const configPackageName = (_j = googleCfg === null || googleCfg === void 0 ? void 0 : googleCfg.packageName) !== null && _j !== void 0 ? _j : '';
    const packageName = packageNameRaw || configPackageName;
    if (!packageName)
        throw httpsError('invalid-argument', 'packageName requerido.');
    const resolvedPlanId = resolveEntitlementPlanId({
        metadataPlanId: planIdRaw || null,
    });
    const purchaseRef = db.collection('googlePlayPurchases').doc(purchaseToken);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(purchaseRef);
        const payload = {
            organizationId: orgId,
            subscriptionId,
            packageName,
            planId: resolvedPlanId,
            updatedAt: now,
            linkedBy: actorUid,
            source: 'registerGooglePlayPurchase_v1',
        };
        if (!snap.exists) {
            payload.createdAt = now;
        }
        tx.set(purchaseRef, payload, { merge: true });
    });
    await auditLog({
        action: 'registerGooglePlayPurchase',
        actorUid,
        actorEmail,
        orgId,
        meta: { purchaseToken, subscriptionId, packageName, planId: resolvedPlanId },
    });
    return { ok: true, organizationId: orgId, purchaseToken };
});
exports.registerAppleAppAccountToken = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : '').trim();
    const appAccountToken = String((_e = data === null || data === void 0 ? void 0 : data.appAccountToken) !== null && _e !== void 0 ? _e : '').trim();
    const uid = String((_f = data === null || data === void 0 ? void 0 : data.uid) !== null && _f !== void 0 ? _f : actorUid).trim();
    const planIdRaw = String((_g = data === null || data === void 0 ? void 0 : data.planId) !== null && _g !== void 0 ? _g : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!appAccountToken)
        throw httpsError('invalid-argument', 'appAccountToken requerido.');
    await requireCallerSuperAdminInOrg(actorUid, orgId);
    const resolvedPlanId = resolveEntitlementPlanId({
        metadataPlanId: planIdRaw || null,
    });
    const tokenRef = db.collection('appleAppAccountTokens').doc(appAccountToken);
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(tokenRef);
        const payload = {
            organizationId: orgId,
            uid,
            planId: resolvedPlanId,
            updatedAt: now,
            linkedBy: actorUid,
            source: 'registerAppleAppAccountToken_v1',
        };
        if (!snap.exists) {
            payload.createdAt = now;
        }
        tx.set(tokenRef, payload, { merge: true });
    });
    await auditLog({
        action: 'registerAppleAppAccountToken',
        actorUid,
        actorEmail,
        orgId,
        meta: { appAccountToken, uid, planId: resolvedPlanId },
    });
    return { ok: true, organizationId: orgId, appAccountToken };
});
exports.appleAppStoreNotifications = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const rawBody = (_b = (_a = req.rawBody) === null || _a === void 0 ? void 0 : _a.toString('utf8')) !== null && _b !== void 0 ? _b : '';
    if (!rawBody) {
        res.status(400).send('Missing payload.');
        return;
    }
    let signedPayload = null;
    try {
        const parsed = JSON.parse(rawBody);
        signedPayload = (_c = parsed.signedPayload) !== null && _c !== void 0 ? _c : null;
    }
    catch (error) {
        console.error('appleAppStoreNotifications: invalid JSON', error);
        res.status(400).send('Invalid JSON.');
        return;
    }
    if (!signedPayload) {
        res.status(400).send('Missing signedPayload.');
        return;
    }
    const notificationPayload = decodeJwtPayload(signedPayload);
    const transactionPayload = decodeJwtPayload((_e = (_d = notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.data) === null || _d === void 0 ? void 0 : _d.signedTransactionInfo) !== null && _e !== void 0 ? _e : null);
    const renewalPayload = decodeJwtPayload((_g = (_f = notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.data) === null || _f === void 0 ? void 0 : _f.signedRenewalInfo) !== null && _g !== void 0 ? _g : null);
    const appAccountToken = (_l = (_j = (_h = transactionPayload === null || transactionPayload === void 0 ? void 0 : transactionPayload.appAccountToken) !== null && _h !== void 0 ? _h : renewalPayload === null || renewalPayload === void 0 ? void 0 : renewalPayload.appAccountToken) !== null && _j !== void 0 ? _j : (_k = notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.data) === null || _k === void 0 ? void 0 : _k.appAccountToken) !== null && _l !== void 0 ? _l : '';
    const { bundleId } = resolveAppleAppStoreConfig();
    if (bundleId && ((_m = notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.data) === null || _m === void 0 ? void 0 : _m.bundleId) && notificationPayload.data.bundleId !== bundleId) {
        res.status(400).send('Bundle mismatch.');
        return;
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('appleAppStoreNotifications').add({
        signedPayload,
        notificationType: (_o = notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.notificationType) !== null && _o !== void 0 ? _o : null,
        subtype: (_p = notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.subtype) !== null && _p !== void 0 ? _p : null,
        appAccountToken: appAccountToken || null,
        bundleId: (_r = (_q = notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.data) === null || _q === void 0 ? void 0 : _q.bundleId) !== null && _r !== void 0 ? _r : null,
        receivedAt: now,
        source: 'appleAppStoreNotifications_v1',
    });
    if (APPLE_UPDATES_ENABLED && appAccountToken) {
        const tokenSnap = await db.collection('appleAppAccountTokens').doc(appAccountToken).get();
        if (tokenSnap.exists) {
            const tokenData = tokenSnap.data();
            const orgId = String((_s = tokenData === null || tokenData === void 0 ? void 0 : tokenData.organizationId) !== null && _s !== void 0 ? _s : '').trim();
            if (orgId) {
                const status = resolveEntitlementStatusFromApple(notificationPayload === null || notificationPayload === void 0 ? void 0 : notificationPayload.notificationType, renewalPayload);
                const currentPeriodEnd = toTimestampFromMillis((_t = transactionPayload === null || transactionPayload === void 0 ? void 0 : transactionPayload.expiresDate) !== null && _t !== void 0 ? _t : null);
                await updateOrganizationAppleEntitlement({
                    orgId,
                    planId: tokenData === null || tokenData === void 0 ? void 0 : tokenData.planId,
                    status,
                    currentPeriodEnd,
                });
            }
        }
    }
    res.status(200).send({ received: true });
});
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    let event;
    let webhookSecret;
    let secretKey;
    try {
        const config = resolveStripeConfig();
        if (!config) {
            res.status(501).send('Stripe not configured.');
            return;
        }
        webhookSecret = config.webhookSecret;
        secretKey = config.secretKey;
        const signature = req.headers['stripe-signature'];
        if (!signature || typeof signature !== 'string') {
            res.status(400).send('Missing Stripe signature.');
            return;
        }
        const payload = (_b = (_a = req.rawBody) === null || _a === void 0 ? void 0 : _a.toString('utf8')) !== null && _b !== void 0 ? _b : '';
        const valid = verifyStripeSignature({
            payload,
            signatureHeader: signature,
            webhookSecret,
        });
        if (!valid) {
            res.status(400).send('Invalid signature.');
            return;
        }
        event = JSON.parse(payload);
    }
    catch (error) {
        console.error('stripeWebhook: signature verification failed', error);
        res.status(400).send('Invalid signature.');
        return;
    }
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const orgId = String((_d = (_c = session.metadata) === null || _c === void 0 ? void 0 : _c.orgId) !== null && _d !== void 0 ? _d : '').trim();
                if (!orgId) {
                    res.status(400).send('orgId missing in checkout session metadata.');
                    return;
                }
                const subscriptionId = typeof session.subscription === 'string' ? session.subscription : (_e = session.subscription) === null || _e === void 0 ? void 0 : _e.id;
                if (!subscriptionId) {
                    res.status(400).send('Subscription missing in checkout session.');
                    return;
                }
                const subscription = await fetchStripeSubscription(subscriptionId, secretKey);
                const status = resolveEntitlementStatusFromStripe((_f = subscription.status) !== null && _f !== void 0 ? _f : '');
                const planId = resolveEntitlementPlanId({
                    metadataPlanId: (_k = (_h = (_g = session.metadata) === null || _g === void 0 ? void 0 : _g.planId) !== null && _h !== void 0 ? _h : (_j = subscription.metadata) === null || _j === void 0 ? void 0 : _j.planId) !== null && _k !== void 0 ? _k : null,
                });
                const trialEndsAt = subscription.trial_end != null
                    ? admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000)
                    : null;
                const currentPeriodEnd = subscription.current_period_end != null
                    ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000)
                    : null;
                await updateOrganizationStripeEntitlement({
                    orgId,
                    planId,
                    status,
                    trialEndsAt,
                    currentPeriodEnd,
                });
                break;
            }
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const orgId = String((_m = (_l = subscription.metadata) === null || _l === void 0 ? void 0 : _l.orgId) !== null && _m !== void 0 ? _m : '').trim();
                if (!orgId) {
                    res.status(400).send('orgId missing in subscription metadata.');
                    return;
                }
                const status = event.type === 'customer.subscription.deleted'
                    ? 'canceled'
                    : resolveEntitlementStatusFromStripe(subscription.status);
                const planId = resolveEntitlementPlanId({
                    metadataPlanId: (_p = (_o = subscription.metadata) === null || _o === void 0 ? void 0 : _o.planId) !== null && _p !== void 0 ? _p : null,
                });
                const trialEndsAt = subscription.trial_end != null
                    ? admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000)
                    : null;
                const currentPeriodEnd = subscription.current_period_end != null
                    ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000)
                    : null;
                await updateOrganizationStripeEntitlement({
                    orgId,
                    planId,
                    status,
                    trialEndsAt,
                    currentPeriodEnd,
                });
                break;
            }
            default:
                break;
        }
        res.status(200).send({ received: true });
    }
    catch (error) {
        console.error('stripeWebhook: handler error', error);
        res.status(500).send('Webhook handler error.');
    }
});
//# sourceMappingURL=index.js.map