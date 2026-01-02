"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTaskDeleted = exports.onTicketDeleted = exports.onTicketClosed = exports.onTaskAssign = exports.onTicketAssign = void 0;
const functions = require("firebase-functions/v1");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const resend_1 = require("resend");
admin.initializeApp();
// --- Email (Resend) ---
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new resend_1.Resend(resendApiKey) : null;
const DEFAULT_FROM = 'Mainteligence <noreply@mainteligence.com>';
function uniq(arr) {
    return Array.from(new Set(arr));
}
function safeEmail(email) {
    if (!email)
        return null;
    const trimmed = email.trim();
    return trimmed.includes('@') ? trimmed : null;
}
function tsToDateString(ts) {
    try {
        if (!ts)
            return '';
        const d = ts.toDate();
        return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
    }
    catch (_a) {
        return '';
    }
}
async function getOrgUsers(organizationId) {
    const snap = await admin
        .firestore()
        .collection('users')
        .where('organizationId', '==', organizationId)
        .get();
    return snap.docs.map((d) => (Object.assign({ id: d.id }, d.data())));
}
async function createDispatchOnce(dispatchId, payload) {
    const ref = admin.firestore().collection('emailDispatches').doc(dispatchId);
    try {
        await ref.create(Object.assign(Object.assign({}, payload), { createdAt: admin.firestore.FieldValue.serverTimestamp() }));
        return true;
    }
    catch (err) {
        // Already exists => idempotency guard
        if ((err === null || err === void 0 ? void 0 : err.code) === 6 || (err === null || err === void 0 ? void 0 : err.code) === 'already-exists')
            return false;
        throw err;
    }
}
async function sendEmail(params) {
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
exports.onTicketAssign = functions.firestore
    .document('tickets/{ticketId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d;
    const before = change.before.data();
    const after = change.after.data();
    const ticketId = context.params.ticketId;
    // Only on assignedTo change (non-empty)
    if (before.assignedTo === after.assignedTo)
        return;
    if (!after.assignedTo)
        return;
    if (!after.organizationId)
        return;
    const dispatchId = `ticket_assign_${ticketId}_${after.assignedTo}`;
    const created = await createDispatchOnce(dispatchId, {
        type: 'ticket_assign',
        ticketId,
        organizationId: after.organizationId,
        assignedTo: after.assignedTo,
    });
    if (!created)
        return;
    const assignedUser = await admin.firestore().collection('users').doc(after.assignedTo).get();
    const assignedUserData = assignedUser.data();
    const to = safeEmail(assignedUserData === null || assignedUserData === void 0 ? void 0 : assignedUserData.email);
    if (!to)
        return;
    const title = (_a = after.title) !== null && _a !== void 0 ? _a : 'Incidencia';
    const displayId = (_b = after.displayId) !== null && _b !== void 0 ? _b : ticketId;
    const subject = `Nueva incidencia asignada (${displayId})`;
    const html = `
      <h2>Nueva incidencia asignada</h2>
      <p><strong>Referencia:</strong> ${displayId}</p>
      <p><strong>Título:</strong> ${title}</p>
      <p><strong>Prioridad:</strong> ${(_c = after.priority) !== null && _c !== void 0 ? _c : '-'}</p>
      <p><strong>Estado:</strong> ${(_d = after.status) !== null && _d !== void 0 ? _d : '-'}</p>
      <p>Puedes verla aquí: <a href="https://mainteligence.com/incidents/${ticketId}">Abrir incidencia</a></p>
    `;
    await sendEmail({ to: [to], subject, html });
});
// --- Notifications: Task assignment ---
exports.onTaskAssign = functions.firestore
    .document('tasks/{taskId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d, _e, _f;
    const before = change.before.data();
    const after = change.after.data();
    const taskId = context.params.taskId;
    // Only react to assignment change
    if (before.assignedTo === after.assignedTo)
        return;
    if (!after.assignedTo)
        return;
    if (!after.organizationId)
        return;
    const dispatchId = `task_assign_${taskId}_${after.assignedTo}`;
    const created = await createDispatchOnce(dispatchId, {
        type: 'task_assign',
        taskId,
        organizationId: after.organizationId,
        assignedTo: after.assignedTo,
    });
    if (!created)
        return;
    const orgUsers = await getOrgUsers(after.organizationId);
    const assigned = orgUsers.find((u) => u.id === after.assignedTo);
    const toPrimary = safeEmail(assigned === null || assigned === void 0 ? void 0 : assigned.email);
    if (!toPrimary)
        return;
    // Optional CC group: maintenance leads + department members
    const deptId = after.location;
    const cc = uniq(orgUsers
        .filter((u) => u.active !== false)
        .filter((u) => {
        var _a, _b;
        const isLead = Boolean(u.isMaintenanceLead);
        const sameDept = deptId ? u.departmentId === deptId || ((_a = u.departmentIds) !== null && _a !== void 0 ? _a : []).includes(deptId) : false;
        const isManagerRole = ['admin', 'maintenance', 'dept_head_multi', 'dept_head_single', 'super_admin'].includes(((_b = u.role) !== null && _b !== void 0 ? _b : '').toString());
        return (isLead && isManagerRole) || (sameDept && isManagerRole);
    })
        .map((u) => safeEmail(u.email))
        .filter(Boolean)).filter((e) => e !== toPrimary);
    const subject = `Nueva tarea asignada: ${(_a = after.title) !== null && _a !== void 0 ? _a : '(sin título)'}`;
    const html = `
      <h2>Nueva tarea asignada</h2>
      <p><strong>Título:</strong> ${(_b = after.title) !== null && _b !== void 0 ? _b : '-'}</p>
      <p><strong>Prioridad:</strong> ${(_c = after.priority) !== null && _c !== void 0 ? _c : '-'}</p>
      <p><strong>Estado:</strong> ${(_d = after.status) !== null && _d !== void 0 ? _d : '-'}</p>
      <p><strong>Vence:</strong> ${tsToDateString((_e = after.dueDate) !== null && _e !== void 0 ? _e : undefined) || '-'}</p>
      <p><strong>Descripción:</strong> ${((_f = after.description) !== null && _f !== void 0 ? _f : '').toString().slice(0, 500)}</p>
      <p>Abrir tarea: <a href="https://mainteligence.com/tasks/${taskId}">Ver tarea</a></p>
    `;
    const recipients = uniq([toPrimary, ...cc]);
    await sendEmail({ to: recipients, subject, html });
});
// --- Ticket closure PDF + email ---
function buildTicketClosureHtml(ticket, reportUrl) {
    var _a, _b;
    const displayId = (_a = ticket.displayId) !== null && _a !== void 0 ? _a : '';
    const title = (_b = ticket.title) !== null && _b !== void 0 ? _b : '';
    const closedAt = tsToDateString(ticket.closedAt);
    return `
    <h2>Informe de cierre de incidencia</h2>
    <p>Se ha cerrado la incidencia <strong>${displayId}</strong>.</p>
    <p><strong>Título:</strong> ${title}</p>
    <p><strong>Fecha de cierre:</strong> ${closedAt || '-'}</p>
    ${reportUrl ? `<p><a href="${reportUrl}">Descargar informe en PDF</a></p>` : ''}
  `;
}
async function generateTicketClosurePdfBuffer(params) {
    // pdfkit is commonjs
    const PDFDocument = require('pdfkit');
    return await new Promise((resolve, reject) => {
        var _a, _b, _c, _d, _e, _f;
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            const { ticket, ticketId, organizationName, closedByName } = params;
            const displayId = (_a = ticket.displayId) !== null && _a !== void 0 ? _a : ticketId;
            doc.fontSize(18).text('INFORME DE CIERRE - INCIDENCIA', { align: 'center' });
            doc.moveDown(1);
            doc.fontSize(12).text(`Organización: ${organizationName}`);
            doc.text(`Referencia: ${displayId}`);
            doc.text(`Estado: ${(_b = ticket.status) !== null && _b !== void 0 ? _b : '-'}`);
            doc.text(`Prioridad: ${(_c = ticket.priority) !== null && _c !== void 0 ? _c : '-'}`);
            doc.text(`Tipo: ${(_d = ticket.type) !== null && _d !== void 0 ? _d : '-'}`);
            doc.text(`Cerrada el: ${tsToDateString(ticket.closedAt) || '-'}`);
            if (closedByName)
                doc.text(`Cerrada por: ${closedByName}`);
            doc.moveDown(1);
            doc.fontSize(14).text((_e = ticket.title) !== null && _e !== void 0 ? _e : '');
            doc.moveDown(0.5);
            doc.fontSize(11).text((_f = ticket.description) !== null && _f !== void 0 ? _f : '', { align: 'left' });
            doc.moveDown(2);
            doc.fontSize(9).text('Este informe fue generado automáticamente por Mainteligence.', {
                align: 'center',
            });
            doc.end();
        }
        catch (err) {
            reject(err);
        }
    });
}
exports.onTicketClosed = functions.firestore
    .document('tickets/{ticketId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const before = change.before.data();
    const after = change.after.data();
    const ticketId = context.params.ticketId;
    if (before.status === after.status)
        return;
    if (after.status !== 'Cerrada')
        return;
    if (!after.organizationId)
        return;
    // idempotency: if already emailed, skip
    if (after.emailSentAt && after.reportPdfUrl)
        return;
    const dispatchId = `ticket_close_${ticketId}`;
    const created = await createDispatchOnce(dispatchId, {
        type: 'ticket_close',
        ticketId,
        organizationId: after.organizationId,
    });
    if (!created)
        return;
    // Resolve org name from private org doc (best-effort)
    const orgSnap = await admin.firestore().collection('organizations').doc(after.organizationId).get();
    const orgName = (_b = (_a = orgSnap.data()) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : after.organizationId;
    // Resolve closedBy display name (best-effort)
    let closedByName;
    if (after.closedBy) {
        const closedBySnap = await admin.firestore().collection('users').doc(after.closedBy).get();
        const u = closedBySnap.data();
        closedByName = (_c = u === null || u === void 0 ? void 0 : u.displayName) !== null && _c !== void 0 ? _c : u === null || u === void 0 ? void 0 : u.email;
    }
    const pdfBuffer = await generateTicketClosurePdfBuffer({
        ticketId,
        ticket: after,
        organizationName: orgName,
        closedByName,
    });
    // Upload PDF to Storage (under the ticket folder)
    const bucket = admin.storage().bucket();
    const token = (_f = (_e = (_d = globalThis.crypto) === null || _d === void 0 ? void 0 : _d.randomUUID) === null || _e === void 0 ? void 0 : _e.call(_d)) !== null && _f !== void 0 ? _f : `${Date.now()}_${Math.random()}`;
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
    const reportUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
    // Recipients: creator + assigned + admins/maintenance leads
    const orgUsers = await getOrgUsers(after.organizationId);
    const recipientEmails = uniq([after.createdBy, (_g = after.assignedTo) !== null && _g !== void 0 ? _g : undefined]
        .filter(Boolean)
        .map((uid) => orgUsers.find((u) => u.id === uid))
        .map((u) => safeEmail(u === null || u === void 0 ? void 0 : u.email))
        .filter(Boolean));
    const managers = orgUsers
        .filter((u) => u.active !== false)
        .filter((u) => { var _a; return ['admin', 'maintenance', 'super_admin'].includes(((_a = u.role) !== null && _a !== void 0 ? _a : '').toString()); })
        .map((u) => safeEmail(u.email))
        .filter(Boolean);
    const to = uniq([...recipientEmails, ...managers]);
    if (to.length === 0) {
        logger.warn('No recipients for ticket close email', { ticketId });
    }
    else {
        const subject = `Informe de cierre - ${(_h = after.displayId) !== null && _h !== void 0 ? _h : ticketId}`;
        const html = buildTicketClosureHtml(after, reportUrl);
        await sendEmail({
            to,
            subject,
            html,
            attachments: [{ filename: `informe-cierre-${(_j = after.displayId) !== null && _j !== void 0 ? _j : ticketId}.pdf`, content: pdfBuffer }],
        });
    }
    await change.after.ref.set({
        reportPdfUrl: reportUrl,
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
});
// --- Storage cleanup to prevent orphans ---
async function deleteStoragePrefix(prefix) {
    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix });
    await Promise.all(files.map(async (f) => {
        try {
            await f.delete();
        }
        catch (err) {
            logger.warn('Failed to delete storage file', { name: f.name, err });
        }
    }));
}
exports.onTicketDeleted = functions.firestore
    .document('tickets/{ticketId}')
    .onDelete(async (_snap, context) => {
    const ticketId = context.params.ticketId;
    await deleteStoragePrefix(`tickets/${ticketId}/`);
});
exports.onTaskDeleted = functions.firestore
    .document('tasks/{taskId}')
    .onDelete(async (_snap, context) => {
    const taskId = context.params.taskId;
    await deleteStoragePrefix(`tasks/${taskId}/`);
});
//# sourceMappingURL=index.js.map