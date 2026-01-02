import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

admin.initializeApp();

function assertRoot(context: functions.https.CallableContext): void {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const token = context.auth.token as Record<string, unknown>;
  if (token?.root !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Solo root puede ejecutar esta acción.');
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

async function safeCount(q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>): Promise<number> {
  const anyQ = q as any;
  if (typeof anyQ.count === 'function') {
    const res = await anyQ.count().get();
    return Number(res?.data()?.count ?? 0);
  }
  const snap = await q.get();
  return snap.size;
}

// --------------------------
// TRIGGERS
// --------------------------

export const onTicketAssign = functions.firestore
  .document('tickets/{ticketId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data() as any;
    const before = change.before.data() as any;
    if (!after || !before) return;

    const prev = before.assignedToUserId ?? null;
    const next = after.assignedToUserId ?? null;
    if (prev === next) return;

    logger.info('onTicketAssign', { ticketId: context.params.ticketId, prev, next });
  });

export const onTaskAssign = functions.firestore
  .document('tasks/{taskId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data() as any;
    const before = change.before.data() as any;
    if (!after || !before) return;

    const prev = before.assignedToUserId ?? null;
    const next = after.assignedToUserId ?? null;
    if (prev === next) return;

    logger.info('onTaskAssign', { taskId: context.params.taskId, prev, next });
  });

export const onTicketClosed = functions.firestore
  .document('tickets/{ticketId}')
  .onUpdate(async (change, context) => {
    const after = change.after.data() as any;
    const before = change.before.data() as any;
    if (!after || !before) return;

    const wasClosed = String(before.status ?? '').toLowerCase() === 'closed';
    const isClosed = String(after.status ?? '').toLowerCase() === 'closed';
    if (wasClosed || !isClosed) return;

    logger.info('onTicketClosed', { ticketId: context.params.ticketId });
  });

export const onTicketDeleted = functions.firestore
  .document('tickets/{ticketId}')
  .onDelete(async (_snap, context) => {
    logger.info('onTicketDeleted', { ticketId: context.params.ticketId });
  });

export const onTaskDeleted = functions.firestore
  .document('tasks/{taskId}')
  .onDelete(async (_snap, context) => {
    logger.info('onTaskDeleted', { taskId: context.params.taskId });
  });

// --------------------------
// ROOT CALLABLES
// --------------------------

export const rootListOrganizations = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const db = admin.firestore();

  const limit = Math.max(1, Math.min(200, Number((data as any)?.limit ?? 25)));
  const cursor = String((data as any)?.cursor ?? '').trim(); // last orgId from previous page
  const search = String((data as any)?.search ?? '').trim(); // prefix match on orgId
  const includeInactive = Boolean((data as any)?.includeInactive ?? true);

  // Ensure canonical "default" exists so it always appears in listings.
  const defaultRef = db.collection('organizations').doc('default');
  const defaultSnap = await defaultRef.get();

  if (!defaultSnap.exists) {
    await defaultRef.set(
      {
        organizationId: 'default',
        name: 'default',
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'auto_ensure_default_org',
      },
      { merge: true }
    );
  } else {
    await defaultRef.set(
      {
        organizationId: 'default',
        name: (defaultSnap.data() as any)?.name ?? 'default',
        isActive: (defaultSnap.data() as any)?.isActive ?? true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  // Order by documentId to avoid missing-field issues.
  let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
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
    const isActive = typeof (v as any).isActive === 'boolean' ? (v as any).isActive : true;
    return {
      id: d.id,
      name: (v as any).name,
      isActive,
      createdAt: (v as any).createdAt,
      updatedAt: (v as any).updatedAt,
    };
  });

  const filtered = includeInactive ? rows : rows.filter((r) => r.isActive !== false);
  const nextCursorOut = docs.length > limit ? docs[limit].id : null;

  return { organizations: filtered, nextCursor: nextCursorOut };
});

export const rootUpsertUserToOrganization = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const email = String((data as any)?.email ?? '').trim().toLowerCase();
  const orgId = String((data as any)?.organizationId ?? '').trim();
  const role = String((data as any)?.role ?? '').trim();

  if (!email) throw new functions.https.HttpsError('invalid-argument', 'Email requerido.');
  if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
  if (!role) throw new functions.https.HttpsError('invalid-argument', 'role requerido.');

  const auth = admin.auth();
  const user = await auth.getUserByEmail(email);

  const db = admin.firestore();
  const uid = user.uid;

  // Ensure org doc exists
  const orgRef = db.collection('organizations').doc(orgId);
  await orgRef.set(
    {
      organizationId: orgId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Update /users/{uid}
  const userRef = db.collection('users').doc(uid);
  await userRef.set(
    {
      email,
      organizationId: orgId,
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // memberships
  const msRef = db.collection('memberships').doc(`${uid}_${orgId}`);
  await msRef.set(
    {
      userId: uid,
      organizationId: orgId,
      role,
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'root_upsert_user_to_org',
    },
    { merge: true }
  );

  // org members subcollection
  const memberRef = orgRef.collection('members').doc(uid);
  await memberRef.set(
    {
      uid,
      orgId,
      email,
      displayName: user.displayName ?? null,
      active: true,
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'root_upsert_user_to_org',
    },
    { merge: true }
  );

  return { ok: true, uid, organizationId: orgId, role };
});

export const rootSetUserRootClaim = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const email = String((data as any)?.email ?? '').trim();
  const uidIn = String((data as any)?.uid ?? '').trim();
  const root = Boolean((data as any)?.root);
  const detach = Boolean((data as any)?.detach ?? true);

  if (!email && !uidIn) {
    throw new functions.https.HttpsError('invalid-argument', 'Falta email o uid.');
  }

  const auth = admin.auth();
  const userRecord = uidIn ? await auth.getUser(uidIn) : await auth.getUserByEmail(email);
  const uid = userRecord.uid;

  const currentClaims = (userRecord.customClaims ?? {}) as Record<string, unknown>;
  const nextClaims: Record<string, unknown> = { ...currentClaims, root };
  if (!root) delete (nextClaims as any).root;

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

    if (firestoreOps > 0) await batch.commit();
  }

  return { ok: true, uid, email: userRecord.email, root, detached: detach, firestoreOps };
});

export const rootOrgSummary = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const orgId = String((data as any)?.organizationId ?? '').trim();
  if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');

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

type RootUsersCursor = { email: string; uid: string };

export const rootListUsersByOrg = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const orgId = String((data as any)?.organizationId ?? '').trim();
  if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');

  const limit = clampInt((data as any)?.limit, 1, 200, 25);
  const searchEmail = String((data as any)?.searchEmail ?? '').trim().toLowerCase();
  const cursor = (data as any)?.cursor as RootUsersCursor | undefined;

  const db = admin.firestore();

  let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
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

  if (cursor?.email && cursor?.uid) {
    q = q.startAfter(cursor.email.toLowerCase(), cursor.uid);
  }

  const snap = await q.get();
  const docs = snap.docs;

  const users = docs.slice(0, limit).map((d) => {
    const v = d.data() || {};
    return {
      uid: d.id,
      email: (v as any).email ?? null,
      displayName: (v as any).displayName ?? null,
      active: (v as any).active ?? true,
      role: (v as any).role ?? 'operator',
      departmentId: (v as any).departmentId ?? null,
    };
  });

  const nextCursor =
    docs.length > limit
      ? ({ email: String((docs[limit].data() as any)?.email ?? ''), uid: docs[limit].id } as RootUsersCursor)
      : null;

  return { ok: true, organizationId: orgId, users, nextCursor };
});

export const rootDeactivateOrganization = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const orgId = String((data as any)?.organizationId ?? '').trim();
  if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');

  const isActive = Boolean((data as any)?.isActive ?? false);

  const db = admin.firestore();
  await db.collection('organizations').doc(orgId).set(
    { isActive, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return { ok: true, organizationId: orgId, isActive };
});

export const rootDeleteOrganizationScaffold = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const orgId = String((data as any)?.organizationId ?? '').trim();
  const confirm = String((data as any)?.confirm ?? '').trim();
  if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
  if (confirm !== orgId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Confirmación inválida. Debes escribir exactamente el organizationId.'
    );
  }

  const hardDelete = Boolean((data as any)?.hardDelete ?? false);

  const db = admin.firestore();
  const ref = db.collection('organizations').doc(orgId);

  await ref.set(
    {
      isActive: false,
      isDeleted: true,
      deletedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (hardDelete) {
    await ref.delete(); // NO borra subcolecciones
  }

  return { ok: true, organizationId: orgId, hardDelete };
});

type PurgeCollectionName = 'tickets' | 'tasks' | 'sites' | 'assets' | 'departments' | 'memberships' | 'members';

export const rootPurgeOrganizationCollection = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const orgId = String((data as any)?.organizationId ?? '').trim();
  const collection = String((data as any)?.collection ?? '').trim() as PurgeCollectionName;
  const confirm = String((data as any)?.confirm ?? '').trim();

  if (!orgId) throw new functions.https.HttpsError('invalid-argument', 'organizationId requerido.');
  if (!collection) throw new functions.https.HttpsError('invalid-argument', 'collection requerido.');
  if (confirm !== orgId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Confirmación inválida. Debes escribir exactamente el organizationId.'
    );
  }

  const allowed: PurgeCollectionName[] = ['tickets', 'tasks', 'sites', 'assets', 'departments', 'memberships', 'members'];
  if (!allowed.includes(collection)) {
    throw new functions.https.HttpsError('invalid-argument', `collection no permitido: ${collection}`);
  }

  const batchSize = clampInt((data as any)?.batchSize, 50, 500, 250);
  const maxDocs = clampInt((data as any)?.maxDocs, 1, 5000, 1500);

  const db = admin.firestore();
  let deleted = 0;

  const deleteBatch = async (docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]) => {
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
