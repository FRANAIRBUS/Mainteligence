import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import type { Request, Response } from 'express';
import { defineString } from 'firebase-functions/params';
import { randomBytes } from 'crypto';
import { sendAssignmentEmail } from './assignment-email';
import { sendInviteEmail } from './invite-email';
import { sendSignupConfirmationEmail } from './signup-confirmation-email';

admin.initializeApp();
const db = admin.firestore();
const SIGNUP_CONFIRMATION_BASE_URL = defineString('SIGNUP_CONFIRMATION_BASE_URL');

type Role =
  | 'super_admin'
  | 'admin'
  | 'maintenance'
  | 'dept_head_multi'
  | 'dept_head_single'
  | 'operator';

function httpsError(code: functions.https.FunctionsErrorCode, message: string) {
  return new functions.https.HttpsError(code, message);
}

const ALLOWED_CORS_ORIGINS = new Set([
  'https://multi.maintelligence.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function applyCors(req: Request, res: Response): boolean {
  const origin = String(req.headers.origin ?? '');
  if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
  } else {
    res.set('Access-Control-Allow-Origin', 'https://multi.maintelligence.app');
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const requestedHeaders = req.headers['access-control-request-headers'];
  res.set(
    'Access-Control-Allow-Headers',
    typeof requestedHeaders === 'string' && requestedHeaders.trim()
      ? requestedHeaders
      : 'Content-Type, Authorization'
  );
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }

  return false;
}

async function requireAuthFromRequest(req: Request) {
  const authHeader = String(req.headers.authorization ?? '');
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) throw httpsError('unauthenticated', 'Debes iniciar sesión.');
  return admin.auth().verifyIdToken(match[1]);
}

async function updateOrganizationUserProfile({
  actorUid,
  actorEmail,
  isRoot,
  orgId,
  targetUid,
  displayName,
  email,
  departmentId,
}: {
  actorUid: string;
  actorEmail: string | null;
  isRoot: boolean;
  orgId: string;
  targetUid: string;
  displayName: string;
  email: string;
  departmentId: string;
}) {
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!targetUid) throw httpsError('invalid-argument', 'uid requerido.');

  if (!isRoot) {
    await requireCallerSuperAdminInOrg(actorUid, orgId);
  }

  const userRef = db.collection('users').doc(targetUid);
  const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const normalizedEmail = String(email ?? '').trim();

  // ---
  // Backward-compat / safety:
  // In some historical datasets there are member docs under organizations/{orgId}/members
  // but the corresponding memberships/{uid}_{orgId} doc does not exist yet.
  // The admin UI should still be able to edit a member profile, so we:
  //   1) Validate the target is a member of the org (membership OR member doc exists)
  //   2) Enforce "active" status
  //   3) If membership doc is missing but the member doc exists, we create the membership
  //      doc (backfill) and continue.
  // ---
  const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
  const membershipSnap = await membershipRef.get();

  if (!membershipSnap.exists) {
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw httpsError(
        'failed-precondition',
        'El usuario objetivo no tiene membresía en esa organización (ni registro de miembro).'
      );
    }

    const member = memberSnap.data() as any;
    const rawStatus = String(member?.status ?? '').trim().toLowerCase();
    const status = rawStatus || (typeof member?.active === 'boolean' ? (member.active ? 'active' : 'pending') : 'active');
    if (status !== 'active') {
      throw httpsError('failed-precondition', 'El usuario objetivo no tiene membresía activa en esa organización.');
    }

    // Backfill membership doc so future RBAC checks are consistent.
    await membershipRef.set(
      {
        organizationId: orgId,
        uid: targetUid,
        role: normalizeRole(member?.role),
        status: 'active',
        email: member?.email ?? normalizedEmail ?? null,
        displayName: member?.displayName ?? null,
        departmentId: member?.departmentId ?? null,
        createdAt: member?.createdAt ?? now,
        updatedAt: now,
        source: 'orgUpdateUserProfile_backfill_membership_v1',
      },
      { merge: true }
    );
  } else {
    const membership = membershipSnap.data() as any;
    const rawStatus = String(membership?.status ?? '').trim().toLowerCase();
    const membershipStatus =
      rawStatus || (typeof membership?.active === 'boolean' ? (membership.active ? 'active' : 'inactive') : '');
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
  }

  const userSnap = await userRef.get();
  const currentEmail = String(userSnap.data()?.email ?? '').trim();

  if (normalizedEmail && normalizedEmail !== currentEmail) {
    try {
      await admin.auth().updateUser(targetUid, { email: normalizedEmail });
    } catch (err: any) {
      const code = String(err?.code ?? '');
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

function sendHttpError(res: Response, err: any) {
  const code = String(err?.code ?? 'internal');
  const message = String(err?.message ?? 'Error inesperado.');
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

function requireAuth(context: functions.https.CallableContext) {
  if (!context.auth?.uid) throw httpsError('unauthenticated', 'Debes iniciar sesión.');
  return context.auth.uid;
}

function isRootClaim(context: functions.https.CallableContext): boolean {
  return Boolean((context.auth?.token as any)?.root === true);
}

function normalizeRoleOrNull(input: any): Role | null {
  const r = String(input ?? '').trim().toLowerCase();
  if (!r) return null;

  if (r === 'super_admin' || r === 'superadmin') return 'super_admin';
  if (r === 'admin' || r === 'administrator') return 'admin';

  if (r === 'maintenance' || r === 'mantenimiento' || r === 'maint' || r === 'maintainer') return 'maintenance';

  if (
    r === 'dept_head_multi' ||
    r === 'deptheadmulti' ||
    r === 'dept-head-multi' ||
    r === 'dept head multi' ||
    r === 'department_head_multi' ||
    r === 'departmentheadmulti' ||
    r === 'jefe_departamento_multi' ||
    r === 'jefe de departamento multi'
  ) {
    return 'dept_head_multi';
  }

  if (
    r === 'dept_head_single' ||
    r === 'deptheadsingle' ||
    r === 'dept-head-single' ||
    r === 'dept head single' ||
    r === 'dept_head' ||
    r === 'depthead' ||
    r === 'department_head_single' ||
    r === 'departmentheadsingle' ||
    r === 'jefe_departamento' ||
    r === 'jefe de departamento'
  ) {
    return 'dept_head_single';
  }

  if (r === 'operator' || r === 'operario' || r === 'op') return 'operator';

  return null;
}

function normalizeRole(input: any): Role {
  return normalizeRoleOrNull(input) ?? 'operator';
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

function isPlainObject(value: any): value is Record<string, any> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    // Firestore rejects undefined inside arrays; remove undefined elements.
    return value
      .map((v) => stripUndefinedDeep(v))
      .filter((v) => v !== undefined) as any;
  }

  if (isPlainObject(value)) {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const vv = stripUndefinedDeep(v as any);
      if (vv === undefined) continue;
      out[k] = vv;
    }
    return out;
  }

  // Preserve Firestore sentinel objects (Timestamp, FieldValue, GeoPoint, etc.)
  return value;
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
  const payload = stripUndefinedDeep({
    ...params,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('auditLogs').add(payload);
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

    if (!before.assignedTo || !after.assignedTo || before.assignedTo === after.assignedTo) return;
    if (after.assignmentEmailSource === 'client') return;

    try {
      await sendAssignmentEmail({
        organizationId: after.organizationId ?? null,
        assignedTo: after.assignedTo ?? null,
        departmentId: after.departmentId ?? null,
        title: after.title ?? '(sin título)',
        link: `https://multi.maintelligence.app/incidents/${context.params.ticketId}`,
        type: 'incidencia',
        identifier: after.displayId ?? context.params.ticketId,
        description: after.description ?? '',
        priority: after.priority ?? '',
        status: after.status ?? '',
        location: after.departmentId ?? null,
      });
    } catch (error) {
      console.error('[onTicketAssign] Error enviando email de asignación', error);
    }
  });

export const onTaskAssign = functions.firestore
  .document('tasks/{taskId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;

    if (!before.assignedTo || !after.assignedTo || before.assignedTo === after.assignedTo) return;
    if (after.assignmentEmailSource === 'client') return;

    try {
      await sendAssignmentEmail({
        organizationId: after.organizationId ?? null,
        assignedTo: after.assignedTo ?? null,
        departmentId: after.location ?? null,
        title: after.title ?? '(sin título)',
        link: `https://multi.maintelligence.app/tasks/${context.params.taskId}`,
        type: 'tarea',
        identifier: context.params.taskId,
        description: after.description ?? '',
        priority: after.priority ?? '',
        status: after.status ?? '',
        dueDate: after.dueDate ?? null,
        location: after.location ?? null,
        category: after.category ?? null,
      });
    } catch (error) {
      console.error('[onTaskAssign] Error enviando email de asignación', error);
    }
  });

export const onTicketCreate = functions.firestore
  .document('tickets/{ticketId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() as any;
    if (!data?.assignedTo) return;
    if (data.assignmentEmailSource === 'client') return;

    try {
      await sendAssignmentEmail({
        organizationId: data.organizationId ?? null,
        assignedTo: data.assignedTo ?? null,
        departmentId: data.departmentId ?? null,
        title: data.title ?? '(sin título)',
        link: `https://multi.maintelligence.app/incidents/${context.params.ticketId}`,
        type: 'incidencia',
        identifier: data.displayId ?? context.params.ticketId,
        description: data.description ?? '',
        priority: data.priority ?? '',
        status: data.status ?? '',
        location: data.departmentId ?? null,
      });
    } catch (error) {
      console.error('[onTicketCreate] Error enviando email de asignación', error);
    }
  });

export const onTaskCreate = functions.firestore
  .document('tasks/{taskId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() as any;
    if (!data?.assignedTo) return;
    if (data.assignmentEmailSource === 'client') return;

    try {
      await sendAssignmentEmail({
        organizationId: data.organizationId ?? null,
        assignedTo: data.assignedTo ?? null,
        departmentId: data.location ?? null,
        title: data.title ?? '(sin título)',
        link: `https://multi.maintelligence.app/tasks/${context.params.taskId}`,
        type: 'tarea',
        identifier: context.params.taskId,
        description: data.description ?? '',
        priority: data.priority ?? '',
        status: data.status ?? '',
        dueDate: data.dueDate ?? null,
        location: data.location ?? null,
        category: data.category ?? null,
      });
    } catch (error) {
      console.error('[onTaskCreate] Error enviando email de asignación', error);
    }
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
  const mRef = db.collection('memberships').doc(`${actorUid}_${orgId}`);
  let mSnap = await mRef.get();

  // Backward-compat:
  // Some historical datasets only have organizations/{orgId}/members/{uid} and NOT memberships/{uid}_{orgId}.
  // The admin UI must still work. If the membership doc is missing, we fall back to member doc and backfill.
  if (!mSnap.exists) {
    const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(actorUid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) throw httpsError('permission-denied', 'No perteneces a esa organización.');

    const roleFromMember = normalizeRole(memberSnap.get('role'));
    const statusFromMember =
      String(memberSnap.get('status') ?? '') ||
      (memberSnap.get('active') === true ? 'active' : 'pending');

    if (statusFromMember !== 'active') throw httpsError('permission-denied', 'Tu membresía no está activa.');

    // Backfill minimal membership doc so future checks are consistent.
    await mRef.set(
      {
        userId: actorUid,
        organizationId: orgId,
        role: roleFromMember ?? 'operator',
        status: 'active',
        primary: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'backfill_membership_from_member_v1',
      },
      { merge: true },
    );

    mSnap = await mRef.get();
  }

  // Backward-compat: some older docs used `active: true` instead of `status: 'active'`.
  const status =
    String(mSnap.get('status') ?? '') ||
    (mSnap.get('active') === true ? 'active' : 'pending');

  const role = normalizeRole(mSnap.get('role'));
  if (status != 'active') throw httpsError('permission-denied', 'Tu membresía no está activa.');
  if (role != 'super_admin') throw httpsError('permission-denied', 'Solo super_admin puede gestionar usuarios.');
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

  
// Target must have a membership in this org
const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
const membershipSnap = await membershipRef.get();
if (!membershipSnap.exists) {
  throw httpsError(
    'failed-precondition',
    'El usuario objetivo no tiene membresía en esa organización. Debe registrarse y solicitar acceso primero.',
  );
}

const beforeRole = String(membershipSnap.get('role') ?? 'operator');
const beforeStatus =
  String(membershipSnap.get('status') ?? '') ||
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
const userBefore = userSnap.exists ? (userSnap.data() as any) : null;

const batch = db.batch();

  batch.set(
    userRef,
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
    targetEmail: String(userBefore?.email ?? null),
    before: { role: beforeRole },
    after: { role },
  });

  return { ok: true, uid: targetUid, organizationId: orgId, role };
}

/* ------------------------------
   ONBOARDING / JOIN REQUESTS
--------------------------------- */

function sanitizeOrganizationId(input: string): string {
  const raw = String(input ?? '').trim().toLowerCase();
  // allow a-z0-9, dash, underscore. Convert spaces to dashes, drop others.
  const spaced = raw.replace(/\s+/g, '-');
  const cleaned = spaced.replace(/[^a-z0-9_-]/g, '');
  return cleaned;
}

function resolveSignupConfirmationLink(token: string) {
  const configuredBase = SIGNUP_CONFIRMATION_BASE_URL.value();
  if (configuredBase) {
    const base = configuredBase.replace(/\/+$/, '');
    return `${base}/confirm-organization?token=${token}`;
  }

  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (projectId) {
    return `https://us-central1-${projectId}.cloudfunctions.net/confirmOrganizationSignup?token=${token}`;
  }

  return `https://multi.maintelligence.app/login?signupToken=${token}`;
}

async function buildOrganizationSuggestions(rawInput: string, maxSuggestions = 5) {
  const base = sanitizeOrganizationId(rawInput);
  if (!base) {
    throw httpsError('invalid-argument', 'organizationId o nombre requerido.');
  }

  const candidates = [base, ...Array.from({ length: maxSuggestions * 2 }, (_, i) => `${base}-${i + 2}`)];
  const uniqueCandidates = Array.from(new Set(candidates)).slice(0, maxSuggestions * 2);
  const snapshots = await Promise.all(
    uniqueCandidates.map((candidate) => db.collection('organizationsPublic').doc(candidate).get())
  );

  const available = uniqueCandidates.filter((candidate, index) => !snapshots[index].exists);
  const suggestions = available.slice(0, maxSuggestions);
  const baseIndex = uniqueCandidates.indexOf(base);
  const baseSnapshot = baseIndex >= 0 ? snapshots[baseIndex] : null;
  const existingName = baseSnapshot?.exists ? String(baseSnapshot.data()?.name ?? '') || base : null;

  return {
    normalizedId: base,
    available: suggestions.includes(base),
    suggestions,
    existingName,
  };
}

export const checkOrganizationAvailability = functions.https.onCall(async (data) => {
  const rawInput = String(data?.organizationId ?? data?.name ?? '').trim();
  if (!rawInput) throw httpsError('invalid-argument', 'organizationId o nombre requerido.');

  return buildOrganizationSuggestions(rawInput);
});

export const bootstrapSignup = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);

  const signupMode =
    data?.signupMode === 'create' || data?.signupMode === 'join'
      ? data.signupMode
      : null;

  const orgIdIn = String(data?.organizationId ?? data?.organizationDetails?.name ?? '');
  const organizationId = sanitizeOrganizationId(orgIdIn);
  if (!organizationId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const requestedRoleRaw = data?.requestedRole;
  const requestedRole = requestedRoleRaw ? normalizeRoleOrNull(requestedRoleRaw) : 'operator';
  if (!requestedRole) throw httpsError('invalid-argument', 'requestedRole inválido.');

  const authUser = await admin.auth().getUser(uid).catch(() => null);
  const email = (authUser?.email ?? String(data?.email ?? '')).trim().toLowerCase();
  const displayName = (authUser?.displayName ?? String(data?.displayName ?? '').trim()) || null;

  const orgRef = db.collection('organizations').doc(organizationId);
  const orgPublicRef = db.collection('organizationsPublic').doc(organizationId);
  const [orgSnap, orgPublicSnap] = await Promise.all([orgRef.get(), orgPublicRef.get()]);

  const userRef = db.collection('users').doc(uid);
  const memberRef = orgRef.collection('members').doc(uid);
  const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);

  const now = admin.firestore.FieldValue.serverTimestamp();

  if (signupMode === 'create' && (orgSnap.exists || orgPublicSnap.exists)) {
    throw httpsError('failed-precondition', 'Ese ID ya existe.');
  }

  if (!orgSnap.exists && !orgPublicSnap.exists && signupMode !== 'join') {
    const details = (data?.organizationDetails ?? {}) as any;

    const orgName = String(details?.name ?? '').trim() || organizationId;
    const confirmationToken = randomBytes(32).toString('hex');
    const requestRef = db.collection('organizationSignupRequests').doc(confirmationToken);
    const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 3));

    await requestRef.set(
      {
        organizationId,
        organizationName: orgName,
        organizationDetails: {
          name: orgName,
          taxId: String(details?.taxId ?? '').trim() || null,
          country: String(details?.country ?? '').trim() || null,
          address: String(details?.address ?? '').trim() || null,
          billingEmail: String(details?.billingEmail ?? '').trim() || email || null,
          phone: String(details?.phone ?? '').trim() || null,
          teamSize: Number.isFinite(Number(details?.teamSize)) ? Number(details?.teamSize) : null,
        },
        requestedRole: 'super_admin',
        uid,
        email: email || null,
        displayName: displayName || email || 'Usuario',
        status: 'pending',
        confirmationToken,
        expiresAt,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_pre_registration_v1',
      },
      { merge: true }
    );

    const confirmationLink = resolveSignupConfirmationLink(confirmationToken);

    try {
      if (email) {
        await sendSignupConfirmationEmail({
          recipientEmail: email,
          orgName,
          confirmationLink,
        });
      }
    } catch (error) {
      console.warn('Error enviando email de confirmación de organización.', error);
    }

    await auditLog({
      action: 'bootstrapSignup_pre_registration',
      actorUid: uid,
      actorEmail: email || null,
      orgId: organizationId,
      after: { organizationId, role: 'super_admin', status: 'pending' },
    });

    return { ok: true, mode: 'verification_required', organizationId };
  }

  if (!orgSnap.exists) {
    throw httpsError('not-found', 'La organización no existe.');
  }

  const orgData = orgSnap.data() as any;
  const orgName = String(orgData?.name ?? organizationId);

  const joinReqRef = orgRef.collection('joinRequests').doc(uid);

  const batch = db.batch();

  batch.set(
    userRef,
    {
      organizationId,
      email: email || null,
      displayName: displayName || email || 'Usuario',
      role: requestedRole,
      active: true,
      updatedAt: now,
      createdAt: now,
      source: 'bootstrapSignup_v1',
    },
    { merge: true },
  );

  batch.set(
    membershipRef,
    {
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
    },
    { merge: true },
  );

  batch.set(
    joinReqRef,
    {
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
    },
    { merge: true },
  );

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

export const confirmOrganizationSignup = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const token = String(req.query?.token ?? req.body?.token ?? '').trim();
  if (!token) {
    res.status(400).send('Token de confirmación requerido.');
    return;
  }

  try {
    const requestRef = db.collection('organizationSignupRequests').doc(token);
    const requestSnap = await requestRef.get();

    if (!requestSnap.exists) {
      res.status(404).send('Solicitud no encontrada.');
      return;
    }

    const request = requestSnap.data() as any;
    if (request.status === 'confirmed') {
      res.status(200).send('La organización ya fue confirmada. Puedes iniciar sesión.');
      return;
    }

    const expiresAt = request.expiresAt?.toDate?.();
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      res.status(410).send('El enlace de confirmación ha expirado. Inicia un nuevo registro.');
      return;
    }

    const organizationId = sanitizeOrganizationId(String(request.organizationId ?? ''));
    if (!organizationId) {
      res.status(400).send('Solicitud inválida.');
      return;
    }

    const orgRef = db.collection('organizations').doc(organizationId);
    const orgPublicRef = db.collection('organizationsPublic').doc(organizationId);
    const [orgSnap, orgPublicSnap] = await Promise.all([orgRef.get(), orgPublicRef.get()]);

    if (orgSnap.exists || orgPublicSnap.exists) {
      res.status(409).send('Ese ID de organización ya está en uso.');
      return;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const orgName = String(request.organizationName ?? organizationId);
    const details = (request.organizationDetails ?? {}) as any;
    const uid = String(request.uid ?? '');
    const email = String(request.email ?? '').trim().toLowerCase();
    const displayName = String(request.displayName ?? '').trim() || email || 'Usuario';

    const userRef = db.collection('users').doc(uid);
    const memberRef = orgRef.collection('members').doc(uid);
    const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);

    const batch = db.batch();

    batch.set(
      orgRef,
      {
        organizationId,
        name: orgName,
        taxId: String(details?.taxId ?? '').trim() || null,
        country: String(details?.country ?? '').trim() || null,
        address: String(details?.address ?? '').trim() || null,
        billingEmail: String(details?.billingEmail ?? '').trim() || email || null,
        contactPhone: String(details?.phone ?? '').trim() || null,
        teamSize: Number.isFinite(Number(details?.teamSize)) ? Number(details?.teamSize) : null,
        subscriptionPlan: 'trial',
        isActive: true,
        settings: {
          allowGuestAccess: false,
          maxUsers: 50,
        },
        createdAt: now,
        updatedAt: now,
        source: 'confirmOrganizationSignup_v1',
      },
      { merge: true }
    );

    batch.set(
      orgPublicRef,
      {
        organizationId,
        name: orgName,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        source: 'confirmOrganizationSignup_v1',
      },
      { merge: true }
    );

    batch.set(
      userRef,
      {
        organizationId,
        email: email || null,
        displayName,
        role: 'super_admin',
        active: true,
        updatedAt: now,
        createdAt: now,
        source: 'confirmOrganizationSignup_v1',
      },
      { merge: true }
    );

    batch.set(
      membershipRef,
      {
        userId: uid,
        organizationId,
        organizationName: orgName,
        role: 'super_admin',
        status: 'active',
        primary: true,
        createdAt: now,
        updatedAt: now,
        source: 'confirmOrganizationSignup_v1',
      },
      { merge: true }
    );

    batch.set(
      memberRef,
      {
        uid,
        orgId: organizationId,
        email: email || null,
        displayName,
        role: 'super_admin',
        active: true,
        createdAt: now,
        updatedAt: now,
        source: 'confirmOrganizationSignup_v1',
      },
      { merge: true }
    );

    batch.set(
      requestRef,
      {
        status: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
        source: 'confirmOrganizationSignup_v1',
      },
      { merge: true }
    );

    await batch.commit();

    await auditLog({
      action: 'confirmOrganizationSignup_create_org',
      actorUid: uid || null,
      actorEmail: email || null,
      orgId: organizationId,
      after: { organizationId, role: 'super_admin', status: 'active' },
    });

    res
      .status(200)
      .send(
        'Organización confirmada correctamente. Ya puedes iniciar sesión en Maintelligence.'
      );
  } catch (err: any) {
    console.error('confirmOrganizationSignup failed', err);
    res.status(500).send('No se pudo confirmar la organización.');
  }
});



export const bootstrapFromInvites = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);

  const authUser = await admin.auth().getUser(uid).catch(() => null);
  const email = (authUser?.email ?? String(data?.email ?? '')).trim().toLowerCase();
  const displayName = (authUser?.displayName ?? String(data?.displayName ?? '').trim()) || null;

  // Always ensure at least a minimal user profile exists.
  const userRef = db.collection('users').doc(uid);
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (!email) {
    await userRef.set(
      {
        displayName,
        updatedAt: now,
        source: 'bootstrapFromInvites_v1',
      },
      { merge: true }
    );
    return { ok: true, claimed: 0, organizations: [] };
  }

  // Look for pending joinRequests created by orgInviteUser (docId: invite_<email>) across all orgs.
  // We only filter by email in Firestore to avoid requiring composite indexes; status is filtered in-memory.
  const cg = db.collectionGroup('joinRequests').where('email', '==', email).limit(20);
  const snap = await cg.get();

  const pending = snap.docs.filter((d) => String(d.get('status') ?? 'pending') === 'pending');

  if (pending.length === 0) {
    await userRef.set(
      {
        email,
        displayName,
        updatedAt: now,
        source: 'bootstrapFromInvites_v1',
      },
      { merge: true }
    );
    return { ok: true, claimed: 0, organizations: [] };
  }

  const batch = db.batch();
  const orgIds: string[] = [];

  for (const jrSnap of pending) {
    // jrSnap.ref is organizations/{orgId}/joinRequests/{requestId}
    const orgRef = jrSnap.ref.parent.parent;
    const orgId = sanitizeOrganizationId(String(jrSnap.get('organizationId') ?? orgRef?.id ?? ''));

    if (!orgId) continue;
    orgIds.push(orgId);

    const orgName = String(jrSnap.get('organizationName') ?? orgId);
    const requestedRole: Role = normalizeRole(jrSnap.get('requestedRole')) ?? normalizeRole(jrSnap.get('role')) ?? 'operator';
    const departmentId = String(jrSnap.get('departmentId') ?? '').trim() || null;
    const inviteId = jrSnap.id;

    const joinReqRef = db.collection('organizations').doc(orgId).collection('joinRequests').doc(uid);
    batch.set(
      joinReqRef,
      stripUndefinedDeep({
        userId: uid,
        organizationId: orgId,
        organizationName: orgName,
        email,
        displayName: String(jrSnap.get('displayName') ?? displayName ?? email),
        requestedRole,
        status: 'pending',
        departmentId,
        invitedBy: jrSnap.get('invitedBy') ?? null,
        invitedByEmail: jrSnap.get('invitedByEmail') ?? null,
        invitedAt: jrSnap.get('invitedAt') ?? null,
        createdAt: jrSnap.get('createdAt') ?? now,
        updatedAt: now,
        source: 'bootstrapFromInvites_v1',
      }),
      { merge: true }
    );

    // Migrate legacy invite doc (invite_<email>) to docId == uid for consistent approval flows.
    if (inviteId !== uid) {
      batch.delete(jrSnap.ref);
    }

    // Create/merge a pending membership so the user sees the organization in the UI immediately.
    const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);
    batch.set(
      membershipRef,
      stripUndefinedDeep({
        userId: uid,
        organizationId: orgId,
        organizationName: orgName,
        role: requestedRole,
        status: 'pending',
        departmentId,
        primary: false,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapFromInvites_v1',
      }),
      { merge: true }
    );
  }

  const uniqueOrgIds = Array.from(new Set(orgIds)).filter(Boolean);

  // If there is exactly one pending org, set it as the default active org in the user profile.
  const userPatch: any = {
    email,
    displayName,
    updatedAt: now,
    source: 'bootstrapFromInvites_v1',
  };
  if (uniqueOrgIds.length === 1) {
    userPatch.organizationId = uniqueOrgIds[0];
  }

  batch.set(userRef, stripUndefinedDeep(userPatch), { merge: true });

  await batch.commit();

  await auditLog({
    action: 'bootstrapFromInvites',
    actorUid: uid,
    actorEmail: email,
    orgId: uniqueOrgIds.length === 1 ? uniqueOrgIds[0] : null,
    meta: { claimed: uniqueOrgIds.length, organizations: uniqueOrgIds },
  });

  return { ok: true, claimed: uniqueOrgIds.length, organizations: uniqueOrgIds };
});


export const setActiveOrganization = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);
  const mSnap = await membershipRef.get();
  if (!mSnap.exists) throw httpsError('permission-denied', 'No perteneces a esa organización.');

  const status =
    String(mSnap.get('status') ?? '') ||
    (mSnap.get('active') === true ? 'active' : 'pending');
  if (status !== 'active') throw httpsError('failed-precondition', 'La membresía no está activa.');

  await db.collection('users').doc(uid).set(
    {
      organizationId: orgId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'setActiveOrganization_v1',
    },
    { merge: true },
  );

  return { ok: true, organizationId: orgId };
});

export const orgInviteUser = functions.https.onRequest(async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const decoded = await requireAuthFromRequest(req);
    const actorUid = decoded.uid;
    const actorEmail = (decoded.email ?? null) as string | null;

    const orgId = sanitizeOrganizationId(String(req.body?.organizationId ?? ''));
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const displayName = String(req.body?.displayName ?? '').trim();
    const requestedRole: Role = normalizeRole(req.body?.role) ?? 'operator';
    const departmentId = String(req.body?.departmentId ?? '').trim();

    if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!email) throw httpsError('invalid-argument', 'email requerido.');

    await requireCallerSuperAdminInOrg(actorUid, orgId);

    const orgRef = db.collection('organizations').doc(orgId);
    const orgSnap = await orgRef.get();
    const orgName = String((orgSnap.data() as any)?.name ?? orgId);

    let targetUid = '';
    try {
      const authUser = await admin.auth().getUserByEmail(email);
      targetUid = authUser.uid;
    } catch {
      targetUid = '';
    }

    if (targetUid) {
      const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
      const membershipSnap = await membershipRef.get();
      if (membershipSnap.exists) {
        const status =
          String(membershipSnap.get('status') ?? '') ||
          (membershipSnap.get('active') === true ? 'active' : 'pending');
        if (status === 'active') {
          throw httpsError('failed-precondition', 'El usuario ya pertenece a la organización.');
        }
      }
    }

    const inviteId = targetUid || `invite_${email}`;
    const joinReqRef = orgRef.collection('joinRequests').doc(inviteId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await joinReqRef.set(
      {
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
      },
      { merge: true }
    );

    try {
      await sendInviteEmail({
        recipientEmail: email,
        orgName,
        role: requestedRole,
        inviteLink: 'https://multi.maintelligence.app/login',
      });
    } catch (error) {
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
  } catch (err) {
    sendHttpError(res, err);
  }
});

export const orgUpdateUserProfile = functions.https.onRequest(async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const decoded = await requireAuthFromRequest(req);
    const actorUid = decoded.uid;
    const actorEmail = (decoded.email ?? null) as string | null;
    const isRoot = Boolean((decoded as any)?.root === true || (decoded as any)?.role === 'root');

    const orgId = sanitizeOrganizationId(String(req.body?.organizationId ?? ''));
    const targetUid = String(req.body?.uid ?? '').trim();
    const displayName = String(req.body?.displayName ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const departmentId = String(req.body?.departmentId ?? '').trim();

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
  } catch (err) {
    sendHttpError(res, err);
  }
});

export const orgUpdateUserProfileCallable = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const isRoot = isRootClaim(context);

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  const targetUid = String(data?.uid ?? '').trim();
  const displayName = String(data?.displayName ?? '').trim();
  const email = String(data?.email ?? '').trim().toLowerCase();
  const departmentId = String(data?.departmentId ?? '').trim();

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

export const orgRemoveUserFromOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const isRoot = isRootClaim(context);

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  const targetUid = String(data?.uid ?? '').trim();

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!targetUid) throw httpsError('invalid-argument', 'uid requerido.');

  if (!isRoot) {
    await requireCallerSuperAdminInOrg(actorUid, orgId);
  }

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
  if (memberSnap.exists) batch.delete(memberRef);
  if (membershipSnap.exists) batch.delete(membershipRef);

  const userOrgId = String(userSnap.data()?.organizationId ?? '');
  if (userSnap.exists && userOrgId === orgId) {
    batch.set(
      userRef,
      {
        organizationId: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'orgRemoveUserFromOrg_v1',
      },
      { merge: true },
    );
  }

  await batch.commit();

  try {
  await auditLog({
    action: 'orgRemoveUserFromOrg',
    actorUid,
    actorEmail,
    orgId,
    targetUid,
    targetEmail: String(userSnap.data()?.email ?? null),
    after: { removed: true },
  });
} catch (err) {
  console.error('[orgRemoveUserFromOrg] auditLog failed', err);
}

return { ok: true, organizationId: orgId, uid: targetUid };
});

export const orgApproveJoinRequest = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  const requestId = String(data?.uid ?? data?.requestId ?? '').trim();
  const role: Role = normalizeRole(data?.role) ?? 'operator';

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!requestId) throw httpsError('invalid-argument', 'uid requerido.');

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  const orgRef = db.collection('organizations').doc(orgId);
  const joinReqRef = orgRef.collection('joinRequests').doc(requestId);
  const joinReqSnap = await joinReqRef.get();

  if (!joinReqSnap.exists) throw httpsError('not-found', 'No existe la solicitud.');
  const jr = joinReqSnap.data() as any;
  if (String(jr?.status ?? '') !== 'pending') {
    throw httpsError('failed-precondition', 'La solicitud no está pendiente.');
  }

  let targetUid = String(jr?.userId ?? '').trim();
  if (!targetUid && jr?.email) {
    try {
      targetUid = await resolveTargetUidByEmailOrUid(jr.email);
    } catch (err: any) {
      throw httpsError('failed-precondition', 'El usuario invitado aún no está registrado.');
    }
  }

  if (!targetUid) throw httpsError('failed-precondition', 'No se pudo resolver el usuario objetivo.');

  const orgSnap = await orgRef.get();
  const orgName = String((orgSnap.data() as any)?.name ?? orgId);

  const userRef = db.collection('users').doc(targetUid);
  const memberRef = orgRef.collection('members').doc(targetUid);
  const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);

  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();

  batch.set(
    joinReqRef,
    {
      status: 'approved',
      approvedAt: now,
      approvedBy: actorUid,
      updatedAt: now,
      source: 'orgApproveJoinRequest_v1',
    },
    { merge: true },
  );

  batch.set(
    membershipRef,
    {
      role,
      status: 'active',
      organizationName: orgName,
      updatedAt: now,
      source: 'orgApproveJoinRequest_v1',
    },
    { merge: true },
  );

  batch.set(
    memberRef,
    {
      uid: targetUid,
      orgId,
      email: String(jr?.email ?? null),
      displayName: String(jr?.displayName ?? null),
      role,
      active: true,
      updatedAt: now,
      createdAt: jr?.createdAt ?? now,
      source: 'orgApproveJoinRequest_v1',
    },
    { merge: true },
  );

  batch.set(
    userRef,
    {
      organizationId: orgId,
      role,
      updatedAt: now,
      source: 'orgApproveJoinRequest_v1',
      ...(jr?.departmentId !== undefined ? { departmentId: jr.departmentId || null } : {}),
    },
    { merge: true },
  );

  await batch.commit();

  await auditLog({
    action: 'orgApproveJoinRequest',
    actorUid,
    actorEmail,
    orgId,
    targetUid,
    targetEmail: String(jr?.email ?? null),
    before: { status: 'pending', role: String(jr?.requestedRole ?? null) },
    after: { status: 'active', role },
  });

  return { ok: true, organizationId: orgId, uid: targetUid, role };
});

export const orgRejectJoinRequest = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  const requestId = String(data?.uid ?? data?.requestId ?? '').trim();
  const reason = String(data?.reason ?? '').trim().slice(0, 2000);

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!requestId) throw httpsError('invalid-argument', 'uid requerido.');

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  const orgRef = db.collection('organizations').doc(orgId);
  const joinReqRef = orgRef.collection('joinRequests').doc(requestId);
  const joinReqSnap = await joinReqRef.get();
  if (!joinReqSnap.exists) throw httpsError('not-found', 'No existe la solicitud.');

  const jr = joinReqSnap.data() as any;

  let targetUid = String(jr?.userId ?? '').trim();
  if (!targetUid && jr?.email) {
    try {
      targetUid = await resolveTargetUidByEmailOrUid(jr.email);
    } catch {
      targetUid = '';
    }
  }

  const membershipRef = targetUid ? db.collection('memberships').doc(`${targetUid}_${orgId}`) : null;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();

  batch.set(
    joinReqRef,
    {
      status: 'rejected',
      rejectedAt: now,
      rejectedBy: actorUid,
      rejectReason: reason || null,
      updatedAt: now,
      source: 'orgRejectJoinRequest_v1',
    },
    { merge: true },
  );

  if (membershipRef) {
    batch.set(
      membershipRef,
      {
        status: 'revoked',
        updatedAt: now,
        source: 'orgRejectJoinRequest_v1',
      },
      { merge: true },
    );
  }

  await batch.commit();

  await auditLog({
    action: 'orgRejectJoinRequest',
    actorUid,
    actorEmail,
    orgId,
    targetUid: targetUid || null,
    targetEmail: String(jr?.email ?? null),
    before: { status: String(jr?.status ?? 'pending') },
    after: { status: 'rejected', reason: reason || null },
  });

  return { ok: true, organizationId: orgId, uid: targetUid || null };
});

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
