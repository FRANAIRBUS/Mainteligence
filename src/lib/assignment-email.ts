import type { Department, User } from "@/lib/firebase/models";
import { sendEmailAction } from "@/app/actions/email";

type AssignmentType = "tarea" | "incidencia";

interface RecipientOptions {
  users?: User[];
  departments?: Department[];
  assignedTo?: string | null;
  departmentId?: string | null;
}

// Nota: Hemos eliminado 'firestore' de esta interfaz
interface AssignmentEmailInput extends RecipientOptions {
  title: string;
  link: string;
  type: AssignmentType;
  identifier?: string;
}

const resolveAssignedUser = (
  users: User[] | undefined,
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
    if (resolvedDepartmentId && user.departmentId === resolvedDepartmentId) {
      recipients.add(user.email);
    }

    if (user.isMaintenanceLead) {
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
}: AssignmentEmailInput) => {
  const { recipients, assignedUser } = collectRecipients({
    users,
    departments,
    assignedTo,
    departmentId,
  });

  if (!recipients.length) {
    console.log("No hay destinatarios para enviar correo.");
    return;
  }

  const typeLabel = type === "tarea" ? "tarea" : "incidencia";
  const subject = `Nueva ${typeLabel} asignada: ${title}`;
  const introLine = assignedUser
    ? `Has sido asignado a la ${typeLabel} ${identifier ? `${identifier} - ` : ""}${title}.`
    : `Se ha asignado la ${typeLabel} ${identifier ? `${identifier} - ` : ""}${title}.`;

  const text = `${introLine}\n\nVer ${typeLabel}: ${link}`;
  
  const html = `
    <div style="font-family: sans-serif; padding: 20px;">
      <h2>${subject}</h2>
      <p>${introLine}</p>
      <p><strong>${typeLabel === "tarea" ? "Tarea" : "Incidencia"}:</strong> ${title}</p>
      <div style="margin-top: 20px;">
        <a href="${link}" style="background-color: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
          Ver ${typeLabel}
        </a>
      </div>
    </div>
  `;

  // Llamada directa a la Server Action (sin pasar por Firestore)
  await sendEmailAction({
    to: recipients,
    subject,
    html,
    text
  });
};
