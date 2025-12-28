import type { Department, User } from "@/lib/firebase/models";
import { sendEmailAction } from "@/app/actions/email";

type AssignmentType = "tarea" | "incidencia";

interface RecipientOptions {
  users?: User[];
  departments?: Department[];
  assignedTo?: string | null;
  departmentId?: string | null;
}

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
    return;
  }

  const typeLabel = type === "tarea" ? "tarea" : "incidencia";
  const subject = `Nueva ${typeLabel} asignada: ${title}`;
  const introLine = assignedUser
    ? `Has sido asignado a la ${typeLabel} ${identifier ? `${identifier} - ` : ""}${title}.`
    : `Se ha asignado la ${typeLabel} ${identifier ? `${identifier} - ` : ""}${title}.`;

  const text = `${introLine}\n\nVer ${typeLabel}: ${link}`;
  
  const html = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #111;">${subject}</h2>
      <p style="font-size: 16px; color: #444;">${introLine}</p>
      <p><strong>${typeLabel === "tarea" ? "Tarea" : "Incidencia"}:</strong> ${title}</p>
      <div style="margin-top: 24px;">
        <a href="${link}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Ver ${typeLabel}
        </a>
      </div>
    </div>
  `;

  await sendEmailAction({
    to: recipients,
    subject,
    html,
    text
  });
};
