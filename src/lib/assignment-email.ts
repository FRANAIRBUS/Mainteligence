import { FirebaseError } from "firebase/app";
import { addDoc, collection, type Firestore } from "firebase/firestore";
import type { Department, User } from "@/lib/firebase/models";
import { errorEmitter } from "@/lib/firebase/error-emitter";
import { FirestorePermissionError } from "@/lib/firebase/errors";

type AssignmentType = "tarea" | "incidencia";

interface RecipientOptions {
  users?: User[];
  departments?: Department[];
  assignedTo?: string | null;
  departmentId?: string | null;
}

interface AssignmentEmailInput extends RecipientOptions {
  firestore: Firestore;
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
  firestore,
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

  if (!recipients.length) return;

  const typeLabel = type === "tarea" ? "tarea" : "incidencia";
  const subject = `Nueva ${typeLabel} asignada: ${title}`;
  const introLine = assignedUser
    ? `Has sido asignado a la ${typeLabel} ${identifier ? `${identifier} - ` : ""}${title}.`
    : `Se ha asignado la ${typeLabel} ${identifier ? `${identifier} - ` : ""}${title}.`;

  const text = `${introLine}

Ver ${typeLabel}: ${link}`;
  const html = `
    <p>${introLine}</p>
    <p><strong>${typeLabel === "tarea" ? "Tarea" : "Incidencia"}:</strong> ${title}</p>
    <p><a href="${link}" target="_blank" rel="noopener noreferrer">Ver ${typeLabel}</a></p>
  `;

  const mailCollection = collection(firestore, "mail");

  try {
    await addDoc(mailCollection, {
      to: recipients,
      message: {
        subject,
        text,
        html,
      },
    });
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "permission-denied") {
      const permissionError = new FirestorePermissionError({
        path: mailCollection.path,
        operation: "create",
        requestResourceData: {
          to: recipients,
          message: { subject },
        },
      });

      errorEmitter.emit("permission-error", permissionError);
      return;
    }

    throw error;
  }
};
