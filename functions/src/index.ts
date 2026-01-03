import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

type Role = 'super_admin' | 'admin' | 'maintenance' | 'operator';

function httpsError(code: functions.https.FunctionsErrorCode, message: string) {
  return new functions.https.HttpsError(code, message);
}

function requireAuth(context: functions.https.CallableContext) {
  if (!context.auth?.uid) throw httpsError('unauthenticated', 'Debes iniciar sesión.');
  return context.auth.uid;
}

function isRootClaim(context: functions.https.CallableContext): boolean {
  return Boolean((context.auth?.token as any)?.root === true);
}

async function getUserDoc(uid: string) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  return { ref, snap, data: snap.data() as any | undefined };
}

function normalizeRole(input: any): Role {
  const r = String(input ?? '').trim().toLowerCase();

  if (r === 'super_admin' || r === 'superadmin') return 'super_admin';
  if (r === 'admin' || r === 'administrator') return 'admin';

  if (r === 'maintenance' || r === 'mantenimiento' || r === 'maint' || r === 'maintainer') return 'maintenance';
  if (r === 'operator' || r === 'operario' || r === 'op') return 'operator';

  return 'operator';
}

async function ensureDefaultOrganizationExists() {
  const ref = db.collection('organizations').doc('default');
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set(
      {
        organizationId: 'default',
        name: 'default',
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'ensure_default_org_v1',
      },
      { merge: true }
    );
  } else {
    const d = snap.data() as any;
    // si no existe el campo, lo normalizamos para que nunca se "pierda" en queries futuras
    if (d?.isActive === undefined) {
      await ref.set({ isActive: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
  }
}

async function countQuery(q: FirebaseFirestore.Query) {
  try {
    // @ts-ignore - count() existe en SDK modernos
    const agg = await q.count().get();
    // @ts-ignore
    return Number(agg.data()?.count ?? 0);
  } catch {
    const snap = await q.get();
    return snap.size;
  }
}

async function auditLog(params: {
  action: string;
  actorUid: string;
  actorEmail?: string | null;
  orgId?: string | null;
  targetUid?: string | null;
  targetEmail?: string | null;
  before?: any;
  after?: any;
  meta?: any;
}) {
  await db.collection('auditLogs').add({
    ...params,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/* ------------------------------
   FIRESTORE TRIGGERS (GEN1)
--------------------------------- */

export const onTicketAssign = functions.firestore
  .document('tickets/{ticketId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;

    if (before.assignedTo === after.assignedTo) return;

    console.log('[onTicketAssign]', context.params.ticketId, before.assignedTo, '->', after.assignedTo);
  });

export const onTaskAssign = functions.firestore
  .document('tasks/{taskId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;

    if (before.assignedTo === after.assignedTo) return;

    console.log('[onTaskAssign]', context.params.taskId, before.assignedTo, '->', after.assignedTo);
  });

export const onTicketClosed = functions.firestore
  .document('tickets/{ticketId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;

    if (before.status === after.status) return;

    const s = String(after.status ?? '').toLowerCase();
    if (s !== 'cerrada' && s !== 'closed') return;

    console.log('[onTicketClosed]', context.params.ticketId, 'status ->', after.status);
  });

export const onTicketDeleted = functions.firestore
  .document('tickets/{ticketId}')
  .onDelete(async (_snap, context) => {
    console.log('[onTicketDeleted]', context.params.ticketId);
  });

export const onTaskDeleted = functions.firestore
  .document('tasks/{taskId}')
  .onDelete(async (_snap, context) => {
    console.log('[onTaskDeleted]', context.params.taskId);
  });

/* ------------------------------
   ROOT (custom claim) CALLABLES
--------------------------------- */

function requireRoot(context: functions.https.CallableContext) {
  const uid = requireAuth(context);
  if (!isRootClaim(context)) throw httpsError('permission-denied', 'Solo ROOT (claim) puede hacer esto.');
  return uid;
}

export const rootListOrganizations = functions.https.onCall(async (data, context) => {
  requireRoot(context);

  const limit = Math.min(Number(data?.limit ?? 25), 200);
  const cursor = String(data?.cursor ?? '').trim(); // last docId
  const qTerm = String(data?.q ?? '').trim();
  const includeDefault = data?.includeDefault !== false; // default true
  const includeInactive = data?.includeInactive !== false; // default true

  if (includeDefault) await ensureDefaultOrganizationExists();

  // OJO: NO usar where('isActive','!=',false) porque excluye docs sin el campo isActive (como default)
  let query: FirebaseFirestore.Query = db
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
  } else if (cursor) {
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
    const v = d.data() as any;
    const isActive = v?.isActive !== false; // missing => true
    return {
      id: d.id,
      name: v?.name ?? null,
      isActive,
      createdAt: v?.createdAt ?? null,
      updatedAt: v?.updatedAt ?? null,
    };
  });

  if (!includeInactive) rows = rows.filter((o) => o.isActive);

  // fuerza default visible si por lo que sea no vino (y el caller lo pidió)
  if (includeDefault && !rows.some((r) => r.id === 'default')) {
    const def = await db.collection('organizations').doc('default').get();
    if (def.exists) {
      const v = def.data() as any;
      rows.unshift({
        id: 'default',
        name: v?.name ?? 'default',
        isActive: v?.isActive !== false,
        createdAt: v?.createdAt ?? null,
        updatedAt: v?.updatedAt ?? null,
      });
    }
  }

  const nextCursor = hasMore ? docs[limit].id : null;

  return { ok: true, organizations: rows, nextCursor };
});

export const rootOrgSummary = functions.https.onCall(async (data, context) => {
  requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

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

export const rootListUsersByOrg = functions.https.onCall(async (data, context) => {
  requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const limit = Math.min(Number(data?.limit ?? 25), 200);
  const cursorEmail = String(data?.cursorEmail ?? '').trim();
  const cursorUid = String(data?.cursorUid ?? '').trim();
  const qTerm = String(data?.q ?? '').trim();

  let query: FirebaseFirestore.Query = db
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
  } else if (cursorEmail && cursorUid) {
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
    const v = d.data() as any;
    return {
      uid: d.id,
      email: v?.email ?? null,
      displayName: v?.displayName ?? null,
      active: v?.active !== false,
      role: v?.role ?? null,
      departmentId: v?.departmentId ?? null,
      createdAt: v?.createdAt ?? null,
      updatedAt: v?.updatedAt ?? null,
    };
  });

  const nextCursor = hasMore ? docs[limit] : null;

  return {
    ok: true,
    organizationId: orgId,
    users,
    nextCursorEmail: nextCursor ? String(nextCursor.get('email') ?? '') : null,
    nextCursorUid: nextCursor ? nextCursor.id : null,
  };
});

export const rootUpsertUserToOrganization = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const email = String(data?.email ?? '').trim().toLowerCase();
  const orgId = String(data?.organizationId ?? '').trim();
  const roleIn = String(data?.role ?? '').trim();

  if (!email) throw httpsError('invalid-argument', 'Email requerido.');
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const role: Role = normalizeRole(roleIn);

  const authUser = await admin.auth().getUserByEmail(email).catch(() => null);
  if (!authUser?.uid) throw httpsError('not-found', 'No existe ese usuario en Auth.');

  const uid = authUser.uid;

  await db.collection('organizations').doc(orgId).set(
    {
      organizationId: orgId,
      name: orgId,
      isActive: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  const userRef = db.collection('users').doc(uid);
  const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(uid);
  const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);

  const beforeSnap = await userRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() : null;

  const batch = db.batch();

  batch.set(
    userRef,
    {
      email: authUser.email ?? email,
      displayName: authUser.displayName ?? null,
      organizationId: orgId,
      role,
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: beforeSnap.exists
        ? beforeSnap.get('createdAt') ?? admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  batch.set(
    memberRef,
    {
      uid,
      orgId,
      email: authUser.email ?? email,
      displayName: authUser.displayName ?? null,
      active: true,
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  batch.set(
    membershipRef,
    {
      userId: uid,
      organizationId: orgId,
      role,
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  await batch.commit();

  await auditLog({
    action: 'rootUpsertUserToOrganization',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
    targetUid: uid,
    targetEmail: email,
    before,
    after: { organizationId: orgId, role },
  });

  return { ok: true, uid, email, organizationId: orgId, role };
});

export const rootDeactivateOrganization = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  const isActive = Boolean(data?.isActive ?? false);
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  await db.collection('organizations').doc(orgId).set(
    {
      isActive,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'rootDeactivateOrganization_v1',
    },
    { merge: true }
  );

  await auditLog({
    action: 'rootDeactivateOrganization',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
    after: { isActive },
  });

  return { ok: true, organizationId: orgId, isActive };
});

export const rootDeleteOrganizationScaffold = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const batch = db.batch();
  batch.delete(db.collection('organizations').doc(orgId));
  batch.delete(db.collection('organizationsPublic').doc(orgId));
  await batch.commit();

  await auditLog({
    action: 'rootDeleteOrganizationScaffold',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
  });

  return { ok: true, organizationId: orgId };
});

export const rootPurgeOrganizationCollection = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  const collection = String(data?.collection ?? '').trim();
  const batchSize = Math.min(Math.max(Number(data?.batchSize ?? 200), 50), 500);

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!collection) throw httpsError('invalid-argument', 'collection requerida.');

  const allowed = new Set(['tickets', 'tasks', 'sites', 'assets', 'departments', 'memberships', 'users']);
  if (!allowed.has(collection)) throw httpsError('invalid-argument', 'Colección no permitida para purge.');

  let totalDeleted = 0;

  while (true) {
    const q = db.collection(collection).where('organizationId', '==', orgId).limit(batchSize);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    totalDeleted += snap.size;
    if (snap.size < batchSize) break;
  }

  await auditLog({
    action: 'rootPurgeOrganizationCollection',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
    meta: { collection, totalDeleted, batchSize },
  });

  return { ok: true, organizationId: orgId, collection, deleted: totalDeleted };
});

/* ------------------------------
   ORG-SCOPED ROLE MGMT (callable)
   (para que el cliente NO toque roles)
--------------------------------- */

async function requireCallerSuperAdminInOrg(actorUid: string, orgId: string) {
  const me = await getUserDoc(actorUid);
  if (!me.snap.exists) throw httpsError('permission-denied', 'Perfil de usuario no existe.');

  const myOrg = String(me.data?.organizationId ?? '');
  const myRole = String(me.data?.role ?? '');

  if (myOrg !== orgId) throw httpsError('permission-denied', 'No perteneces a esa organización.');
  if (myRole !== 'super_admin') throw httpsError('permission-denied', 'Solo super_admin puede gestionar roles.');
}

async function resolveTargetUidByEmailOrUid(email?: string, uid?: string) {
  const u = String(uid ?? '').trim();
  if (u) return u;

  const e = String(email ?? '').trim().toLowerCase();
  if (!e) throw httpsError('invalid-argument', 'Debes indicar uid o email del usuario objetivo.');

  const authUser = await admin.auth().getUserByEmail(e).catch(() => null);
  if (!authUser?.uid) throw httpsError('not-found', 'No existe ese usuario en Auth.');
  return authUser.uid;
}

async function setRoleWithinOrgImpl(params: {
  actorUid: string;
  actorEmail: string | null;
  isRoot: boolean;
  orgId: string;
  targetUid: string;
  role: Role;
}) {
  const { actorUid, actorEmail, isRoot, orgId, targetUid, role } = params;

  if (!isRoot) {
    await requireCallerSuperAdminInOrg(actorUid, orgId);
  }

  const target = await getUserDoc(targetUid);
  if (!target.snap.exists) throw httpsError('not-found', 'El usuario objetivo no tiene perfil /users.');

  const before = target.data || {};
  const targetOrg = String(before.organizationId ?? '');
  if (targetOrg !== orgId) throw httpsError('failed-precondition', 'El usuario objetivo no pertenece a esa organización.');

  const beforeRole = String(before.role ?? 'operator');
  if (beforeRole === role) {
    return { ok: true, uid: targetUid, organizationId: orgId, role, noChange: true };
  }

  const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
  const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);

  const batch = db.batch();

  batch.set(
    target.ref,
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'setRoleWithinOrg_v1',
    },
    { merge: true }
  );

  batch.set(
    memberRef,
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'setRoleWithinOrg_v1',
    },
    { merge: true }
  );

  batch.set(
    membershipRef,
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'setRoleWithinOrg_v1',
    },
    { merge: true }
  );

  await batch.commit();

  await auditLog({
    action: 'setRoleWithinOrg',
    actorUid,
    actorEmail,
    orgId,
    targetUid,
    targetEmail: String(before.email ?? null),
    before: { role: beforeRole },
    after: { role },
  });

  return { ok: true, uid: targetUid, organizationId: orgId, role };
}

export const setRoleWithinOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const isRoot = isRootClaim(context);

  const targetUid = await resolveTargetUidByEmailOrUid(data?.email, data?.uid);
  const role: Role = normalizeRole(data?.role);

  return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role });
});

export const promoteToSuperAdminWithinOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const isRoot = isRootClaim(context);
  const targetUid = await resolveTargetUidByEmailOrUid(data?.email, data?.uid);

  return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role: 'super_admin' });
});

export const demoteToAdminWithinOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const isRoot = isRootClaim(context);
  const targetUid = await resolveTargetUidByEmailOrUid(data?.email, data?.uid);

  return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role: 'admin' });
});
