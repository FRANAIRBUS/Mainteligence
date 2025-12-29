"use client";

import { useMemo, useState } from "react";
import { Timestamp } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AppShell } from "@/components/app-shell";
import { TaskForm, type TaskFormValues } from "@/components/task-form";
import { Icons } from "@/components/icons";
import { useAuth, useCollection, useDoc, useFirestore, useUser } from "@/lib/firebase";
import { addTaskReport, updateTask } from "@/lib/firestore-tasks";
import type { Department, User } from "@/lib/firebase/models";
import type { MaintenanceTask, MaintenanceTaskInput } from "@/types/maintenance-task";
import { sendAssignmentEmail } from "@/lib/assignment-email";
import { useToast } from "@/hooks/use-toast";

export default function TaskDetailPage() {
  const firestore = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const taskId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { data: users } = useCollection<User>("users");
  const { data: departments } = useCollection<Department>("departments");
  const { user, loading: userLoading } = useUser();
  const { data: task, loading } = useDoc<MaintenanceTask>(
    taskId ? `tasks/${taskId}` : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const { toast } = useToast();

  const sortedReports = useMemo(() => {
    return [...(task?.reports ?? [])].sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() ?? new Date(0);
      const dateB = b.createdAt?.toDate?.() ?? new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [task?.reports]);

  const isTaskClosed = task?.status === "completada";

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

    if (!auth) {
      setErrorMessage("No se pudo inicializar la autenticación.");
      return;
    }

    if (userLoading) {
      setErrorMessage("Cargando sesión, intenta nuevamente en unos segundos.");
      return;
    }

    if (!user) {
      setErrorMessage("Inicia sesión para actualizar la tarea.");
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
      const previousAssignee = task.assignedTo?.trim() ?? "";

      await updateTask(firestore, auth, task.id, updates);

      if (updates.assignedTo && updates.assignedTo !== previousAssignee) {
        await sendAssignmentEmail({
          firestore,
          users,
          departments,
          assignedTo: updates.assignedTo,
          departmentId: updates.location,
          title: updates.title,
          description: updates.description,
          priority: updates.priority,
          status: updates.status,
          dueDate: values.dueDate || null,
          location: updates.location,
          category: updates.category,
          link: `${window.location.origin}/tasks/${task.id}`,
          type: "tarea",
        });
      }

      router.push("/tasks");
    } catch (error) {
      console.error("Error al actualizar la tarea", error);
      setErrorMessage("No se pudo guardar la tarea. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddReport = async () => {
    if (!firestore || !auth || !task?.id) {
      toast({
        title: "No se pudo registrar el informe",
        description: "Inténtalo nuevamente en unos segundos.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Inicia sesión",
        description: "Debes iniciar sesión para informar la tarea.",
        variant: "destructive",
      });
      return;
    }

    const description = reportDescription.trim();

    if (!description) {
      toast({
        title: "Agrega una descripción",
        description: "Escribe el detalle del informe antes de enviarlo.",
        variant: "destructive",
      });
      return;
    }

    setReportSubmitting(true);

    try {
      await addTaskReport(firestore, auth, task.id, {
        description,
        createdBy: user.uid,
      });
      setReportDescription("");
      toast({
        title: "Informe agregado",
        description: "Se registró el seguimiento de la tarea.",
      });
    } catch (error) {
      console.error("Error al agregar informe de tarea", error);
      toast({
        title: "No se pudo guardar",
        description: "Inténtalo nuevamente más tarde.",
        variant: "destructive",
      });
    } finally {
      setReportSubmitting(false);
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
      <div className="space-y-6">
        <TaskForm
          defaultValues={defaultValues}
          onSubmit={handleSubmit}
          submitting={submitting}
          errorMessage={errorMessage}
          users={users}
          departments={departments}
          submitLabel="Guardar cambios"
        />

        <Card>
          <CardHeader>
            <CardTitle>Informes</CardTitle>
            <CardDescription>
              Registra los avisos e informes asociados a la tarea. Cada envío se guardará con la fecha y hora.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {sortedReports.length ? (
                sortedReports.map((report, index) => {
                  const date = report.createdAt?.toDate?.() ?? new Date();
                  return (
                    <div key={index} className="rounded-lg border bg-muted/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{format(date, "PPPp", { locale: es })}</span>
                        {report.createdBy ? <span>Por {report.createdBy}</span> : null}
                      </div>
                      <p className="mt-2 text-sm whitespace-pre-line text-foreground">{report.description}</p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Aún no hay informes para esta tarea.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-report">Nuevo informe</Label>
              <Textarea
                id="task-report"
                placeholder="Describe el avance o el aviso que quieres registrar"
                value={reportDescription}
                onChange={(event) => setReportDescription(event.target.value)}
                disabled={reportSubmitting || isTaskClosed}
              />
              {isTaskClosed && (
                <p className="text-xs text-muted-foreground">
                  La tarea está completada. No se pueden agregar más informes.
                </p>
              )}
              <Button
                onClick={handleAddReport}
                disabled={reportSubmitting || isTaskClosed}
              >
                {reportSubmitting && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
                Informar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
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
