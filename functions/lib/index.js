"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoteToAdminWithinOrg = exports.promoteToSuperAdminWithinOrg = exports.setRoleWithinOrg = exports.orgRejectJoinRequest = exports.orgApproveJoinRequest = exports.orgRemoveUserFromOrg = exports.orgUpdateUserProfileCallable = exports.orgUpdateUserProfile = exports.orgInviteUser = exports.setActiveOrganization = exports.finalizeOrganizationSignup = exports.bootstrapSignup = exports.checkOrganizationAvailability = exports.resolveOrganizationId = exports.rootPurgeOrganizationCollection = exports.rootDeleteOrganizationScaffold = exports.rootDeactivateOrganization = exports.rootUpsertUserToOrganization = exports.rootListUsersByOrg = exports.rootOrgSummary = exports.rootListOrganizations = exports.onTaskDeleted = exports.onTicketDeleted = exports.onTicketClosed = exports.onTaskCreate = exports.onTicketCreate = exports.onTaskAssign = exports.onTicketAssign = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const assignment_email_1 = require("./assignment-email");
const invite_email_1 = require("./invite-email");
admin.initializeApp();
const db = admin.firestore();
function httpsError(code, message) {
    return new functions.https.HttpsError(code, message);
}
const ALLOWED_CORS_ORIGINS = new Set([
    'https://multi.maintelligence.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
]);
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
async function updateOrganizationUserProfile({ actorUid, actorEmail, isRoot, orgId, targetUid, displayName, email, departmentId, }) {
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
    const userPayload = {
        displayName: displayName || null,
        email: normalizedEmail || null,
        departmentId: departmentId || null,
        updatedAt: now,
        source: 'orgUpdateUserProfile_v1',
    };
    const memberPayload = {
        displayName: displayName || null,
        email: normalizedEmail || null,
        departmentId: departmentId || null,
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
        },
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
function isRootClaim(context) {
    var _a, _b;
    return Boolean(((_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.root) === true);
}
function normalizeRoleOrNull(input) {
    const r = String(input !== null && input !== void 0 ? input : '').trim().toLowerCase();
    if (!r)
        return null;
    if (r === 'super_admin' || r === 'superadmin')
        return 'super_admin';
    if (r === 'admin' || r === 'administrator')
        return 'admin';
    if (r === 'maintenance' || r === 'mantenimiento' || r === 'maint' || r === 'maintainer')
        return 'maintenance';
    if (r === 'dept_head_multi' ||
        r === 'deptheadmulti' ||
        r === 'dept-head-multi' ||
        r === 'dept head multi' ||
        r === 'department_head_multi' ||
        r === 'departmentheadmulti' ||
        r === 'jefe_departamento_multi' ||
        r === 'jefe de departamento multi') {
        return 'dept_head_multi';
    }
    if (r === 'dept_head_single' ||
        r === 'deptheadsingle' ||
        r === 'dept-head-single' ||
        r === 'dept head single' ||
        r === 'dept_head' ||
        r === 'depthead' ||
        r === 'department_head_single' ||
        r === 'departmentheadsingle' ||
        r === 'jefe_departamento' ||
        r === 'jefe de departamento') {
        return 'dept_head_single';
    }
    if (r === 'operator' || r === 'operario' || r === 'op')
        return 'operator';
    return null;
}
function normalizeRole(input) {
    var _a;
    return (_a = normalizeRoleOrNull(input)) !== null && _a !== void 0 ? _a : 'operator';
}
async function ensureDefaultOrganizationExists() {
    const ref = db.collection('organizations').doc('default');
    const snap = await ref.get();
    if (!snap.exists) {
        await ref.set({
            organizationId: 'default',
            name: 'default',
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'ensure_default_org_v1',
        }, { merge: true });
    }
    else {
        const d = snap.data();
        // si no existe el campo, lo normalizamos para que nunca se "pierda" en queries futuras
        if ((d === null || d === void 0 ? void 0 : d.isActive) === undefined) {
            await ref.set({ isActive: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
    await db.collection('auditLogs').add(Object.assign(Object.assign({}, params), { createdAt: admin.firestore.FieldValue.serverTimestamp() }));
}
/* ------------------------------
   FIRESTORE TRIGGERS (GEN1)
--------------------------------- */
exports.onTicketAssign = functions.firestore
    .document('tickets/{ticketId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after)
        return;
    if (!before.assignedTo || !after.assignedTo || before.assignedTo === after.assignedTo)
        return;
    if (after.assignmentEmailSource === 'client')
        return;
    try {
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: (_a = after.organizationId) !== null && _a !== void 0 ? _a : null,
            assignedTo: (_b = after.assignedTo) !== null && _b !== void 0 ? _b : null,
            departmentId: (_c = after.departmentId) !== null && _c !== void 0 ? _c : null,
            title: (_d = after.title) !== null && _d !== void 0 ? _d : '(sin título)',
            link: `https://multi.maintelligence.app/incidents/${context.params.ticketId}`,
            type: 'incidencia',
            identifier: (_e = after.displayId) !== null && _e !== void 0 ? _e : context.params.ticketId,
            description: (_f = after.description) !== null && _f !== void 0 ? _f : '',
            priority: (_g = after.priority) !== null && _g !== void 0 ? _g : '',
            status: (_h = after.status) !== null && _h !== void 0 ? _h : '',
            location: (_j = after.departmentId) !== null && _j !== void 0 ? _j : null,
        });
    }
    catch (error) {
        console.error('[onTicketAssign] Error enviando email de asignación', error);
    }
});
exports.onTaskAssign = functions.firestore
    .document('tasks/{taskId}')
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
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: (_a = after.organizationId) !== null && _a !== void 0 ? _a : null,
            assignedTo: (_b = after.assignedTo) !== null && _b !== void 0 ? _b : null,
            departmentId: (_c = after.location) !== null && _c !== void 0 ? _c : null,
            title: (_d = after.title) !== null && _d !== void 0 ? _d : '(sin título)',
            link: `https://multi.maintelligence.app/tasks/${context.params.taskId}`,
            type: 'tarea',
            identifier: context.params.taskId,
            description: (_e = after.description) !== null && _e !== void 0 ? _e : '',
            priority: (_f = after.priority) !== null && _f !== void 0 ? _f : '',
            status: (_g = after.status) !== null && _g !== void 0 ? _g : '',
            dueDate: (_h = after.dueDate) !== null && _h !== void 0 ? _h : null,
            location: (_j = after.location) !== null && _j !== void 0 ? _j : null,
            category: (_k = after.category) !== null && _k !== void 0 ? _k : null,
        });
    }
    catch (error) {
        console.error('[onTaskAssign] Error enviando email de asignación', error);
    }
});
exports.onTicketCreate = functions.firestore
    .document('tickets/{ticketId}')
    .onCreate(async (snap, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const data = snap.data();
    if (!(data === null || data === void 0 ? void 0 : data.assignedTo))
        return;
    if (data.assignmentEmailSource === 'client')
        return;
    try {
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: (_a = data.organizationId) !== null && _a !== void 0 ? _a : null,
            assignedTo: (_b = data.assignedTo) !== null && _b !== void 0 ? _b : null,
            departmentId: (_c = data.departmentId) !== null && _c !== void 0 ? _c : null,
            title: (_d = data.title) !== null && _d !== void 0 ? _d : '(sin título)',
            link: `https://multi.maintelligence.app/incidents/${context.params.ticketId}`,
            type: 'incidencia',
            identifier: (_e = data.displayId) !== null && _e !== void 0 ? _e : context.params.ticketId,
            description: (_f = data.description) !== null && _f !== void 0 ? _f : '',
            priority: (_g = data.priority) !== null && _g !== void 0 ? _g : '',
            status: (_h = data.status) !== null && _h !== void 0 ? _h : '',
            location: (_j = data.departmentId) !== null && _j !== void 0 ? _j : null,
        });
    }
    catch (error) {
        console.error('[onTicketCreate] Error enviando email de asignación', error);
    }
});
exports.onTaskCreate = functions.firestore
    .document('tasks/{taskId}')
    .onCreate(async (snap, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const data = snap.data();
    if (!(data === null || data === void 0 ? void 0 : data.assignedTo))
        return;
    if (data.assignmentEmailSource === 'client')
        return;
    try {
        await (0, assignment_email_1.sendAssignmentEmail)({
            organizationId: (_a = data.organizationId) !== null && _a !== void 0 ? _a : null,
            assignedTo: (_b = data.assignedTo) !== null && _b !== void 0 ? _b : null,
            departmentId: (_c = data.location) !== null && _c !== void 0 ? _c : null,
            title: (_d = data.title) !== null && _d !== void 0 ? _d : '(sin título)',
            link: `https://multi.maintelligence.app/tasks/${context.params.taskId}`,
            type: 'tarea',
            identifier: context.params.taskId,
            description: (_e = data.description) !== null && _e !== void 0 ? _e : '',
            priority: (_f = data.priority) !== null && _f !== void 0 ? _f : '',
            status: (_g = data.status) !== null && _g !== void 0 ? _g : '',
            dueDate: (_h = data.dueDate) !== null && _h !== void 0 ? _h : null,
            location: (_j = data.location) !== null && _j !== void 0 ? _j : null,
            category: (_k = data.category) !== null && _k !== void 0 ? _k : null,
        });
    }
    catch (error) {
        console.error('[onTaskCreate] Error enviando email de asignación', error);
    }
});
exports.onTicketClosed = functions.firestore
    .document('tickets/{ticketId}')
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
    .document('tickets/{ticketId}')
    .onDelete(async (_snap, context) => {
    console.log('[onTicketDeleted]', context.params.ticketId);
});
exports.onTaskDeleted = functions.firestore
    .document('tasks/{taskId}')
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
    const usersQ = db.collection('users').where('organizationId', '==', orgId);
    const ticketsQ = db.collection('tickets').where('organizationId', '==', orgId);
    const tasksQ = db.collection('tasks').where('organizationId', '==', orgId);
    const sitesQ = db.collection('sites').where('organizationId', '==', orgId);
    const assetsQ = db.collection('assets').where('organizationId', '==', orgId);
    const depsQ = db.collection('departments').where('organizationId', '==', orgId);
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
    await db.collection('organizations').doc(orgId).set({
        organizationId: orgId,
        name: orgId,
        isActive: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'root_upsert_user_v1',
    }, { merge: true });
    const userRef = db.collection('users').doc(uid);
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(uid);
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: beforeSnap.exists
            ? (_f = beforeSnap.get('createdAt')) !== null && _f !== void 0 ? _f : admin.firestore.FieldValue.serverTimestamp()
            : admin.firestore.FieldValue.serverTimestamp(),
        source: 'root_upsert_user_v1',
    }, { merge: true });
    batch.set(memberRef, {
        uid,
        orgId,
        email: (_g = authUser.email) !== null && _g !== void 0 ? _g : email,
        displayName: (_h = authUser.displayName) !== null && _h !== void 0 ? _h : null,
        active: true,
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'root_upsert_user_v1',
    }, { merge: true });
    batch.set(membershipRef, {
        userId: uid,
        organizationId: orgId,
        role,
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
    await db.collection('organizations').doc(orgId).set({
        isActive,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'rootDeactivateOrganization_v1',
    }, { merge: true });
    await auditLog({
        action: 'rootDeactivateOrganization',
        actorUid,
        actorEmail: (_e = (_d = (_c = context.auth) === null || _c === void 0 ? void 0 : _c.token) === null || _d === void 0 ? void 0 : _d.email) !== null && _e !== void 0 ? _e : null,
        orgId,
        after: { isActive },
    });
    return { ok: true, organizationId: orgId, isActive };
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
    const allowed = new Set(['tickets', 'tasks', 'sites', 'assets', 'departments', 'memberships', 'users']);
    if (!allowed.has(collection))
        throw httpsError('invalid-argument', 'Colección no permitida para purge.');
    let totalDeleted = 0;
    while (true) {
        const q = db.collection(collection).where('organizationId', '==', orgId).limit(batchSize);
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
    const beforeRole = String((_a = membershipSnap.get('role')) !== null && _a !== void 0 ? _a : 'operator');
    const beforeStatus = String((_b = membershipSnap.get('status')) !== null && _b !== void 0 ? _b : '') ||
        (membershipSnap.get('active') === true ? 'active' : 'pending');
    if (beforeStatus !== 'active') {
        throw httpsError('failed-precondition', 'La membresía del usuario objetivo no está activa.');
    }
    if (beforeRole === role) {
        return { ok: true, uid: targetUid, organizationId: orgId, role, noChange: true };
    }
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
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
    var _a, _b, _c, _d;
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
    var _a, _b;
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
    const existingName = String((_b = orgSnap.data().name) !== null && _b !== void 0 ? _b : normalizedId);
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
exports.bootstrapSignup = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    const uid = requireAuth(context);
    const orgIdIn = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '');
    const organizationId = sanitizeOrganizationId(orgIdIn);
    if (!organizationId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    const requestedRoleRaw = data === null || data === void 0 ? void 0 : data.requestedRole;
    const requestedRole = requestedRoleRaw ? normalizeRoleOrNull(requestedRoleRaw) : 'operator';
    if (!requestedRole)
        throw httpsError('invalid-argument', 'requestedRole inválido.');
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    const email = ((_b = authUser === null || authUser === void 0 ? void 0 : authUser.email) !== null && _b !== void 0 ? _b : String((_c = data === null || data === void 0 ? void 0 : data.email) !== null && _c !== void 0 ? _c : '')).trim().toLowerCase();
    const displayName = ((_d = authUser === null || authUser === void 0 ? void 0 : authUser.displayName) !== null && _d !== void 0 ? _d : String((_e = data === null || data === void 0 ? void 0 : data.displayName) !== null && _e !== void 0 ? _e : '').trim()) || null;
    const signupMode = String((_f = data === null || data === void 0 ? void 0 : data.signupMode) !== null && _f !== void 0 ? _f : 'join');
    const orgRef = db.collection('organizations').doc(organizationId);
    const orgPublicRef = db.collection('organizationsPublic').doc(organizationId);
    const orgSnap = await orgRef.get();
    const userRef = db.collection('users').doc(uid);
    const memberRef = orgRef.collection('members').doc(uid);
    const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (!orgSnap.exists) {
        const details = ((_g = data === null || data === void 0 ? void 0 : data.organizationDetails) !== null && _g !== void 0 ? _g : {});
        const orgName = String((_h = details === null || details === void 0 ? void 0 : details.name) !== null && _h !== void 0 ? _h : '').trim() || organizationId;
        const orgLegalName = String((_j = details === null || details === void 0 ? void 0 : details.legalName) !== null && _j !== void 0 ? _j : '').trim() || null;
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
                    taxId: String((_k = details === null || details === void 0 ? void 0 : details.taxId) !== null && _k !== void 0 ? _k : '').trim() || null,
                    country: String((_l = details === null || details === void 0 ? void 0 : details.country) !== null && _l !== void 0 ? _l : '').trim() || null,
                    address: String((_m = details === null || details === void 0 ? void 0 : details.address) !== null && _m !== void 0 ? _m : '').trim() || null,
                    billingEmail: String((_o = details === null || details === void 0 ? void 0 : details.billingEmail) !== null && _o !== void 0 ? _o : '').trim() || email || null,
                    phone: String((_p = details === null || details === void 0 ? void 0 : details.phone) !== null && _p !== void 0 ? _p : '').trim() || null,
                    teamSize: Number.isFinite(Number(details === null || details === void 0 ? void 0 : details.teamSize)) ? Number(details === null || details === void 0 ? void 0 : details.teamSize) : null,
                },
                status: 'verification_pending',
                createdAt: now,
                updatedAt: now,
                source: 'bootstrapSignup_v1',
            }, { merge: true });
            return { ok: true, mode: 'verification_required', organizationId };
        }
        const batch = db.batch();
        batch.set(orgRef, {
            organizationId,
            name: orgName,
            legalName: orgLegalName,
            taxId: String((_k = details === null || details === void 0 ? void 0 : details.taxId) !== null && _k !== void 0 ? _k : '').trim() || null,
            country: String((_l = details === null || details === void 0 ? void 0 : details.country) !== null && _l !== void 0 ? _l : '').trim() || null,
            address: String((_m = details === null || details === void 0 ? void 0 : details.address) !== null && _m !== void 0 ? _m : '').trim() || null,
            billingEmail: String((_o = details === null || details === void 0 ? void 0 : details.billingEmail) !== null && _o !== void 0 ? _o : '').trim() || email || null,
            contactPhone: String((_p = details === null || details === void 0 ? void 0 : details.phone) !== null && _p !== void 0 ? _p : '').trim() || null,
            teamSize: Number.isFinite(Number(details === null || details === void 0 ? void 0 : details.teamSize)) ? Number(details === null || details === void 0 ? void 0 : details.teamSize) : null,
            subscriptionPlan: 'trial',
            isActive: true,
            settings: {
                allowGuestAccess: false,
                maxUsers: 50,
            },
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        }, { merge: true });
        batch.set(orgPublicRef, {
            organizationId,
            name: orgName,
            nameLower: orgName.toLowerCase(),
            isActive: true,
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        }, { merge: true });
        batch.set(userRef, {
            organizationId,
            email: email || null,
            displayName: displayName || email || 'Usuario',
            role: 'super_admin',
            active: true,
            updatedAt: now,
            createdAt: now,
            source: 'bootstrapSignup_v1',
        }, { merge: true });
        batch.set(membershipRef, {
            userId: uid,
            organizationId,
            organizationName: orgName,
            role: 'super_admin',
            status: 'active',
            primary: true,
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        }, { merge: true });
        batch.set(memberRef, {
            uid,
            orgId: organizationId,
            email: email || null,
            displayName: displayName || email || 'Usuario',
            role: 'super_admin',
            active: true,
            createdAt: now,
            updatedAt: now,
            source: 'bootstrapSignup_v1',
        }, { merge: true });
        await batch.commit();
        await auditLog({
            action: 'bootstrapSignup_create_org',
            actorUid: uid,
            actorEmail: email || null,
            orgId: organizationId,
            after: { organizationId, role: 'super_admin', status: 'active' },
        });
        return { ok: true, mode: 'created', organizationId };
    }
    const orgData = orgSnap.data();
    const orgName = String((_o = orgData === null || orgData === void 0 ? void 0 : orgData.name) !== null && _o !== void 0 ? _o : organizationId);
    const joinReqRef = orgRef.collection('joinRequests').doc(uid);
    const batch = db.batch();
    batch.set(userRef, {
        organizationId,
        email: email || null,
        displayName: displayName || email || 'Usuario',
        role: requestedRole,
        active: true,
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
    batch.set(joinReqRef, {
        userId: uid,
        organizationId,
        organizationName: orgName,
        email: email || null,
        displayName: displayName || email || 'Usuario',
        requestedRole,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
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
    const now = admin.firestore.FieldValue.serverTimestamp();
    const orgDetails = (_b = requestData === null || requestData === void 0 ? void 0 : requestData.organizationDetails) !== null && _b !== void 0 ? _b : {};
    const orgName = String((_d = (_c = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.name) !== null && _c !== void 0 ? _c : requestData === null || requestData === void 0 ? void 0 : requestData.organizationName) !== null && _d !== void 0 ? _d : organizationId).trim() || organizationId;
    const orgLegalName = String((_f = (_e = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.legalName) !== null && _e !== void 0 ? _e : requestData === null || requestData === void 0 ? void 0 : requestData.organizationLegalName) !== null && _f !== void 0 ? _f : '').trim() || null;
    const userRef = db.collection('users').doc(uid);
    const memberRef = orgRef.collection('members').doc(uid);
    const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);
    const batch = db.batch();
    batch.set(orgRef, {
        organizationId,
        name: orgName,
        legalName: orgLegalName,
        taxId: String((_g = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.taxId) !== null && _g !== void 0 ? _g : '').trim() || null,
        country: String((_a = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.country) !== null && _a !== void 0 ? _a : '').trim() || null,
        address: String((_b = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.address) !== null && _b !== void 0 ? _b : '').trim() || null,
        billingEmail: String((_c = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.billingEmail) !== null && _c !== void 0 ? _c : '').trim() || (authUser === null || authUser === void 0 ? void 0 : authUser.email) || null,
        contactPhone: String((_d = orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.phone) !== null && _d !== void 0 ? _d : '').trim() || null,
        teamSize: Number.isFinite(Number(orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.teamSize)) ? Number(orgDetails === null || orgDetails === void 0 ? void 0 : orgDetails.teamSize) : null,
        subscriptionPlan: 'trial',
        isActive: true,
        settings: {
            allowGuestAccess: false,
            maxUsers: 50,
        },
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
    batch.set(orgPublicRef, {
        organizationId,
        name: orgName,
        nameLower: orgName.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
    batch.set(userRef, {
        organizationId,
        email: (authUser === null || authUser === void 0 ? void 0 : authUser.email) || null,
        displayName: (authUser === null || authUser === void 0 ? void 0 : authUser.displayName) || (authUser === null || authUser === void 0 ? void 0 : authUser.email) || 'Usuario',
        role: 'super_admin',
        active: true,
        updatedAt: now,
        createdAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
    batch.set(membershipRef, {
        userId: uid,
        organizationId,
        organizationName: orgName,
        role: 'super_admin',
        status: 'active',
        primary: true,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
    batch.set(memberRef, {
        uid,
        orgId: organizationId,
        email: (authUser === null || authUser === void 0 ? void 0 : authUser.email) || null,
        displayName: (authUser === null || authUser === void 0 ? void 0 : authUser.displayName) || (authUser === null || authUser === void 0 ? void 0 : authUser.email) || 'Usuario',
        role: 'super_admin',
        active: true,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
    }, { merge: true });
    batch.delete(requestRef);
    await batch.commit();
    await auditLog({
        action: 'bootstrapSignup_create_org',
        actorUid: uid,
        actorEmail: (authUser === null || authUser === void 0 ? void 0 : authUser.email) || null,
        orgId: organizationId,
        after: { organizationId, role: 'super_admin', status: 'active' },
    });
    return { ok: true, mode: 'created', organizationId };
});
exports.setActiveOrganization = functions.https.onCall(async (data, context) => {
    var _a, _b;
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
    await db.collection('users').doc(uid).set({
        organizationId: orgId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'setActiveOrganization_v1',
    }, { merge: true });
    return { ok: true, organizationId: orgId };
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
        const requestedRole = (_j = normalizeRole((_h = req.body) === null || _h === void 0 ? void 0 : _h.role)) !== null && _j !== void 0 ? _j : 'operator';
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
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
        await updateOrganizationUserProfile({
            actorUid,
            actorEmail,
            isRoot,
            orgId,
            targetUid,
            displayName,
            email,
            departmentId,
        });
        res.status(200).json({ ok: true, organizationId: orgId, uid: targetUid });
    }
    catch (err) {
        sendHttpError(res, err);
    }
});
exports.orgUpdateUserProfileCallable = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const isRoot = isRootClaim(context);
    const orgId = sanitizeOrganizationId(String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : ''));
    const targetUid = String((_e = data === null || data === void 0 ? void 0 : data.uid) !== null && _e !== void 0 ? _e : '').trim();
    const displayName = String((_f = data === null || data === void 0 ? void 0 : data.displayName) !== null && _f !== void 0 ? _f : '').trim();
    const email = String((_g = data === null || data === void 0 ? void 0 : data.email) !== null && _g !== void 0 ? _g : '').trim().toLowerCase();
    const departmentId = String((_h = data === null || data === void 0 ? void 0 : data.departmentId) !== null && _h !== void 0 ? _h : '').trim();
    await updateOrganizationUserProfile({
        actorUid,
        actorEmail,
        isRoot,
        orgId,
        targetUid,
        displayName,
        email,
        departmentId,
    });
    return { ok: true, organizationId: orgId, uid: targetUid };
});
exports.orgRemoveUserFromOrg = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = sanitizeOrganizationId(String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : ''));
    const targetUid = String((_e = data === null || data === void 0 ? void 0 : data.uid) !== null && _e !== void 0 ? _e : '').trim();
    if (!orgId)
        throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!targetUid)
        throw httpsError('invalid-argument', 'uid requerido.');
    await requireCallerSuperAdminInOrg(actorUid, orgId);
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
    const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
    const userRef = db.collection('users').doc(targetUid);
    const [memberSnap, membershipSnap, userSnap] = await Promise.all([
        memberRef.get(),
        membershipRef.get(),
        userRef.get(),
    ]);
    if (!memberSnap.exists && !membershipSnap.exists) {
        throw httpsError('not-found', 'El usuario objetivo no pertenece a esa organización.');
    }
    const batch = db.batch();
    if (memberSnap.exists)
        batch.delete(memberRef);
    if (membershipSnap.exists)
        batch.delete(membershipRef);
    const userOrgId = String(((_f = userSnap.data()) === null || _f === void 0 ? void 0 : _f.organizationId) ?? '');
    if (userSnap.exists && userOrgId === orgId) {
        batch.set(userRef, {
            organizationId: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'orgRemoveUserFromOrg_v1',
        }, { merge: true });
    }
    await batch.commit();
    await auditLog({
        action: 'orgRemoveUserFromOrg',
        actorUid,
        actorEmail,
        orgId,
        targetUid,
        targetEmail: String(((_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.email) ?? null),
        after: { removed: true },
    });
    return { ok: true, organizationId: orgId, uid: targetUid };
});
exports.orgApproveJoinRequest = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    const actorUid = requireAuth(context);
    const actorEmail = ((_c = (_b = (_a = context.auth) === null || _a === void 0 ? void 0 : _a.token) === null || _b === void 0 ? void 0 : _b.email) !== null && _c !== void 0 ? _c : null);
    const orgId = sanitizeOrganizationId(String((_d = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _d !== void 0 ? _d : ''));
    const requestId = String((_f = (_e = data === null || data === void 0 ? void 0 : data.uid) !== null && _e !== void 0 ? _e : data === null || data === void 0 ? void 0 : data.requestId) !== null && _f !== void 0 ? _f : '').trim();
    const role = (_g = normalizeRole(data === null || data === void 0 ? void 0 : data.role)) !== null && _g !== void 0 ? _g : 'operator';
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
    batch.set(userRef, Object.assign({ organizationId: orgId, role, updatedAt: now, source: 'orgApproveJoinRequest_v1' }, ((jr === null || jr === void 0 ? void 0 : jr.departmentId) !== undefined ? { departmentId: jr.departmentId || null } : {})), { merge: true });
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
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
        catch (_l) {
            targetUid = '';
        }
    }
    const membershipRef = targetUid ? db.collection('memberships').doc(`${targetUid}_${orgId}`) : null;
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
    await batch.commit();
    await auditLog({
        action: 'orgRejectJoinRequest',
        actorUid,
        actorEmail,
        orgId,
        targetUid: targetUid || null,
        targetEmail: String((_j = jr === null || jr === void 0 ? void 0 : jr.email) !== null && _j !== void 0 ? _j : null),
        before: { status: String((_k = jr === null || jr === void 0 ? void 0 : jr.status) !== null && _k !== void 0 ? _k : 'pending') },
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
//# sourceMappingURL=index.js.map
