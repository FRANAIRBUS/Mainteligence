"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rootPurgeOrganizationCollection = exports.rootDeleteOrganizationScaffold = exports.rootDeactivateOrganization = exports.rootListUsersByOrg = exports.rootOrgSummary = exports.rootSetUserRootClaim = exports.rootUpsertUserToOrganization = exports.rootListOrganizations = exports.onTaskDeleted = exports.onTicketDeleted = exports.onTicketClosed = exports.onTaskAssign = exports.onTicketAssign = void 0;
const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
admin.initializeApp();
function assertRoot(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const token = context.auth.token;
    if ((token === null || token === void 0 ? void 0 : token.root) !== true) {
        throw new functions.https.HttpsError('permission-denied', 'Solo root puede ejecutar esta acción.');
    }
}
function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
}
async function safeCount(q) {
    var _a, _b;
    const anyQ = q;
    if (typeof anyQ.count === 'function') {
        const res = await anyQ.count().get();
        return Number((_b = (_a = res === null || res === void 0 ? void 0 : res.data()) === null || _a === void 0 ? void 0 : _a.count) !== null && _b !== void 0 ? _b : 0);
    }
    const snap = await q.get();
    return snap.size;
}
// --------------------------
// TRIGGERS
// --------------------------
exports.onTicketAssign = functions.firestore
    .document('tickets/{ticketId}')
    .onUpdate(async (change, context) => {
    var _a, _b;
    const after = change.after.data();
    const before = change.before.data();
    if (!after || !before)
        return;
    const prev = (_a = before.assignedToUserId) !== null && _a !== void 0 ? _a : null;
    const next = (_b = after.assignedToUserId) !== null && _b !== void 0 ? _b : null;
    if (prev === next)
        return;
    logger.info('onTicketAssign', { ticketId: context.params.ticketId, prev, next });
});
exports.onTaskAssign = functions.firestore
    .document('tasks/{taskId}')
    .onUpdate(async (change, context) => {
    var _a, _b;
    const after = change.after.data();
    const before = change.before.data();
    if (!after || !before)
        return;
    const prev = (_a = before.assignedToUserId) !== null && _a !== void 0 ? _a : null;
    const next = (_b = after.assignedToUserId) !== null && _b !== void 0 ? _b : null;
    if (prev === next)
        return;
    logger.info('onTaskAssign', { taskId: context.params.taskId, prev, next });
});
exports.onTicketClosed = functions.firestore
    .document('tickets/{ticketId}')
    .onUpdate(async (change, context) => {
    var _a, _b;
    const after = change.after.data();
    const before = change.before.data();
    if (!after || !before)
        return;
    const wasClosed = String((_a = before.status) !== null && _a !== void 0 ? _a : '').toLowerCase() === 'closed';
    const isClosed = String((_b = after.status) !== null && _b !== void 0 ? _b : '').toLowerCase() === 'closed';
    if (wasClosed || !isClosed)
        return;
    logger.info('onTicketClosed', { ticketId: context.params.ticketId });
});
exports.onTicketDeleted = functions.firestore
    .document('tickets/{ticketId}')
    .onDelete(async (_snap, context) => {
    logger.info('onTicketDeleted', { ticketId: context.params.ticketId });
});
exports.onTaskDeleted = functions.firestore
    .document('tasks/{taskId}')
    .onDelete(async (_snap, context) => {
    logger.info('onTaskDeleted', { taskId: context.params.taskId });
});
// --------------------------
// ROOT CALLABLES
// --------------------------
exports.rootListOrganizations = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    assertRoot(context);
    const db = admin.firestore();
    const limit = Math.max(1, Math.min(200, Number((_a = data === null || data === void 0 ? void 0 : data.limit) !== null && _a !== void 0 ? _a : 25)));
    const cursor = String((_b = data === null || data === void 0 ? void 0 : data.cursor) !== null && _b !== void 0 ? _b : '').trim(); // last orgId from previous page
    const search = String((_c = data === null || data === void 0 ? void 0 : data.search) !== null && _c !== void 0 ? _c : '').trim(); // prefix match on orgId
    const includeInactive = Boolean((_d = data === null || data === void 0 ? void 0 : data.includeInactive) !== null && _d !== void 0 ? _d : true);
    // Ensure canonical "default" exists so it always appears in listings.
    const defaultRef = db.collection('organizations').doc('default');
    const defaultSnap = await defaultRef.get();
    if (!defaultSnap.exists) {
        await defaultRef.set({
            organizationId: 'default',
            name: 'default',
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'auto_ensure_default_org',
        }, { merge: true });
    }
    else {
        await defaultRef.set({
            organizationId: 'default',
            name: (_f = (_e = defaultSnap.data()) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : 'default',
            isActive: (_h = (_g = defaultSnap.data()) === null || _g === void 0 ? void 0 : _g.isActive) !== null && _h !== void 0 ? _h : true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    // Order by documentId to avoid missing-field issues.
    let q = db
        .collection('organizations')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit + 1);
    if (search) {
        const end = `${search}\uf8ff`;
        q = q.startAt(search).endAt(end);
    }
    if (cursor) {
        q = q.startAfter(cursor);
    }
    const snap = await q.get();
    const docs = snap.docs;
    const rows = docs.slice(0, limit).map((d) => {
        const v = d.data() || {};
        const isActive = typeof v.isActive === 'boolean' ? v.isActive : true;
        return {
            id: d.id,
            name: v.name,
            isActive,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt,
        };
    });
    const filtered = includeInactive ? rows : rows.filter((r) => r.isActive !== false);
    const nextCursorOut = docs.length > limit ? docs[limit].id : null;
    return { organizations: filtered, nextCursor: nextCursorOut };
});
exports.rootUpsertUserToOrganization = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    assertRoot(context);
    const email = String((_a = data === null || data === void 0 ? void 0 : data.email) !== null && _a !== void 0 ? _a : '').trim().toLowerCase();
    const orgId = String((_b = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _b !== void 0 ? _b : '').trim();
    const role = String((_c = data === null || data === void 0 ? void 0 : data.role) !== null && _c !== void 0 ? _c : '').trim();
    if (!email)
        throw new functions.https.HttpsError('invalid-argument', 'Email requerido.');
    if (!orgId)
        throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
    if (!role)
        throw new functions.https.HttpsError('invalid-argument', 'role requerido.');
    const auth = admin.auth();
    const user = await auth.getUserByEmail(email);
    const db = admin.firestore();
    const uid = user.uid;
    // Ensure org doc exists
    const orgRef = db.collection('organizations').doc(orgId);
    await orgRef.set({
        organizationId: orgId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    // Update /users/{uid}
    const userRef = db.collection('users').doc(uid);
    await userRef.set({
        email,
        organizationId: orgId,
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    // memberships
    const msRef = db.collection('memberships').doc(`${uid}_${orgId}`);
    await msRef.set({
        userId: uid,
        organizationId: orgId,
        role,
        active: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'root_upsert_user_to_org',
    }, { merge: true });
    // org members subcollection
    const memberRef = orgRef.collection('members').doc(uid);
    await memberRef.set({
        uid,
        orgId,
        email,
        displayName: (_d = user.displayName) !== null && _d !== void 0 ? _d : null,
        active: true,
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'root_upsert_user_to_org',
    }, { merge: true });
    return { ok: true, uid, organizationId: orgId, role };
});
exports.rootSetUserRootClaim = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    assertRoot(context);
    const email = String((_a = data === null || data === void 0 ? void 0 : data.email) !== null && _a !== void 0 ? _a : '').trim();
    const uidIn = String((_b = data === null || data === void 0 ? void 0 : data.uid) !== null && _b !== void 0 ? _b : '').trim();
    const root = Boolean(data === null || data === void 0 ? void 0 : data.root);
    const detach = Boolean((_c = data === null || data === void 0 ? void 0 : data.detach) !== null && _c !== void 0 ? _c : true);
    if (!email && !uidIn) {
        throw new functions.https.HttpsError('invalid-argument', 'Falta email o uid.');
    }
    const auth = admin.auth();
    const userRecord = uidIn ? await auth.getUser(uidIn) : await auth.getUserByEmail(email);
    const uid = userRecord.uid;
    const currentClaims = ((_d = userRecord.customClaims) !== null && _d !== void 0 ? _d : {});
    const nextClaims = Object.assign(Object.assign({}, currentClaims), { root });
    if (!root)
        delete nextClaims.root;
    await auth.setCustomUserClaims(uid, nextClaims);
    let firestoreOps = 0;
    if (detach) {
        const db = admin.firestore();
        const batch = db.batch();
        const uRef = db.collection('users').doc(uid);
        const uSnap = await uRef.get();
        if (uSnap.exists) {
            batch.delete(uRef);
            firestoreOps++;
        }
        const msSnap = await db.collection('memberships').where('userId', '==', uid).get();
        msSnap.docs.forEach((d) => {
            batch.delete(d.ref);
            firestoreOps++;
        });
        const orgs = await db.collection('organizations').get();
        for (const o of orgs.docs) {
            const mRef = db.collection('organizations').doc(o.id).collection('members').doc(uid);
            const mSnap = await mRef.get();
            if (mSnap.exists) {
                batch.delete(mRef);
                firestoreOps++;
            }
        }
        if (firestoreOps > 0)
            await batch.commit();
    }
    return { ok: true, uid, email: userRecord.email, root, detached: detach, firestoreOps };
});
exports.rootOrgSummary = functions.https.onCall(async (data, context) => {
    var _a;
    assertRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (!orgId)
        throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
    const db = admin.firestore();
    const orgRef = db.collection('organizations').doc(orgId);
    const membersQ = orgRef.collection('members');
    const usersQ = db.collection('users').where('organizationId', '==', orgId);
    const ticketsQ = db.collection('tickets').where('organizationId', '==', orgId);
    const tasksQ = db.collection('tasks').where('organizationId', '==', orgId);
    const sitesQ = db.collection('sites').where('organizationId', '==', orgId);
    const assetsQ = db.collection('assets').where('organizationId', '==', orgId);
    const departmentsQ = db.collection('departments').where('organizationId', '==', orgId);
    const [members, users, tickets, tasks, sites, assets, departments] = await Promise.all([
        safeCount(membersQ),
        safeCount(usersQ),
        safeCount(ticketsQ),
        safeCount(tasksQ),
        safeCount(sitesQ),
        safeCount(assetsQ),
        safeCount(departmentsQ),
    ]);
    return {
        ok: true,
        organizationId: orgId,
        counts: { members, users, tickets, tasks, sites, assets, departments },
    };
});
exports.rootListUsersByOrg = functions.https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    assertRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (!orgId)
        throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
    const limit = clampInt(data === null || data === void 0 ? void 0 : data.limit, 1, 200, 25);
    const searchEmail = String((_b = data === null || data === void 0 ? void 0 : data.searchEmail) !== null && _b !== void 0 ? _b : '').trim().toLowerCase();
    const cursor = data === null || data === void 0 ? void 0 : data.cursor;
    const db = admin.firestore();
    let q = db
        .collection('organizations')
        .doc(orgId)
        .collection('members')
        .orderBy('email')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit + 1);
    if (searchEmail) {
        const end = `${searchEmail}\uf8ff`;
        q = q.startAt(searchEmail).endAt(end);
    }
    if ((cursor === null || cursor === void 0 ? void 0 : cursor.email) && (cursor === null || cursor === void 0 ? void 0 : cursor.uid)) {
        q = q.startAfter(cursor.email.toLowerCase(), cursor.uid);
    }
    const snap = await q.get();
    const docs = snap.docs;
    const users = docs.slice(0, limit).map((d) => {
        var _a, _b, _c, _d, _e;
        const v = d.data() || {};
        return {
            uid: d.id,
            email: (_a = v.email) !== null && _a !== void 0 ? _a : null,
            displayName: (_b = v.displayName) !== null && _b !== void 0 ? _b : null,
            active: (_c = v.active) !== null && _c !== void 0 ? _c : true,
            role: (_d = v.role) !== null && _d !== void 0 ? _d : 'operator',
            departmentId: (_e = v.departmentId) !== null && _e !== void 0 ? _e : null,
        };
    });
    const nextCursor = docs.length > limit
        ? { email: String((_d = (_c = docs[limit].data()) === null || _c === void 0 ? void 0 : _c.email) !== null && _d !== void 0 ? _d : ''), uid: docs[limit].id }
        : null;
    return { ok: true, organizationId: orgId, users, nextCursor };
});
exports.rootDeactivateOrganization = functions.https.onCall(async (data, context) => {
    var _a, _b;
    assertRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    if (!orgId)
        throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
    const isActive = Boolean((_b = data === null || data === void 0 ? void 0 : data.isActive) !== null && _b !== void 0 ? _b : false);
    const db = admin.firestore();
    await db.collection('organizations').doc(orgId).set({ isActive, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, organizationId: orgId, isActive };
});
exports.rootDeleteOrganizationScaffold = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    assertRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    const confirm = String((_b = data === null || data === void 0 ? void 0 : data.confirm) !== null && _b !== void 0 ? _b : '').trim();
    if (!orgId)
        throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
    if (confirm !== orgId) {
        throw new functions.https.HttpsError('failed-precondition', 'Confirmación inválida. Debes escribir exactamente el organizationId.');
    }
    const hardDelete = Boolean((_c = data === null || data === void 0 ? void 0 : data.hardDelete) !== null && _c !== void 0 ? _c : false);
    const db = admin.firestore();
    const ref = db.collection('organizations').doc(orgId);
    await ref.set({
        isActive: false,
        isDeleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    if (hardDelete) {
        await ref.delete(); // NO borra subcolecciones
    }
    return { ok: true, organizationId: orgId, hardDelete };
});
exports.rootPurgeOrganizationCollection = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    assertRoot(context);
    const orgId = String((_a = data === null || data === void 0 ? void 0 : data.organizationId) !== null && _a !== void 0 ? _a : '').trim();
    const collection = String((_b = data === null || data === void 0 ? void 0 : data.collection) !== null && _b !== void 0 ? _b : '').trim();
    const confirm = String((_c = data === null || data === void 0 ? void 0 : data.confirm) !== null && _c !== void 0 ? _c : '').trim();
    if (!orgId)
        throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
    if (!collection)
        throw new functions.https.HttpsError('invalid-argument', 'collection requerido.');
    if (confirm !== orgId) {
        throw new functions.https.HttpsError('failed-precondition', 'Confirmación inválida. Debes escribir exactamente el organizationId.');
    }
    const allowed = ['tickets', 'tasks', 'sites', 'assets', 'departments', 'memberships', 'members'];
    if (!allowed.includes(collection)) {
        throw new functions.https.HttpsError('invalid-argument', `collection no permitido: ${collection}`);
    }
    const batchSize = clampInt(data === null || data === void 0 ? void 0 : data.batchSize, 50, 500, 250);
    const maxDocs = clampInt(data === null || data === void 0 ? void 0 : data.maxDocs, 1, 5000, 1500);
    const db = admin.firestore();
    let deleted = 0;
    const deleteBatch = async (docs) => {
        const batch = db.batch();
        docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += docs.length;
    };
    if (collection === 'members') {
        let hasMore = true;
        while (hasMore && deleted < maxDocs) {
            const snap = await db
                .collection('organizations')
                .doc(orgId)
                .collection('members')
                .limit(Math.min(batchSize, maxDocs - deleted))
                .get();
            if (snap.empty) {
                hasMore = false;
                break;
            }
            await deleteBatch(snap.docs);
            hasMore = snap.size > 0 && deleted < maxDocs;
        }
        return { ok: true, organizationId: orgId, collection, deleted, hasMore: deleted >= maxDocs };
    }
    let hasMore = true;
    while (hasMore && deleted < maxDocs) {
        const snap = await db
            .collection(collection)
            .where('organizationId', '==', orgId)
            .limit(Math.min(batchSize, maxDocs - deleted))
            .get();
        if (snap.empty) {
            hasMore = false;
            break;
        }
        await deleteBatch(snap.docs);
        hasMore = snap.size > 0 && deleted < maxDocs;
    }
    return { ok: true, organizationId: orgId, collection, deleted, hasMore: deleted >= maxDocs };
});
//# sourceMappingURL=index.js.map