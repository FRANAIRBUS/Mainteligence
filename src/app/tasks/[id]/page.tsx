"use client";

import { useMemo, useState } from "react";
import { Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { TaskForm, type TaskFormValues } from "@/components/task-form";
import { Icons } from "@/components/icons";
import { useDoc, useFirestore } from "@/lib/firebase";
import { updateTask } from "@/lib/firestore-tasks";
import type { MaintenanceTask, MaintenanceTaskInput } from "@/types/maintenance-task";

interface TaskPageProps {
  params: { id: string };
}

export default function TaskDetailPage({ params }: TaskPageProps) {
  const firestore = useFirestore();
  const router = useRouter();
  const { data: task, loading } = useDoc<MaintenanceTask>(
    params.id ? `tasks/${params.id}` : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const defaultValues = useMemo<TaskFormValues>(() => {
    return {
      title: task?.title ?? "",
      description: task?.description ?? "",
      priority: task?.priority ?? "media",
      status: task?.status ?? "pendiente",
      dueDate: task?.dueDate ? task.dueDate.toDate().toISOString().slice(0, 10) : "",
      assignedTo: task?.assignedTo ?? "",
      location: task?.location ?? "",
      category: task?.category ?? "",
    };
  }, [task]);

  const handleSubmit = async (values: TaskFormValues) => {
    if (!firestore || !task?.id) {
      setErrorMessage("No se pudo actualizar la tarea en este momento.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const updates: MaintenanceTaskInput = {
      title: values.title.trim(),
      description: values.description.trim(),
      priority: values.priority,
      status: values.status,
      dueDate: values.dueDate ? Timestamp.fromDate(new Date(values.dueDate)) : null,
      assignedTo: values.assignedTo.trim(),
      location: values.location.trim(),
      category: values.category.trim(),
    };

    try {
      await updateTask(firestore, task.id, updates);
      router.push("/tasks");
    } catch (error) {
      console.error("Error al actualizar la tarea", error);
      setErrorMessage("No se pudo guardar la tarea. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icons.spinner className="h-4 w-4 animate-spin" /> Cargando tarea...
        </div>
      );
    }

    if (!task) {
      return (
        <Alert variant="destructive">
          <AlertTitle>No encontrada</AlertTitle>
          <AlertDescription>
            No pudimos localizar esta tarea. Revisa el enlace o crea una nueva.
          </AlertDescription>
          <div className="mt-3">
            <Button asChild>
              <Link href="/tasks/new">Crear tarea</Link>
            </Button>
          </div>
        </Alert>
      );
    }

    return (
      <TaskForm
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        submitting={submitting}
        errorMessage={errorMessage}
        submitLabel="Guardar cambios"
      />
    );
  };

  return (
    <AppShell
      title={task?.title || "Editar tarea"}
      description="Actualiza el estado y los detalles de la tarea."
      action={
        !loading && task ? (
          <Button variant="outline" asChild>
            <Link href="/tasks">Volver</Link>
          </Button>
        ) : null
      }
    >
      <div className="rounded-lg border bg-card p-6 shadow-sm">{renderContent()}</div>
    </AppShell>
  );
}
