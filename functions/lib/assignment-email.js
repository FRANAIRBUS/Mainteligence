"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendAssignmentEmail = void 0;
const admin = require("firebase-admin");
const params_1 = require("firebase-functions/params");
const resend_1 = require("resend");
const RESEND_API_KEY = (0, params_1.defineString)('RESEND_API_KEY');
const RESEND_FROM = (0, params_1.defineString)('RESEND_FROM');
const resolveAssignedUser = (users, assignedTo) => {
    var _a;
    return (_a = users.find((user) => user.id === assignedTo || user.displayName === assignedTo || user.email === assignedTo)) !== null && _a !== void 0 ? _a : null;
};
const resolveDepartmentId = (departments, departmentIdOrName) => {
    var _a, _b;
    return (_b = (_a = departments.find((dept) => dept.id === departmentIdOrName ||
        dept.name === departmentIdOrName ||
        dept.code === departmentIdOrName)) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null;
};
const collectRecipients = ({ users, departments, assignedTo, departmentId }) => {
    const recipients = new Set();
    const assignedUser = resolveAssignedUser(users, assignedTo);
    const resolvedDepartmentId = departmentId || resolveDepartmentId(departments, departmentId);
    if (assignedUser === null || assignedUser === void 0 ? void 0 : assignedUser.email) {
        recipients.add(assignedUser.email);
    }
    users.forEach((user) => {
        if (resolvedDepartmentId && user.departmentId === resolvedDepartmentId && user.email) {
            recipients.add(user.email);
        }
        if (user.isMaintenanceLead && user.email) {
            recipients.add(user.email);
        }
    });
    return {
        recipients: Array.from(recipients),
        assignedUser,
    };
};
const formatDate = (value) => {
    if (!value)
        return 'Sin fecha';
    const parsedDate = (() => {
        var _a, _b;
        if (value instanceof Date)
            return value;
        if (typeof value === 'string' || typeof value === 'number')
            return new Date(value);
        if (typeof value === 'object' && value && 'toDate' in value) {
            const maybeDate = (_b = (_a = value).toDate) === null || _b === void 0 ? void 0 : _b.call(_a);
            return maybeDate !== null && maybeDate !== void 0 ? maybeDate : null;
        }
        return null;
    })();
    if (!parsedDate || Number.isNaN(parsedDate.getTime()))
        return 'Sin fecha';
    return new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(parsedDate);
};
const buildEmailContent = ({ title, link, type, identifier, description, priority, status, dueDate, location, category, assignedUser, }) => {
    const typeLabel = type === 'tarea' ? 'tarea' : 'incidencia';
    const subject = `Nueva ${typeLabel} asignada: ${title}`;
    const introLine = assignedUser
        ? `Has sido asignado a la ${typeLabel} ${identifier ? `${identifier} - ` : ''}${title}.`
        : `Se ha asignado la ${typeLabel} ${identifier ? `${identifier} - ` : ''}${title}.`;
    const details = [
        { label: 'Título', value: title || '(sin título)' },
        { label: 'ID', value: identifier || 'No especificado' },
        { label: 'Estado', value: status || 'pendiente' },
        { label: 'Prioridad', value: priority || 'media' },
        { label: 'Fecha límite', value: formatDate(dueDate) },
        { label: 'Ubicación / Departamento', value: location || 'No especificado' },
        { label: 'Categoría', value: category || 'No especificada' },
        { label: 'Descripción', value: description || 'Sin descripción' },
    ];
    const detailRows = details
        .map((item) => `<tr><td style="padding: 8px 12px; font-weight: 600; color: #111827;">${item.label}</td><td style="padding: 8px 12px; color: #374151;">${item.value}</td></tr>`)
        .join('');
    const text = [
        introLine,
        `Título: ${title || '(sin título)'}`,
        `ID: ${identifier || 'No especificado'}`,
        `Estado: ${status || 'pendiente'}`,
        `Prioridad: ${priority || 'media'}`,
        `Fecha límite: ${formatDate(dueDate)}`,
        `Ubicación / Departamento: ${location || 'No especificado'}`,
        `Categoría: ${category || 'No especificada'}`,
        `Descripción: ${description || 'Sin descripción'}`,
        `Ver ${typeLabel}: ${link}`,
    ].join('\n');
    const html = `
    <table style="width:100%; max-width:640px; margin:0 auto; font-family: 'Inter', system-ui, -apple-system, sans-serif; border:1px solid #e5e7eb; border-radius: 12px; overflow:hidden;">
      <tr>
        <td style="background:linear-gradient(135deg, #111827, #1f2937); padding:24px 24px; color:#f9fafb;">
          <div style="font-size:14px; letter-spacing:0.5px; text-transform:uppercase; opacity:0.8;">Nueva ${typeLabel} asignada</div>
          <div style="font-size:22px; font-weight:700; margin-top:4px;">${identifier ? `${identifier} · ` : ''}${title}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 24px 8px; color:#111827;">
          <p style="margin:0 0 12px; font-size:16px;">${introLine}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 16px 8px;">
          <table style="width:100%; border-collapse:collapse;">
            <tbody>${detailRows}</tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 24px;">
          <a href="${link}" style="display:inline-block; background:#111827; color:#f9fafb; padding:12px 18px; border-radius:10px; text-decoration:none; font-weight:600;">Ver ${typeLabel}</a>
          <p style="margin:12px 0 0; font-size:12px; color:#6b7280;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>${link}</p>
        </td>
      </tr>
    </table>
  `;
    return { subject, html, text };
};
const loadOrganizationData = async (organizationId) => {
    if (!organizationId) {
        return { users: [], departments: [] };
    }
    const [usersSnap, departmentsSnap] = await Promise.all([
        admin.firestore().collection('users').where('organizationId', '==', organizationId).get(),
        admin.firestore().collection('departments').where('organizationId', '==', organizationId).get(),
    ]);
    const users = usersSnap.docs.map((doc) => {
        var _a, _b, _c, _d;
        const data = doc.data();
        return {
            id: doc.id,
            displayName: (_a = data === null || data === void 0 ? void 0 : data.displayName) !== null && _a !== void 0 ? _a : null,
            email: (_b = data === null || data === void 0 ? void 0 : data.email) !== null && _b !== void 0 ? _b : null,
            departmentId: (_c = data === null || data === void 0 ? void 0 : data.departmentId) !== null && _c !== void 0 ? _c : null,
            isMaintenanceLead: (_d = data === null || data === void 0 ? void 0 : data.isMaintenanceLead) !== null && _d !== void 0 ? _d : null,
        };
    });
    const departments = departmentsSnap.docs.map((doc) => {
        var _a, _b;
        const data = doc.data();
        return {
            id: doc.id,
            name: (_a = data === null || data === void 0 ? void 0 : data.name) !== null && _a !== void 0 ? _a : null,
            code: (_b = data === null || data === void 0 ? void 0 : data.code) !== null && _b !== void 0 ? _b : null,
        };
    });
    return { users, departments };
};
const resolveFallbackAssignedUser = async (assignedTo, organizationId) => {
    var _a, _b, _c, _d, _e, _f;
    if (!assignedTo || !organizationId)
        return null;
    const userSnap = await admin.firestore().collection('users').doc(assignedTo).get();
    if (userSnap.exists) {
        const data = userSnap.data();
        return {
            id: userSnap.id,
            displayName: (_a = data === null || data === void 0 ? void 0 : data.displayName) !== null && _a !== void 0 ? _a : null,
            email: (_b = data === null || data === void 0 ? void 0 : data.email) !== null && _b !== void 0 ? _b : null,
            departmentId: (_c = data === null || data === void 0 ? void 0 : data.departmentId) !== null && _c !== void 0 ? _c : null,
            isMaintenanceLead: (_d = data === null || data === void 0 ? void 0 : data.isMaintenanceLead) !== null && _d !== void 0 ? _d : null,
        };
    }
    const memberSnap = await admin
        .firestore()
        .collection('organizations')
        .doc(organizationId)
        .collection('members')
        .where('email', '==', assignedTo)
        .limit(1)
        .get();
    if (!memberSnap.empty) {
        const doc = memberSnap.docs[0];
        const data = doc.data();
        return {
            id: doc.id,
            displayName: (_e = data === null || data === void 0 ? void 0 : data.displayName) !== null && _e !== void 0 ? _e : null,
            email: (_f = data === null || data === void 0 ? void 0 : data.email) !== null && _f !== void 0 ? _f : null,
        };
    }
    return null;
};
const sendAssignmentEmail = async (input) => {
    var _a, _b, _c, _d;
    const resendKey = RESEND_API_KEY.value();
    const resendFrom = RESEND_FROM.value();
    if (!resendKey || !resendFrom) {
        console.warn('Resend no configurado: RESEND_API_KEY/RESEND_FROM faltante.');
        return;
    }
    const { users, departments } = await loadOrganizationData((_a = input.organizationId) !== null && _a !== void 0 ? _a : null);
    const resolvedAssignedUser = (_b = resolveAssignedUser(users, input.assignedTo)) !== null && _b !== void 0 ? _b : (await resolveFallbackAssignedUser((_c = input.assignedTo) !== null && _c !== void 0 ? _c : null, (_d = input.organizationId) !== null && _d !== void 0 ? _d : null));
    const { recipients } = collectRecipients({
        users,
        departments,
        assignedTo: input.assignedTo,
        departmentId: input.departmentId,
    });
    if ((resolvedAssignedUser === null || resolvedAssignedUser === void 0 ? void 0 : resolvedAssignedUser.email) && !recipients.includes(resolvedAssignedUser.email)) {
        recipients.push(resolvedAssignedUser.email);
    }
    if (!recipients.length) {
        return;
    }
    const { subject, html, text } = buildEmailContent(Object.assign(Object.assign({}, input), { assignedUser: resolvedAssignedUser }));
    const resend = new resend_1.Resend(resendKey);
    await resend.emails.send({
        from: resendFrom,
        to: recipients,
        subject,
        html,
        text,
    });
};
exports.sendAssignmentEmail = sendAssignmentEmail;
//# sourceMappingURL=assignment-email.js.map