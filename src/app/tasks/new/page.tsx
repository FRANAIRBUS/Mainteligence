"use client";

import { useState } from "react";
import { Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TaskForm, type TaskFormValues } from "@/components/task-form";
import { useCollection, useFirestore, useUser } from "@/lib/firebase";
import { createTask } from "@/lib/firestore-tasks";
import type { Department, User } from "@/lib/firebase/models";
import type { MaintenanceTaskInput } from "@/types/maintenance-task";
import { sendAssignmentEmail } from "@/lib/assignment-email";

const emptyValues: TaskFormValues = {
  title: "",
  description: "",
  priority: "media",
  status: "pendiente",
  dueDate: "",
  assignedTo: "",
  location: "",
  category: "",
};

export default function NewTaskPage() {
  const firestore = useFirestore();
  const { data: users } = useCollection<User>("users");
  const { data: departments } = useCollection<Department>("departments");
  const { user } = useUser();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (values: TaskFormValues) => {
    if (!firestore) {
      setErrorMessage("No se pudo inicializar la base de datos.");
      return;
    }

    if (!user) {
      setErrorMessage("No se pudo identificar al usuario actual.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const payload: MaintenanceTaskInput = {
      title: values.title.trim(),
      description: values.description.trim(),
      priority: values.priority,
      status: values.status,
      dueDate: values.dueDate ? Timestamp.fromDate(new Date(values.dueDate)) : null,
      assignedTo: values.assignedTo.trim(),
      location: values.location.trim(),
      category: values.category.trim(),
      createdBy: user.uid,
    };

    try {
      const id = await createTask(firestore, payload);

      if (values.assignedTo.trim()) {
        await sendAssignmentEmail({
          firestore,
          users,
          departments,
          assignedTo: values.assignedTo.trim(),
          departmentId: payload.location,
          title: payload.title,
          link: `${window.location.origin}/tasks/${id}`,
          type: "tarea",
        });
      }

      router.push("/tasks");
    } catch (error) {
      console.error("Error al crear la tarea", error);
      setErrorMessage("No se pudo crear la tarea. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Nueva tarea"
      description="Crear una tarea de mantenimiento en Firestore"
    >
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <TaskForm
          defaultValues={emptyValues}
          onSubmit={handleSubmit}
          submitting={submitting}
          errorMessage={errorMessage}
          users={users}
          departments={departments}
          submitLabel="Crear tarea"
        />
      </div>
    </AppShell>
  );
}
