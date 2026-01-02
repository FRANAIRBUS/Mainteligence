import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { Resend } from 'resend';

admin.initializeApp();

// ---------------------------------------------------------------------------
// ROOT MODE (hidden)
// ---------------------------------------------------------------------------
// Root is NOT an app role. It is a Firebase Auth custom claim: { root: true }
// and is intended for a single, hidden operator account. Root:
//   - must NOT have a /users profile or /memberships
//   - must NOT belong to any organization
//   - must only access data through privileged callable functions
//
// IMPORTANT: never confuse this with 'super_admin' (which is an in-app role).
// ---------------------------------------------------------------------------

const assertRoot = (context: functions.https.CallableContext) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const isRoot = Boolean((context.auth.token as any)?.root);
  if (!isRoot) {
    throw new functions.https.HttpsError('permission-denied', 'Root only');
  }
};

type RootOrgRow = { id: string; name?: string; isActive?: boolean; createdAt?: any; updatedAt?: any };

// --- Email (Resend) ---
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const DEFAULT_FROM = 'Mainteligence <noreply@mainteligence.com>';

type UserDoc = {
  id: string;
  email?: string;
  displayName?: string;
  role?: string;
  organizationId?: string;
  departmentId?: string;
  departmentIds?: string[];
  isMaintenanceLead?: boolean;
  active?: boolean;
};

type TicketDoc = {
  displayId?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
  organizationId?: string;
  departmentId?: string;
  originDepartmentId?: string;
  targetDepartmentId?: string;
  siteId?: string;
  assetId?: string;
  createdBy?: string;
  assignedTo?: string | null;
  closedAt?: admin.firestore.Timestamp;
  closedBy?: string;
  reportPdfUrl?: string;
  emailSentAt?: admin.firestore.Timestamp;
};

type TaskDoc = {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  dueDate?: admin.firestore.Timestamp | null;
  organizationId?: string;
  assignedTo?: string;
  // In this project, tasks use `location` to store a departmentId.
  location?: string;
  category?: string;
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function safeEmail(email?: string) {
  if (!email) return null;
  const trimmed = email.trim();
  return trimmed.includes('@') ? trimmed : null;
}

function tsToDateString(ts?: admin.firestore.Timestamp) {
  try {
    if (!ts) return '';
    const d = ts.toDate();
    return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  } catch {
    return '';
  }
}

async function getOrgUsers(organizationId: string): Promise<UserDoc[]> {
  const snap = await admin
    .firestore()
    .collection('users')
    .where('organizationId', '==', organizationId)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function createDispatchOnce(dispatchId: string, payload: Record<string, any>) {
  const ref = admin.firestore().collection('emailDispatches').doc(dispatchId);
  try {
    await ref.create({ ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch (err: any) {
    // Already exists => idempotency guard
    if (err?.code === 6 || err?.code === 'already-exists') return false;
    throw err;
  }
}

async function sendEmail(params: {
  to: string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer | string }[];
}) {
  if (!resend) {
    logger.warn('RESEND_API_KEY missing; skipping email send', {
      subject: params.subject,
      to: params.to,
    });
    return;
  }

  const { data, error } = await resend.emails.send({
    from: DEFAULT_FROM,
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments,
  });

  if (error) {
    logger.error('Resend error', error);
    throw new Error(error.message);
  }

  return data;
}

// --- Notifications: Ticket assignment ---
export const onTicketAssign = functions.firestore
  .document('tickets/{ticketId}')
  .onUpdate(async (change: functions.Change<FirebaseFirestore.DocumentSnapshot>, context: functions.EventContext) => {
    const before = change.before.data() as TicketDoc;
    const after = change.after.data() as TicketDoc;

    const ticketId = context.params.ticketId as string;

    // Only on assignedTo change (non-empty)
    if (before.assignedTo === after.assignedTo) return;
    if (!after.assignedTo) return;
    if (!after.organizationId) return;

    const dispatchId = `ticket_assign_${ticketId}_${after.assignedTo}`;
    const created = await createDispatchOnce(dispatchId, {
      type: 'ticket_assign',
      ticketId,
      organizationId: after.organizationId,
      assignedTo: after.assignedTo,
    });
    if (!created) return;

    const assignedUser = await admin.firestore().collection('users').doc(after.assignedTo).get();
    const assignedUserData = assignedUser.data() as UserDoc | undefined;
    const to = safeEmail(assignedUserData?.email);
    if (!to) return;

    const title = after.title ?? 'Incidencia';
    const displayId = after.displayId ?? ticketId;
    const subject = `Nueva incidencia asignada (${displayId})`;
    const html = `
      <h2>Nueva incidencia asignada</h2>
      <p><strong>Referencia:</strong> ${displayId}</p>
      <p><strong>Título:</strong> ${title}</p>
      <p><strong>Prioridad:</strong> ${after.priority ?? '-'}</p>
      <p><strong>Estado:</strong> ${after.status ?? '-'}</p>
      <p>Puedes verla aquí: <a href="https://mainteligence.com/incidents/${ticketId}">Abrir incidencia</a></p>
    `;

    await sendEmail({ to: [to], subject, html });
  });

// --- Notifications: Task assignment ---
export const onTaskAssign = functions.firestore
  .document('tasks/{taskId}')
  .onUpdate(async (change: functions.Change<FirebaseFirestore.DocumentSnapshot>, context: functions.EventContext) => {
    const before = change.before.data() as TaskDoc;
    const after = change.after.data() as TaskDoc;
    const taskId = context.params.taskId as string;

    // Only react to assignment change
    if (before.assignedTo === after.assignedTo) return;
    if (!after.assignedTo) return;
    if (!after.organizationId) return;

    const dispatchId = `task_assign_${taskId}_${after.assignedTo}`;
    const created = await createDispatchOnce(dispatchId, {
      type: 'task_assign',
      taskId,
      organizationId: after.organizationId,
      assignedTo: after.assignedTo,
    });
    if (!created) return;

    const orgUsers = await getOrgUsers(after.organizationId);
    const assigned = orgUsers.find((u) => u.id === after.assignedTo);
    const toPrimary = safeEmail(assigned?.email);
    if (!toPrimary) return;

    // Optional CC group: maintenance leads + department members
    const deptId = after.location;
    const cc = uniq(
      orgUsers
        .filter((u) => u.active !== false)
        .filter((u) => {
          const isLead = Boolean(u.isMaintenanceLead);
          const sameDept = deptId ? u.departmentId === deptId || (u.departmentIds ?? []).includes(deptId) : false;
          const isManagerRole = ['admin', 'maintenance', 'dept_head_multi', 'dept_head_single', 'super_admin'].includes(
            (u.role ?? '').toString(),
          );
          return (isLead && isManagerRole) || (sameDept && isManagerRole);
        })
        .map((u) => safeEmail(u.email))
        .filter(Boolean) as string[],
    ).filter((e) => e !== toPrimary);

    const subject = `Nueva tarea asignada: ${after.title ?? '(sin título)'}`;
    const html = `
      <h2>Nueva tarea asignada</h2>
      <p><strong>Título:</strong> ${after.title ?? '-'}</p>
      <p><strong>Prioridad:</strong> ${after.priority ?? '-'}</p>
      <p><strong>Estado:</strong> ${after.status ?? '-'}</p>
      <p><strong>Vence:</strong> ${tsToDateString(after.dueDate ?? undefined) || '-'}</p>
      <p><strong>Descripción:</strong> ${(after.description ?? '').toString().slice(0, 500)}</p>
      <p>Abrir tarea: <a href="https://mainteligence.com/tasks/${taskId}">Ver tarea</a></p>
    `;

    const recipients = uniq([toPrimary, ...cc]);
    await sendEmail({ to: recipients, subject, html });
  });

// --- Ticket closure PDF + email ---
function buildTicketClosureHtml(ticket: TicketDoc, reportUrl?: string) {
  const displayId = ticket.displayId ?? '';
  const title = ticket.title ?? '';
  const closedAt = tsToDateString(ticket.closedAt);

  return `
    <h2>Informe de cierre de incidencia</h2>
    <p>Se ha cerrado la incidencia <strong>${displayId}</strong>.</p>
    <p><strong>Título:</strong> ${title}</p>
    <p><strong>Fecha de cierre:</strong> ${closedAt || '-'}</p>
    ${reportUrl ? `<p><a href="${reportUrl}">Descargar informe en PDF</a></p>` : ''}
  `;
}

async function generateTicketClosurePdfBuffer(params: {
  ticketId: string;
  ticket: TicketDoc;
  organizationName: string;
  closedByName?: string;
}) {
  // pdfkit is commonjs
  const PDFDocument = require('pdfkit');

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { ticket, ticketId, organizationName, closedByName } = params;
      const displayId = ticket.displayId ?? ticketId;

      doc.fontSize(18).text('INFORME DE CIERRE - INCIDENCIA', { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(12).text(`Organización: ${organizationName}`);
      doc.text(`Referencia: ${displayId}`);
      doc.text(`Estado: ${ticket.status ?? '-'}`);
      doc.text(`Prioridad: ${ticket.priority ?? '-'}`);
      doc.text(`Tipo: ${ticket.type ?? '-'}`);
      doc.text(`Cerrada el: ${tsToDateString(ticket.closedAt) || '-'}`);
      if (closedByName) doc.text(`Cerrada por: ${closedByName}`);
      doc.moveDown(1);

      doc.fontSize(14).text(ticket.title ?? '');
      doc.moveDown(0.5);
      doc.fontSize(11).text(ticket.description ?? '', { align: 'left' });

      doc.moveDown(2);
      doc.fontSize(9).text('Este informe fue generado automáticamente por Mainteligence.', {
        align: 'center',
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export const onTicketClosed = functions.firestore
  .document('tickets/{ticketId}')
  .onUpdate(async (change: functions.Change<FirebaseFirestore.DocumentSnapshot>, context: functions.EventContext) => {
    const before = change.before.data() as TicketDoc;
    const after = change.after.data() as TicketDoc;
    const ticketId = context.params.ticketId as string;

    if (before.status === after.status) return;
    if (after.status !== 'Cerrada') return;
    if (!after.organizationId) return;

    // idempotency: if already emailed, skip
    if (after.emailSentAt && after.reportPdfUrl) return;

    const dispatchId = `ticket_close_${ticketId}`;
    const created = await createDispatchOnce(dispatchId, {
      type: 'ticket_close',
      ticketId,
      organizationId: after.organizationId,
    });
    if (!created) return;

    // Resolve org name from private org doc (best-effort)
    const orgSnap = await admin.firestore().collection('organizations').doc(after.organizationId).get();
    const orgName = (orgSnap.data() as any)?.name ?? after.organizationId;

    // Resolve closedBy display name (best-effort)
    let closedByName: string | undefined;
    if (after.closedBy) {
      const closedBySnap = await admin.firestore().collection('users').doc(after.closedBy).get();
      const u = closedBySnap.data() as any;
      closedByName = u?.displayName ?? u?.email;
    }

    const pdfBuffer = await generateTicketClosurePdfBuffer({
      ticketId,
      ticket: after,
      organizationName: orgName,
      closedByName,
    });

    // Upload PDF to Storage (under the ticket folder)
    const bucket = admin.storage().bucket();
    const token = (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`;
    const storagePath = `tickets/${ticketId}/closure-report.pdf`;
    const file = bucket.file(storagePath);

    await file.save(pdfBuffer, {
      contentType: 'application/pdf',
      resumable: false,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const reportUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      storagePath,
    )}?alt=media&token=${token}`;

    // Recipients: creator + assigned + admins/maintenance leads
    const orgUsers = await getOrgUsers(after.organizationId);
    const recipientEmails = uniq(
      [after.createdBy, after.assignedTo ?? undefined]
        .filter(Boolean)
        .map((uid) => orgUsers.find((u) => u.id === uid))
        .map((u) => safeEmail(u?.email))
        .filter(Boolean) as string[],
    );

    const managers = orgUsers
      .filter((u) => u.active !== false)
      .filter((u) => ['admin', 'maintenance', 'super_admin'].includes((u.role ?? '').toString()))
      .map((u) => safeEmail(u.email))
      .filter(Boolean) as string[];

    const to = uniq([...recipientEmails, ...managers]);
    if (to.length === 0) {
      logger.warn('No recipients for ticket close email', { ticketId });
    } else {
      const subject = `Informe de cierre - ${after.displayId ?? ticketId}`;
      const html = buildTicketClosureHtml(after, reportUrl);

      await sendEmail({
        to,
        subject,
        html,
        attachments: [{ filename: `informe-cierre-${after.displayId ?? ticketId}.pdf`, content: pdfBuffer }],
      });
    }

    await change.after.ref.set(
      {
        reportPdfUrl: reportUrl,
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

// --- Storage cleanup to prevent orphans ---
async function deleteStoragePrefix(prefix: string) {
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(
    files.map(async (f) => {
      try {
        await f.delete();
      } catch (err) {
        logger.warn('Failed to delete storage file', { name: f.name, err });
      }
    }),
  );
}

export const onTicketDeleted = functions.firestore
  .document('tickets/{ticketId}')
  .onDelete(async (_snap: FirebaseFirestore.DocumentSnapshot, context: functions.EventContext) => {
    const ticketId = context.params.ticketId as string;
    await deleteStoragePrefix(`tickets/${ticketId}/`);
  });

export const onTaskDeleted = functions.firestore
  .document('tasks/{taskId}')
  .onDelete(async (_snap: FirebaseFirestore.DocumentSnapshot, context: functions.EventContext) => {
    const taskId = context.params.taskId as string;
    await deleteStoragePrefix(`tasks/${taskId}/`);
  });

// ---------------------------------------------------------------------------
// Root callables
// ---------------------------------------------------------------------------

/**
 * List organizations (id + name). Root-only.
 */
export const rootListOrganizations = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const limit = Math.max(1, Math.min(200, Number(data?.limit ?? 50)));

  // Order by updatedAt if present, else createdAt.
  const col = admin.firestore().collection('organizations');
  let q: FirebaseFirestore.Query = col;

  // We avoid relying on an index that might not exist by trying updatedAt first
  // and falling back to createdAt.
  try {
    q = col.orderBy('updatedAt', 'desc').limit(limit);
    const snap = await q.get();
    const organizations: RootOrgRow[] = snap.docs.map((d) => {
      const v = d.data() as any;
      return { id: d.id, name: v?.name, isActive: v?.isActive, createdAt: v?.createdAt, updatedAt: v?.updatedAt };
    });
    return { organizations };
  } catch {
    const snap = await col.orderBy('createdAt', 'desc').limit(limit).get();
    const organizations: RootOrgRow[] = snap.docs.map((d) => {
      const v = d.data() as any;
      return { id: d.id, name: v?.name, isActive: v?.isActive, createdAt: v?.createdAt, updatedAt: v?.updatedAt };
    });
    return { organizations };
  }
});

/**
 * Move/upsert a user into an organization (single-tenant style primary org).
 * Root-only.
 */
export const rootUpsertUserToOrganization = functions.https.onCall(async (data, context) => {
  assertRoot(context);

  const email = String(data?.email ?? '').trim().toLowerCase();
  const organizationId = String(data?.organizationId ?? '').trim();
  const role = (String(data?.role ?? 'operario').trim() as 'admin' | 'operario' | 'mantenimiento');

  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing email');
  }
  if (!organizationId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing organizationId');
  }
  if (!['admin', 'operario', 'mantenimiento'].includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid role');
  }

  // Resolve user from Auth
  const authUser = await admin.auth().getUserByEmail(email);
  const uid = authUser.uid;

  // Ensure org documents exist (minimal stub)
  const orgRef = admin.firestore().doc(`organizations/${organizationId}`);
  const orgPublicRef = admin.firestore().doc(`organizationsPublic/${organizationId}`);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    await orgRef.set(
      {
        organizationId,
        name: organizationId,
        country: 'ES',
        isActive: true,
        plan: {
          tier: 'trial',
          maxUsers: 50,
          maxTicketsPerMonth: 500,
          maxTasksPerMonth: 500,
          storageMb: 1024,
          usersThisMonth: 0,
          ticketsThisMonth: 0,
          tasksThisMonth: 0,
          storageMbUsed: 0,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  await orgPublicRef.set(
    {
      organizationId,
      name: (orgSnap.data() as any)?.name ?? organizationId,
      isActive: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Update user profile doc
  const userRef = admin.firestore().doc(`users/${uid}`);
  await userRef.set(
    {
      email: authUser.email ?? email,
      displayName: authUser.displayName ?? authUser.email ?? email,
      active: true,
      organizationId,
      role,
      isMaintenanceLead: role === 'admin',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Upsert membership
  const membershipId = `${uid}_${organizationId}`;
  const membershipRef = admin.firestore().doc(`memberships/${membershipId}`);
  const orgName = (await orgRef.get()).data()?.name ?? organizationId;
  await membershipRef.set(
    {
      userId: uid,
      organizationId,
      organizationName: orgName,
      role,
      status: 'active',
      primary: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Create org member doc (used by rules)
  const memberRef = admin.firestore().doc(`organizations/${organizationId}/members/${uid}`);
  await memberRef.set(
    {
      uid,
      orgId: organizationId,
      email: authUser.email ?? email,
      displayName: authUser.displayName ?? authUser.email ?? email,
      active: true,
      role,
      source: 'root_console',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true, uid, organizationId, role };
});
