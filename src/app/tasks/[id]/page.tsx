"use client";

import { useEffect, useMemo, useState, type ElementType } from "react";
import { Timestamp } from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CalendarIcon, MapPin, User as UserIcon, ClipboardList, Tag } from "lucide-react";

const statusCopy: Record<MaintenanceTask["status"], string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
};

const priorityCopy: Record<MaintenanceTask["priority"], string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

function InfoRow({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-base font-semibold text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default function TaskDetailPage() {
  const firestore = useFirestore();
  const auth = useAuth();
  const router = useRouter();
  const params = useParams();
  const taskId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { data: users } = useCollection<User>("users");
  const { data: departments } = useCollection<Department>("departments");
  const { user, loading: userLoading } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(
    user ? `users/${user.uid}` : null
  );
  const { data: task, loading } = useDoc<MaintenanceTask>(taskId ? `tasks/${taskId}` : null);
  const { data: assignedUser, loading: assignedUserLoading } = useDoc<User>(
    task?.assignedTo ? `users/${task.assignedTo}` : null
  );
  const { data: createdByUser } = useDoc<User>(task ? `users/${task.createdBy}` : null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [assignmentChecked, setAssignmentChecked] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();

  const sortedReports = useMemo(() => {
    return [...(task?.reports ?? [])].sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() ?? new Date(0);
      const dateB = b.createdAt?.toDate?.() ?? new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [task?.reports]);

  const isTaskClosed = task?.status === "completada";
  const isPrivileged =
    userProfile?.role === "admin" || userProfile?.role === "mantenimiento";
  const canEdit = isPrivileged || (!!task && task.createdBy === user?.uid);
  const isLoading = userLoading || profileLoading || loading || assignedUserLoading;

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
    }

    if (!loading && !userLoading && !profileLoading && task && user && userProfile) {
      const canView = isPrivileged || task.createdBy === user.uid;
      if (!canView) {
        router.push("/tasks");
      }
    }
  }, [
    isPrivileged,
    loading,
    profileLoading,
    router,
    task,
    user,
    userLoading,
    userProfile,
  ]);

  const defaultValues = useMemo<TaskFormValues>(() => {
    const dueDate =
      task?.dueDate && typeof task.dueDate.toDate === "function"
        ? task.dueDate.toDate().toISOString().slice(0, 10)
        : "";

    const isAssigneeValid = task?.assignedTo
      ? users.some((item) => item.id === task.assignedTo)
      : false;

    return {
      title: task?.title ?? "",
      description: task?.description ?? "",
      priority: task?.priority ?? "media",
      status: task?.status ?? "pendiente",
      dueDate,
      assignedTo: isAssigneeValid ? task.assignedTo : "",
      location: task?.location ?? "",
      category: task?.category ?? "",
    };
  }, [task, users]);

  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};

    users.forEach((item) => {
      map[item.id] = item.displayName || item.email || item.id;
    });

    if (user && userProfile) {
      map[user.uid] = userProfile.displayName || user.email || user.uid;
    }

    if (assignedUser) {
      map[assignedUser.id] =
        assignedUser.displayName || assignedUser.email || assignedUser.id;
    }

    if (createdByUser) {
      map[createdByUser.id] =
        createdByUser.displayName || createdByUser.email || createdByUser.id;
    }

    return map;
  }, [assignedUser, createdByUser, user, userProfile, users]);

  const assignedUserName = useMemo(() => {
    if (!task?.assignedTo) return "No asignada";
    const name =
      userNameMap[task.assignedTo] || assignedUser?.displayName || assignedUser?.email;
    return name ?? "No asignada";
  }, [assignedUser?.displayName, assignedUser?.email, task?.assignedTo, userNameMap]);

  const departmentName = useMemo(() => {
    if (!task?.location) return "Sin departamento";
    return departments.find((item) => item.id === task.location)?.name || task.location;
  }, [departments, task?.location]);

  const handleSubmit = async (values: TaskFormValues) => {
    if (!firestore || !task?.id) {
      setErrorMessage("No se pudo actualizar la tarea en este momento.");
      return;
    }

    if (!auth) {
      setErrorMessage("No se pudo inicializar la autenticación.");
      return;
    }

    if (!canEdit) {
      setErrorMessage("No tienes permiso para editar esta tarea.");
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

      toast({
        title: "Tarea actualizada",
        description: "Se guardaron los cambios de la tarea.",
      });
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error("Error al actualizar la tarea", error);
      setErrorMessage("No se pudo guardar la tarea. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (
      !firestore ||
      !auth ||
      !task?.id ||
      !task.assignedTo ||
      assignedUserLoading ||
      assignmentChecked ||
      !canEdit
    ) {
      return;
    }

    const assigneeExists = users.some((item) => item.id === task.assignedTo);

    if (assigneeExists || assignedUser) {
      setAssignmentChecked(true);
      return;
    }

    const unassign = async () => {
      try {
        await updateTask(firestore, auth, task.id, { assignedTo: "" });
      } catch (error) {
        console.error("No se pudo desasignar la tarea automáticamente", error);
      } finally {
        setAssignmentChecked(true);
      }
    };

    void unassign();
  }, [
    assignedUser,
    assignedUserLoading,
    assignmentChecked,
    auth,
    canEdit,
    firestore,
    task,
    users,
  ]);

  const handleAddReport = async () => {
    if (!firestore || !auth || !task?.id) {
      toast({
        title: "No se pudo registrar el informe",
        description: "Inténtalo nuevamente en unos segundos.",
        variant: "destructive",
      });
      return;
    }

    if (!userProfile) {
      toast({
        title: "No tienes permiso",
        description: "Debes iniciar sesión para informar esta tarea.",
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
    if (isLoading || !userProfile) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icons.spinner className="h-4 w-4 animate-spin" /> Cargando tarea...
        </div>
      );
    }

    if (!task) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Tarea no encontrada</CardTitle>
            <CardDescription>No pudimos localizar esta tarea. Revisa el enlace o crea una nueva.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/tasks/new">Crear tarea</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-headline text-2xl font-bold tracking-tight md:text-3xl">{task.title}</h1>
              <Badge variant="outline">{statusCopy[task.status]}</Badge>
              <Badge variant={task.priority === "alta" ? "destructive" : "secondary"}>
                {priorityCopy[task.priority]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">ID de Tarea: {task.id}</p>
            {task.category && (
              <p className="text-sm text-muted-foreground">Categoría: {task.category}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/tasks">Volver</Link>
            </Button>
            <Button onClick={() => setIsEditDialogOpen(true)} disabled={!canEdit}>
              <Icons.edit className="mr-2 h-4 w-4" />
              Editar tarea
            </Button>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-6 md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Descripción de la tarea</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground/80 whitespace-pre-line">
                  {task.description || "Sin descripción"}
                </p>
              </CardContent>
            </Card>

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
                      const reporterName = report.createdBy
                        ? userNameMap[report.createdBy] || report.createdBy
                        : "";

                      return (
                        <div key={index} className="rounded-lg border bg-muted/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{format(date, "PPPp", { locale: es })}</span>
                            {reporterName ? <span>Por {reporterName}</span> : null}
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
                    disabled={reportSubmitting || isTaskClosed || !userProfile}
                  >
                    {reportSubmitting && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
                    Informar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 md:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Detalles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <InfoRow
                  icon={ClipboardList}
                  label="Estado"
                  value={statusCopy[task.status]}
                />
                <InfoRow
                  icon={Tag}
                  label="Prioridad"
                  value={priorityCopy[task.priority]}
                />
                <InfoRow
                  icon={CalendarIcon}
                  label="Fecha límite"
                  value={
                    task.dueDate?.toDate
                      ? format(task.dueDate.toDate(), "dd/MM/yyyy")
                      : "Sin fecha"
                  }
                />
                <InfoRow icon={UserIcon} label="Responsable" value={assignedUserName} />
                <InfoRow icon={MapPin} label="Departamento" value={departmentName} />
                <InfoRow
                  icon={CalendarIcon}
                  label="Creada"
                  value={
                    task.createdAt?.toDate
                      ? format(task.createdAt.toDate(), "dd/MM/yyyy HH:mm")
                      : "Sin fecha"
                  }
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AppShell
        title={task?.title || "Detalle de tarea"}
        description="Consulta y gestiona la tarea, agrega informes y edita la información."
      >
        <div className="rounded-lg border bg-card p-6 shadow-sm">{renderContent()}</div>
      </AppShell>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar tarea</DialogTitle>
            <DialogDescription>Actualiza el estado y los detalles de la tarea.</DialogDescription>
          </DialogHeader>
          <TaskForm
            defaultValues={defaultValues}
            onSubmit={handleSubmit}
            submitting={submitting}
            errorMessage={errorMessage}
            users={users}
            departments={departments}
            submitLabel="Guardar cambios"
            onSuccess={() => setIsEditDialogOpen(false)}
            disabled={!canEdit}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
