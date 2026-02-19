import type { Department } from "@/lib/firebase/models";
import { sendEmailAction } from "@/app/actions/email";

type AssignmentType = "tarea" | "incidencia";

type AssignmentUser = {
  id: string;
  displayName?: string | null;
  email?: string | null;
  departmentId?: string | null;
  isMaintenanceLead?: boolean;
};

interface RecipientOptions {
  users?: AssignmentUser[];
  departments?: Department[];
  assignedTo?: string | null;
  departmentId?: string | null;
}

interface AssignmentEmailInput extends RecipientOptions {
  title: string;
  link: string;
  type: AssignmentType;
  identifier?: string;
  description?: string;
  priority?: string;
  status?: string;
  dueDate?: string | Date | null;
  departmentName?: string;
  locationName?: string;
  location?: string;
  category?: string;
}

const resolveAssignedUser = (
  users: AssignmentUser[] | undefined,
  assignedTo: string | null | undefined
) =>
  users?.find(
    (user) =>
      user.id === assignedTo ||
      user.displayName === assignedTo ||
      user.email === assignedTo
  ) ?? null;

const resolveDepartmentId = (
  departments: Department[] | undefined,
  departmentIdOrName: string | null | undefined
) =>
  departments?.find(
    (dept) =>
      dept.id === departmentIdOrName ||
      dept.name === departmentIdOrName ||
      dept.code === departmentIdOrName
  )?.id ?? null;

export const collectRecipients = ({
  users,
  departments,
  assignedTo,
  departmentId,
}: RecipientOptions) => {
  const recipients = new Set<string>();
  const assignedUser = resolveAssignedUser(users, assignedTo);
  const resolvedDepartmentId =
    departmentId || resolveDepartmentId(departments, departmentId);

  if (assignedUser?.email) {
    recipients.add(assignedUser.email);
  }

  users?.forEach((user) => {
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

export const sendAssignmentEmail = async ({
  users,
  departments,
  assignedTo,
  departmentId,
  title,
  link,
  type,
  identifier,
  description,
  priority,
  status,
  dueDate,
  departmentName,
  locationName,
  location,
  category,
}: AssignmentEmailInput) => {
  const { recipients, assignedUser } = collectRecipients({
    users,
    departments,
    assignedTo,
    departmentId,
  });

  if (!recipients.length) {
    return;
  }

  const typeLabel = type === "tarea" ? "tarea" : "incidencia";
  const subject = `Nueva ${typeLabel} asignada: ${title}`;
  const safeTitle = title || "(sin título)";
  const safeDescription = description || "Sin descripción";
  const introLine = assignedUser
    ? `Has sido asignado a la ${typeLabel} ${safeTitle}.`
    : `Se ha asignado la ${typeLabel} ${safeTitle}.`;

  const formatDate = (value: AssignmentEmailInput["dueDate"]) => {
    if (!value) return "Sin fecha";
    const parsedDate =
      value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) return "Sin fecha";
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(parsedDate);
  };

  const departmentLabel = departmentName || location || "No especificado";
  const locationLabel = locationName || "No especificada";

  const details: { label: string; value: string }[] = [
    { label: "Título", value: safeTitle },
    { label: "ID", value: identifier || "No especificado" },
    { label: "Estado", value: status || "open" },
    { label: "Prioridad", value: priority || "media" },
    { label: "Fecha límite", value: formatDate(dueDate) },
    { label: "Departamento", value: departmentLabel },
    { label: "Ubicación", value: locationLabel },
    { label: "Categoría", value: category || "No especificada" },
    { label: "Descripción", value: safeDescription },
  ];

  const detailRows = details
    .map(
      (item) =>
        `<tr><td style="padding: 8px 12px; font-weight: 600; color: #111827;">${item.label}</td><td style="padding: 8px 12px; color: #374151;">${item.value}</td></tr>`
    )
    .join("");

  const text = [
    introLine,
    `Título: ${safeTitle}`,
    `Descripción: ${safeDescription}`,
    `ID: ${identifier || "No especificado"}`,
    `Estado: ${status || "open"}`,
    `Prioridad: ${priority || "media"}`,
    `Fecha límite: ${formatDate(dueDate)}`,
    `Departamento: ${departmentLabel}`,
    `Ubicación: ${locationLabel}`,
    `Categoría: ${category || "No especificada"}`,
    `Ver ${typeLabel}: ${link}`,
  ].join("\n");

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

  await sendEmailAction({
    to: recipients,
    subject,
    html,
    text
  });
};
