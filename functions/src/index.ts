import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

admin.initializeApp();
const db = admin.firestore();

type Role = 'super_admin' | 'admin' | 'maintenance' | 'operator';

function requireAuth(context: functions.https.CallableContext) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'No autenticado.');
  }
  return context.auth;
}

function hasRootClaim(context: functions.https.CallableContext): boolean {
  const token: any = context.auth?.token ?? {};
  return token?.root === true;
}

async function getUserDoc(uid: string) {
  return await db.collection('users').doc(uid).get();
}

async function getUserOrg(uid: string): Promise<string | null> {
  const snap = await getUserDoc(uid);
  return snap.exists ? String(snap.data()?.organizationId ?? '') || null : null;
}

async function getUserRole(uid: string): Promise<string | null> {
  const snap = await getUserDoc(uid);
  return snap.exists ? String(snap.data()?.role ?? '') || null : null;
}

function normalizeRole(input: any): Role {
  const r = String(input ?? '').trim().toLowerCase();
  if (r === 'super_admin') return 'super_admin';
  if (r === 'admin') return 'admin';
  if (r === 'maintenance') return 'maintenance';
  return 'operator';
}

function requireRoot(context: functions.https.CallableContext) {
  requireAuth(context);
  if (!hasRootClaim(context)) {
    throw new functions.https.HttpsError('permission-denied', 'Requiere root claim.');
  }
}

async function requireSuperAdminInOrg(context: functions.https.CallableContext, orgId: string) {
  const auth = requireAuth(context);
  const myOrg = await getUserOrg(auth.uid);
  const myRole = await getUserRole(auth.uid);
  if (!myOrg || myOrg !== orgId) {
    throw new functions.https.HttpsError('permission-denied', 'Fuera de tu organización.');
  }
  if (myRole !== 'super_admin') {
    throw new functions.https.HttpsError('permission-denied', 'Requiere rol super_admin.');
  }
}

async function resolveUidByEmail(email: string): Promise<string> {
  const u = await admin.auth().getUserByEmail(email);
  return u.uid;
}

async function ensureOrganizationDoc(orgId: string) {
  const ref = db.collection('organizations').doc(orgId);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set(
      {
        organizationId: orgId,
        name: orgId,
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'ensureOrganizationDoc',
      },
      { merge: true }
    );
  }
}

async function upsertMembershipAndMember(params: {
  uid: string;
  orgId: string;
  role: Role;
  userData?: any;
}) {
  const { uid, orgId, role, userData } = params;

  const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(uid);
  const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);

  const batch = db.batch();
  batch.set(
    memberRef,
    {
      uid,
      orgId,
      role,
      email: userData?.email ?? null,
      displayName: userData?.displayName ?? null,
      departmentId: userData?.departmentId ?? null,
      active: userData?.active ?? true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: userData?.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
      source: 'rootUpsertMembershipAndMember',
    },
    { merge: true }
  );

  batch.set(
    membershipRef,
    {
      userId: uid,
      organizationId: orgId,
      role,
      active: userData?.active ?? true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'rootUpsertMembershipAndMember',
    },
    { merge: true }
  );

  await batch.commit();
}

async function detachFromOrg(uid: string, orgId: string) {
  const batch = db.batch();
  batch.delete(db.collection('organizations').doc(orgId).collection('members').doc(uid));
  batch.delete(db.collection('memberships').doc(`${uid}_${orgId}`));
  await batch.commit();
}

// -------------------- Root callable APIs (Admin SDK bypass rules) --------------------

export const rootListOrganizations = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);

    const limit = Math.max(1, Math.min(Number(data?.limit ?? 25), 200));
    const cursor = String(data?.cursor ?? '').trim(); // last docId
    const q = String(data?.q ?? '').trim().toLowerCase();
    const includeDefault = data?.includeDefault !== false; // default true
    const includeInactive = data?.includeInactive !== false; // default true

    let query: FirebaseFirestore.Query = db
      .collection('organizations')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);

    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();

    let rows = snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        name: x?.name ?? null,
        isActive: x?.isActive ?? true,
        createdAt: x?.createdAt ?? null,
      };
    });

    if (!includeDefault) rows = rows.filter((r) => r.id !== 'default');
    if (!includeInactive) rows = rows.filter((r) => r.isActive !== false);

    if (q) {
      rows = rows.filter((r) => {
        const hay = `${r.id} ${r.name ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const nextCursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1].id : null;

    return { ok: true, organizations: rows, nextCursor };
  });

export const rootOrgSummary = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);
    const orgId = String(data?.organizationId ?? '').trim();
    if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido');

    const colCount = async (col: string) => {
      try {
        const res = await db.collection(col).where('organizationId', '==', orgId).count().get();
        return Number(res.data().count ?? 0);
      } catch {
        // fallback barato
        const s = await db.collection(col).where('organizationId', '==', orgId).limit(1000).get();
        return s.size;
      }
    };

    const membersSnap = await db.collection('organizations').doc(orgId).collection('members').get();
    const usersSnap = await db.collection('users').where('organizationId', '==', orgId).get();

    return {
      ok: true,
      organizationId: orgId,
      counts: {
        members: membersSnap.size,
        users: usersSnap.size,
        tickets: await colCount('tickets'),
        tasks: await colCount('tasks'),
        sites: await colCount('sites'),
        assets: await colCount('assets'),
        departments: await colCount('departments'),
      },
    };
  });

export const rootListUsersByOrg = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);

    const orgId = String(data?.organizationId ?? '').trim();
    if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido');

    const limit = Math.max(1, Math.min(Number(data?.limit ?? 25), 200));
    const cursorEmail = String(data?.cursorEmail ?? '').trim();
    const cursorUid = String(data?.cursorUid ?? '').trim();
    const q = String(data?.q ?? '').trim().toLowerCase();

    let query: FirebaseFirestore.Query = db
      .collection('users')
      .where('organizationId', '==', orgId)
      .orderBy('email')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);

    if (cursorEmail && cursorUid) query = query.startAfter(cursorEmail, cursorUid);

    const snap = await query.get();

    let rows = snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        uid: d.id,
        email: x?.email ?? null,
        displayName: x?.displayName ?? null,
        role: x?.role ?? null,
        active: x?.active ?? true,
        departmentId: x?.departmentId ?? null,
      };
    });

    if (q) {
      rows = rows.filter((r) => `${r.email ?? ''} ${r.displayName ?? ''} ${r.uid}`.toLowerCase().includes(q));
    }

    const last = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    const nextCursor = last
      ? { cursorEmail: String((last.data() as any)?.email ?? ''), cursorUid: last.id }
      : null;

    return { ok: true, organizationId: orgId, users: rows, nextCursor };
  });

export const rootUpsertUserToOrganization = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);

    const email = String(data?.email ?? '').trim().toLowerCase();
    const orgId = String(data?.organizationId ?? '').trim();
    const role = normalizeRole(data?.role);

    if (!email) throw new functions.https.HttpsError('invalid-argument', 'email requerido');
    if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido');

    const uid = await resolveUidByEmail(email);
    await ensureOrganizationDoc(orgId);

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const prevOrg = userSnap.exists ? String(userSnap.data()?.organizationId ?? '') || null : null;

    // actualiza users/{uid}
    await userRef.set(
      {
        email,
        organizationId: orgId,
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // asegura members + memberships en org destino
    const fresh = await userRef.get();
    await upsertMembershipAndMember({ uid, orgId, role, userData: fresh.data() });

    // limpia el miembro del org anterior (si cambia)
    if (prevOrg && prevOrg !== orgId) {
      await detachFromOrg(uid, prevOrg);
    }

    // auditoría
    await db.collection('audits').add({
      type: 'rootUpsertUserToOrganization',
      actorUid: context.auth?.uid ?? null,
      actorEmail: (context.auth?.token as any)?.email ?? null,
      targetUid: uid,
      targetEmail: email,
      fromOrg: prevOrg,
      toOrg: orgId,
      role,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, uid, email, organizationId: orgId, role };
  });

export const rootDeactivateOrganization = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);
    const orgId = String(data?.organizationId ?? '').trim();
    const isActive = Boolean(data?.isActive ?? false);
    if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido');

    await db.collection('organizations').doc(orgId).set(
      {
        isActive,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await db.collection('audits').add({
      type: 'rootDeactivateOrganization',
      actorUid: context.auth?.uid ?? null,
      actorEmail: (context.auth?.token as any)?.email ?? null,
      organizationId: orgId,
      isActive,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
  });

export const rootDeleteOrganizationScaffold = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);
    const orgId = String(data?.organizationId ?? '').trim();
    if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido');

    const orgRef = db.collection('organizations').doc(orgId);

    // Borra members subcollection (scaffold)
    const members = await orgRef.collection('members').get();
    const batch = db.batch();
    members.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(orgRef);
    await batch.commit();

    await db.collection('audits').add({
      type: 'rootDeleteOrganizationScaffold',
      actorUid: context.auth?.uid ?? null,
      actorEmail: (context.auth?.token as any)?.email ?? null,
      organizationId: orgId,
      membersDeleted: members.size,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, membersDeleted: members.size };
  });

export const rootPurgeOrganizationCollection = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);
    const orgId = String(data?.organizationId ?? '').trim();
    const collection = String(data?.collection ?? '').trim();
    const batchSize = Math.min(Math.max(Number(data?.batchSize ?? 200), 50), 500);

    if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido');
    if (!collection) throw new functions.https.HttpsError('invalid-argument', 'collection requerida');

    const colRef = db.collection(collection);

    let deleted = 0;
    while (true) {
      const snap = await colRef.where('organizationId', '==', orgId).limit(batchSize).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      deleted += snap.size;
      if (snap.size < batchSize) break;
    }

    await db.collection('audits').add({
      type: 'rootPurgeOrganizationCollection',
      actorUid: context.auth?.uid ?? null,
      actorEmail: (context.auth?.token as any)?.email ?? null,
      organizationId: orgId,
      collection,
      deleted,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, deleted };
  });

// Compatibilidad: si en cloud existe este nombre y tu local no, firebase te pide borrarlo.
// Lo dejamos como alias seguro.
export const rootSetUserRootClaim = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    requireRoot(context);

    const email = String(data?.email ?? '').trim().toLowerCase();
    const uid = String(data?.uid ?? '').trim();
    const root = Boolean(data?.root ?? false);

    if (!email && !uid) throw new functions.https.HttpsError('invalid-argument', 'email o uid requerido');

    const targetUid = uid ? uid : await resolveUidByEmail(email);
    await admin.auth().setCustomUserClaims(targetUid, { root });

    await db.collection('audits').add({
      type: 'rootSetUserRootClaim',
      actorUid: context.auth?.uid ?? null,
      actorEmail: (context.auth?.token as any)?.email ?? null,
      targetUid,
      targetEmail: email || null,
      root,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, uid: targetUid, email: email || null, root };
  });

// -------------------- Promote to super_admin within org (audited, no cross-org) --------------------
export const promoteToSuperAdminWithinOrg = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    const orgId = String(data?.organizationId ?? '').trim();
    const email = String(data?.email ?? '').trim().toLowerCase();
    const uid = String(data?.uid ?? '').trim();

    if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido');
    if (!email && !uid) throw new functions.https.HttpsError('invalid-argument', 'email o uid requerido');

    await requireSuperAdminInOrg(context, orgId);

    const targetUid = uid ? uid : await resolveUidByEmail(email);

    // Verifica que el target pertenece a esa org (en users)
    const targetRef = db.collection('users').doc(targetUid);
    const targetSnap = await targetRef.get();
    const targetOrg = targetSnap.exists ? String(targetSnap.data()?.organizationId ?? '') : '';
    if (targetOrg !== orgId) {
      throw new functions.https.HttpsError('failed-precondition', 'El usuario no pertenece a esa organización.');
    }

    const batch = db.batch();
    batch.set(
      targetRef,
      { role: 'super_admin', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    batch.set(
      db.collection('organizations').doc(orgId).collection('members').doc(targetUid),
      { role: 'super_admin', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    batch.set(
      db.collection('memberships').doc(`${targetUid}_${orgId}`),
      { role: 'super_admin', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );

    await batch.commit();

    await db.collection('audits').add({
      type: 'promoteToSuperAdminWithinOrg',
      actorUid: context.auth?.uid ?? null,
      actorEmail: (context.auth?.token as any)?.email ?? null,
      organizationId: orgId,
      targetUid,
      targetEmail: email || null,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, organizationId: orgId, uid: targetUid, role: 'super_admin' };
  });

// -------------------- Tus triggers (mínimos y seguros) --------------------
// Nota: Mantengo nombres para no romper deploy. Si tú ya tenías lógica, pégala dentro.
export const onTicketAssign = functions
  .region('us-central1')
  .firestore.document('tickets/{ticketId}')
  .onUpdate(async (change) => {
    // placeholder seguro: solo actualiza updatedAt si cambia asignación
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;
    if (before.assignedToUid === after.assignedToUid) return;
    await change.after.ref.set({ updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });

export const onTaskAssign = functions
  .region('us-central1')
  .firestore.document('tasks/{taskId}')
  .onUpdate(async (change) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;
    if (before.assignedToUid === after.assignedToUid) return;
    await change.after.ref.set({ updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });

export const onTicketClosed = functions
  .region('us-central1')
  .firestore.document('tickets/{ticketId}')
  .onUpdate(async (change) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;
    if (before.status === after.status) return;
    if (String(after.status ?? '') !== 'Cerrada') return;
    await change.after.ref.set({ closedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });

export const onTicketDeleted = functions
  .region('us-central1')
  .firestore.document('tickets/{ticketId}')
  .onDelete(async () => {
    return;
  });

export const onTaskDeleted = functions
  .region('us-central1')
  .firestore.document('tasks/{taskId}')
  .onDelete(async () => {
    return;
  });
