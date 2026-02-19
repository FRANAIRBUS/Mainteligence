import * as admin from 'firebase-admin';
import { defineString } from 'firebase-functions/params';
import { Resend } from 'resend';

type AssignmentType = 'tarea' | 'incidencia';

interface RecipientOptions {
  users: BackendUser[];
  departments: BackendDepartment[];
  assignedTo?: string | null;
  departmentId?: string | null;
}

interface AssignmentEmailInput {
  organizationId?: string | null;
  assignedTo?: string | null;
  departmentId?: string | null;
  title: string;
  link: string;
  type: AssignmentType;
  identifier?: string;
  description?: string;
  priority?: string;
  status?: string;
  dueDate?: unknown;
  location?: string;
  category?: string;
}

interface BackendUser {
  id: string;
  displayName?: string | null;
  email?: string | null;
  departmentId?: string | null;
  isMaintenanceLead?: boolean | null;
}

interface BackendDepartment {
  id: string;
  name?: string | null;
  code?: string | null;
}

const RESEND_API_KEY = defineString('RESEND_API_KEY');
const RESEND_FROM = defineString('RESEND_FROM');

const resolveAssignedUser = (users: BackendUser[], assignedTo?: string | null) =>
  users.find(
    (user) => user.id === assignedTo || user.displayName === assignedTo || user.email === assignedTo
  ) ?? null;

const resolveDepartmentId = (departments: BackendDepartment[], departmentIdOrName?: string | null) =>
  departments.find(
    (dept) =>
      dept.id === departmentIdOrName ||
      dept.name === departmentIdOrName ||
      dept.code === departmentIdOrName
  )?.id ?? null;

const collectRecipients = ({ users, departments, assignedTo, departmentId }: RecipientOptions) => {
  const recipients = new Set<string>();
  const assignedUser = resolveAssignedUser(users, assignedTo);
  const resolvedDepartmentId = departmentId || resolveDepartmentId(departments, departmentId);

  if (assignedUser?.email) {
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

const formatDate = (value: unknown) => {
  if (!value) return 'Sin fecha';

  const parsedDate = (() => {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    if (typeof value === 'object' && value && 'toDate' in value) {
      const maybeDate = (value as { toDate?: () => Date }).toDate?.();
      return maybeDate ?? null;
    }
    return null;
  })();

  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsedDate);
};

const buildEmailContent = ({
  title,
  link,
  type,
  identifier,
  description,
  priority,
  status,
  dueDate,
  location,
  category,
  assignedUser,
}: AssignmentEmailInput & { assignedUser: BackendUser | null }) => {
  const typeLabel = type === 'tarea' ? 'tarea' : 'incidencia';
  const subject = `Nueva ${typeLabel} asignada: ${title}`;
  const safeTitle = title || '(sin título)';
  const safeDescription = description || 'Sin descripción';
  const introLine = assignedUser
    ? `Has sido asignado a la ${typeLabel} ${safeTitle}.`
    : `Se ha asignado la ${typeLabel} ${safeTitle}.`;

  const details: { label: string; value: string }[] = [
    { label: 'Título', value: safeTitle },
    { label: 'ID', value: identifier || 'No especificado' },
    { label: 'Estado', value: status || 'open' },
    { label: 'Prioridad', value: priority || 'media' },
    { label: 'Fecha límite', value: formatDate(dueDate) },
    { label: 'Ubicación / Departamento', value: location || 'No especificado' },
    { label: 'Categoría', value: category || 'No especificada' },
    { label: 'Descripción', value: safeDescription },
  ];

  const detailRows = details
    .map(
      (item) =>
        `<tr><td style="padding: 8px 12px; font-weight: 600; color: #111827;">${item.label}</td><td style="padding: 8px 12px; color: #374151;">${item.value}</td></tr>`
    )
    .join('');

  const text = [
    introLine,
    `Título: ${safeTitle}`,
    `Descripción: ${safeDescription}`,
    `ID: ${identifier || 'No especificado'}`,
    `Estado: ${status || 'open'}`,
    `Prioridad: ${priority || 'media'}`,
    `Fecha límite: ${formatDate(dueDate)}`,
    `Ubicación / Departamento: ${location || 'No especificado'}`,
    `Categoría: ${category || 'No especificada'}`,
    `Ver ${typeLabel}: ${link}`,
  ].join('\n');

  const html = `
    <table style="width:100%; max-width:640px; margin:0 auto; font-family: 'Inter', system-ui, -apple-system, sans-serif; border:1px solid #e5e7eb; border-radius: 12px; overflow:hidden;">
      <tr>
        <td style="background:linear-gradient(135deg, #111827, #1f2937); padding:24px 24px; color:#f9fafb;">
          <div style="font-size:14px; letter-spacing:0.5px; text-transform:uppercase; opacity:0.8;">Nueva ${typeLabel} asignada</div>
          <div style="font-size:22px; font-weight:700; margin-top:4px;">${safeTitle}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 24px 8px; color:#111827;">
          <p style="margin:0 0 12px; font-size:16px;">${introLine}</p>
          <p style="margin:0 0 12px; font-size:15px; color:#374151;"><strong>Descripción:</strong> ${safeDescription}</p>
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

const loadOrganizationData = async (organizationId?: string | null) => {
  if (!organizationId) {
    return { users: [] as BackendUser[], departments: [] as BackendDepartment[] };
  }

  const orgRef = admin.firestore().collection('organizations').doc(organizationId);
  const [membersSnap, departmentsSnap] = await Promise.all([
    orgRef.collection('members').get(),
    orgRef.collection('departments').get(),
  ]);

  const users = membersSnap.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      id: doc.id,
      displayName: data?.displayName ?? null,
      email: data?.email ?? null,
      departmentId: data?.departmentId ?? null,
      isMaintenanceLead: data?.isMaintenanceLead ?? null,
    } satisfies BackendUser;
  });

  const departments = departmentsSnap.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      id: doc.id,
      name: data?.name ?? null,
      code: data?.code ?? null,
    } satisfies BackendDepartment;
  });

  return { users, departments };
};

const resolveFallbackAssignedUser = async (
  assignedTo: string | null | undefined,
  organizationId: string | null | undefined
) => {
  if (!assignedTo || !organizationId) return null;

  const userSnap = await admin.firestore().collection('users').doc(assignedTo).get();
  if (userSnap.exists) {
    const data = userSnap.data() as any;
    return {
      id: userSnap.id,
      displayName: data?.displayName ?? null,
      email: data?.email ?? null,
      departmentId: data?.departmentId ?? null,
      isMaintenanceLead: data?.isMaintenanceLead ?? null,
    } satisfies BackendUser;
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
    const data = doc.data() as any;
    return {
      id: doc.id,
      displayName: data?.displayName ?? null,
      email: data?.email ?? null,
    } satisfies BackendUser;
  }

  return null;
};

export const sendAssignmentEmail = async (input: AssignmentEmailInput) => {
  const resendKey = RESEND_API_KEY.value();
  const resendFrom = RESEND_FROM.value();

  if (!resendKey || !resendFrom) {
    console.warn('Resend no configurado: RESEND_API_KEY/RESEND_FROM faltante.');
    return;
  }

  const { users, departments } = await loadOrganizationData(input.organizationId ?? null);
  const resolvedAssignedUser =
    resolveAssignedUser(users, input.assignedTo) ??
    (await resolveFallbackAssignedUser(input.assignedTo ?? null, input.organizationId ?? null));

  const { recipients } = collectRecipients({
    users,
    departments,
    assignedTo: input.assignedTo,
    departmentId: input.departmentId,
  });

  if (resolvedAssignedUser?.email && !recipients.includes(resolvedAssignedUser.email)) {
    recipients.push(resolvedAssignedUser.email);
  }

  if (!recipients.length) {
    return;
  }

  const { subject, html, text } = buildEmailContent({
    ...input,
    assignedUser: resolvedAssignedUser,
  });

  const resend = new Resend(resendKey);

  await resend.emails.send({
    from: resendFrom,
    to: recipients,
    subject,
    html,
    text,
  });
};
