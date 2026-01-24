"use client";

import { useMemo, useState } from "react";
import { FirebaseError } from "firebase/app";
import { Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TaskForm, type TaskFormValues } from "@/components/task-form";
import { useAuth, useCollection, useDoc, useFirestore, useUser } from "@/lib/firebase";
import { createTask } from "@/lib/firestore-tasks";
import type { MaintenanceTaskInput } from "@/types/maintenance-task";
import type { Department, OrganizationMember, Site } from "@/lib/firebase/models";
import { sendAssignmentEmail } from "@/lib/assignment-email";
import { orgCollectionPath, orgDocPath } from "@/lib/organization";

const emptyValues: TaskFormValues = {
  title: "",
  description: "",
  priority: "media",
  taskType: "maintenance",
  status: "open",
  dueDate: "",
  assignedTo: "",
  departmentId: "",
  locationId: "",
  category: "",
};

export default function NewTaskPage() {
  const firestore = useFirestore();
  const auth = useAuth();
  const { user, loading: userLoading, organizationId, role } = useUser();
  const { data: users } = useCollection<OrganizationMember>(
    organizationId ? orgCollectionPath(organizationId, "members") : null
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, "departments") : null
  );
  const { data: locations } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, "sites") : null
  );
const { data: currentMember } = useDoc<OrganizationMember>(
  user && organizationId ? orgDocPath(organizationId, "members", user.uid) : null
);

  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

const assignableUsers = useMemo(() => {
  if (!role) return users;

  if (role === "super_admin" || role === "admin" || role === "mantenimiento") {
    return users;
  }

  if (!currentMember) return [];

  const actorDeptIds = [currentMember.departmentId, ...(currentMember.departmentIds ?? [])].filter(
    (value): value is string => Boolean(value)
  );
  const actorLocIds = [currentMember.locationId, ...(currentMember.locationIds ?? [])].filter(
    (value): value is string => Boolean(value)
  );

  const sharesAny = (a: string[], b: Array<string | null | undefined>) => {
    if (!a.length) return false;
    for (const item of b) {
      if (item && a.includes(item)) return true;
    }
    return false;
  };

  if (role === "jefe_departamento") {
    return users.filter((member) =>
      sharesAny(actorDeptIds, [member.departmentId, ...(member.departmentIds ?? [])])
    );
  }

  if (role === "jefe_ubicacion") {
    return users.filter((member) =>
      sharesAny(actorLocIds, [member.locationId, ...(member.locationIds ?? [])])
    );
  }

  return [];
}, [users, role, currentMember]);


  const handleSubmit = async (values: TaskFormValues) => {
    if (!firestore) {
      setErrorMessage("No se pudo inicializar la base de datos.");
      return;
    }

    if (!auth) {
      setErrorMessage("No se pudo inicializar la autenticación.");
      return;
    }

    if (userLoading) {
      setErrorMessage("Cargando sesión, intenta de nuevo en un momento.");
      return;
    }

    if (!user) {
      setErrorMessage(
        "No se pudo identificar al usuario actual. Inicia sesión nuevamente."
      );
      return;
    }

    if (!organizationId) {
      setErrorMessage(
        "No encontramos un organizationId válido. Vuelve a iniciar sesión o contáctanos."
      );
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const assignedTo = values.assignedTo.trim();
    const assignmentDepartmentName = values.departmentId.trim()
      ? departments?.find((dept) => dept.id === values.departmentId.trim())?.name ||
        values.departmentId.trim()
      : "";
    const assignmentLocationName = values.locationId.trim()
      ? locations?.find((location) => location.id === values.locationId.trim())?.name ||
        values.locationId.trim()
      : "";

    const payload: MaintenanceTaskInput & { assignmentEmailSource?: "client" | "server" } = {
      title: values.title.trim(),
      description: values.description.trim(),
      priority: values.priority,
      taskType: values.taskType,
      status: values.status,
      dueDate: values.dueDate ? Timestamp.fromDate(new Date(values.dueDate)) : null,
      assignedTo,
      originDepartmentId:
        currentMember?.departmentId ?? currentMember?.departmentIds?.[0] ?? values.departmentId.trim(),
      targetDepartmentId: values.departmentId.trim(),
      locationId: values.locationId.trim() || null,
      category: values.category.trim(),
      createdBy: user.uid,
      organizationId,
    };

    if (assignedTo) {
      payload.assignmentEmailSource = "client";
    }

    try {
      const id = await createTask(firestore, auth, payload);

      if (assignedTo) {
        const baseUrl =
          typeof window !== "undefined"
            ? window.location.origin
            : "https://multi.maintelligence.app";

        void (async () => {
          try {
            await sendAssignmentEmail({
              users,
              departments,
              assignedTo,
              departmentId: values.departmentId.trim() || null,
              departmentName: assignmentDepartmentName,
              locationName: assignmentLocationName,
              title: values.title.trim(),
              link: `${baseUrl}/tasks/${id}`,
              type: "tarea",
              identifier: id,
              description: values.description.trim(),
              priority: values.priority,
              status: values.status,
              dueDate: values.dueDate ? new Date(values.dueDate) : null,
              category: values.category.trim(),
            });
          } catch (error) {
            console.error("No se pudo enviar el email de asignación de tarea", error);
          }
        })();
      }

      router.push("/tasks");
    } catch (error) {
      console.error("Error al crear la tarea", error);

      if (error instanceof FirebaseError && error.code === "permission-denied") {
        setErrorMessage(
          "No tienes permisos para crear tareas. Verifica tu sesión e inténtalo de nuevo."
        );
        return;
      }

      const fallbackMessage =
        error instanceof Error && error.message
          ? error.message
          : "No se pudo crear la tarea. Inténtalo de nuevo.";

      setErrorMessage(fallbackMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Nueva tarea"
      description="Crear una tarea de mantenimiento en Firestore"
    >
      <div className="rounded-lg border border-white/80 bg-card p-6 shadow-sm">
        <TaskForm
          defaultValues={emptyValues}
          onSubmit={handleSubmit}
          submitting={submitting || userLoading}
          errorMessage={errorMessage}
          users={assignableUsers}
          departments={departments}
          locations={locations}
          submitLabel="Crear tarea"
        />
      </div>
    </AppShell>
  );
}
