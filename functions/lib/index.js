"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demoteToAdminWithinOrg = exports.promoteToSuperAdminWithinOrg = exports.setRoleWithinOrg = exports.rootPurgeOrganizationCollection = exports.rootDeleteOrganizationScaffold = exports.rootDeactivateOrganization = exports.rootUpsertUserToOrganization = exports.rootListUsersByOrg = exports.rootOrgSummary = exports.rootListOrganizations = exports.onTaskDeleted = exports.onTicketDeleted = exports.onTicketClosed = exports.onTaskAssign = exports.onTicketAssign = void 0;
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
function httpsError(code, message) {
    return new functions.https.HttpsError(code, message);
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
async function getUserDoc(uid) {
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();
    return { ref, snap, data: snap.data() };
}
function normalizeRole(input) {
    const r = String(input !== null && input !== void 0 ? input : '').trim().toLowerCase();
    if (r === 'super_admin' || r === 'superadmin')
        return 'super_admin';
    if (r === 'admin' || r === 'administrator')
        return 'admin';
    if (r === 'maintenance' || r === 'mantenimiento' || r === 'maint' || r === 'maintainer')
        return 'maintenance';
    if (r === 'operator' || r === 'operario' || r === 'op')
        return 'operator';
    return 'operator';
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
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after)
        return;
    if (before.assignedTo === after.assignedTo)
        return;
    console.log('[onTicketAssign]', context.params.ticketId, before.assignedTo, '->', after.assignedTo);
});
exports.onTaskAssign = functions.firestore
    .document('tasks/{taskId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after)
        return;
    if (before.assignedTo === after.assignedTo)
        return;
    console.log('[onTaskAssign]', context.params.taskId, before.assignedTo, '->', after.assignedTo);
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
        const ref = db.collection('organizations').doc('default');
        let def = await ref.get();
        // Si no existe, lo creamos (evita que root no lo vea nunca).
        if (!def.exists) {
            await ref.set({
                name: 'default',
                isActive: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                _auto: 'rootListOrganizations_create_default_v1',
            });
            def = await ref.get();
        }
        const v = def.data() || {};
        rows.unshift({
            id: 'default',
            name: (_d = v === null || v === void 0 ? void 0 : v.name) !== null && _d !== void 0 ? _d : 'default',
            createdAt: (_e = v === null || v === void 0 ? void 0 : v.createdAt) !== null && _e !== void 0 ? _e : null,
            updatedAt: (_f = v === null || v === void 0 ? void 0 : v.updatedAt) !== null && _f !== void 0 ? _f : null,
            isActive: (v === null || v === void 0 ? void 0 : v.isActive) !== false,
        });
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
    var _a, _b, _c, _d;
    const me = await getUserDoc(actorUid);
    if (!me.snap.exists)
        throw httpsError('permission-denied', 'Perfil de usuario no existe.');
    const myOrg = String((_b = (_a = me.data) === null || _a === void 0 ? void 0 : _a.organizationId) !== null && _b !== void 0 ? _b : '');
    const myRole = String((_d = (_c = me.data) === null || _c === void 0 ? void 0 : _c.role) !== null && _d !== void 0 ? _d : '');
    if (myOrg !== orgId)
        throw httpsError('permission-denied', 'No perteneces a esa organización.');
    if (myRole !== 'super_admin')
        throw httpsError('permission-denied', 'Solo super_admin puede gestionar roles.');
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
    const target = await getUserDoc(targetUid);
    if (!target.snap.exists)
        throw httpsError('not-found', 'El usuario objetivo no tiene perfil /users.');
    const before = target.data || {};
    const targetOrg = String((_a = before.organizationId) !== null && _a !== void 0 ? _a : '');
    if (targetOrg !== orgId)
        throw httpsError('failed-precondition', 'El usuario objetivo no pertenece a esa organización.');
    const beforeRole = String((_b = before.role) !== null && _b !== void 0 ? _b : 'operator');
    if (beforeRole === role) {
        return { ok: true, uid: targetUid, organizationId: orgId, role, noChange: true };
    }
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
    const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
    const batch = db.batch();
    batch.set(target.ref, {
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
        targetEmail: String((_c = before.email) !== null && _c !== void 0 ? _c : null),
        before: { role: beforeRole },
        after: { role },
    });
    return { ok: true, uid: targetUid, organizationId: orgId, role };
}
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