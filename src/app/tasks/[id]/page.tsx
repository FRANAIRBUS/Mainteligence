"use client";

import { useEffect, useMemo, useState, type ElementType } from "react";
import { Timestamp, serverTimestamp } from "firebase/firestore";
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
  DialogFooter,
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
import type { Department, OrganizationMember, Site, User } from "@/lib/firebase/models";
import type { MaintenanceTask, MaintenanceTaskInput } from "@/types/maintenance-task";
import { useToast } from "@/hooks/use-toast";
import { buildRbacUser, getTaskPermissions } from "@/lib/rbac";
import { normalizeTaskStatus, taskStatusLabel } from "@/lib/status";
import { sendAssignmentEmail } from "@/lib/assignment-email";
import { CalendarIcon, MapPin, User as UserIcon, ClipboardList, Tag } from "lucide-react";
import { orgCollectionPath, orgDocPath } from "@/lib/organization";

const statusCopy: Record<string, string> = {
  open: taskStatusLabel("open"),
  in_progress: taskStatusLabel("in_progress"),
  done: taskStatusLabel("done"),
  canceled: taskStatusLabel("canceled"),
  validated: taskStatusLabel("validated"),
  blocked: taskStatusLabel("blocked"),
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
  const { user, loading: userLoading, organizationId, role } = useUser();
  const { data: users, loading: usersLoading } = useCollection<OrganizationMember>(
    organizationId ? orgCollectionPath(organizationId, "members") : null
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, "departments") : null
  );
  const { data: locations } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, "sites") : null
  );
  const { data: userProfile, loading: profileLoading } = useDoc<User>(
    user ? `users/${user.uid}` : null
  );
  const { data: currentMember } = useDoc<OrganizationMember>(
    user && organizationId ? orgDocPath(organizationId, "members", user.uid) : null
  );
  const { data: task, loading } = useDoc<MaintenanceTask>(
    taskId && organizationId ? orgDocPath(organizationId, "tasks", taskId) : null
  );
  const assignedUser = useMemo(
    () => users.find((item) => item.id === task?.assignedTo) ?? null,
    [task?.assignedTo, users]
  );
  const createdByUser = useMemo(
    () => users.find((item) => item.id === task?.createdBy) ?? null,
    [task?.createdBy, users]
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeReasonError, setCloseReasonError] = useState("");
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

  const isTaskClosed = normalizeTaskStatus(task?.status) === "done";
  const taskDepartmentId =
    task?.targetDepartmentId ?? task?.originDepartmentId ?? task?.departmentId ?? "";
  const rbacUser = buildRbacUser({
    role,
    organizationId,
    member: currentMember,
    profile: userProfile ?? null,
  });
  const taskPermissions = task && rbacUser ? getTaskPermissions(task, rbacUser, user?.uid ?? null) : null;
  const canEditContent = !!taskPermissions?.canEditContent && !isTaskClosed;
  const canCloseTask = !!taskPermissions?.canMarkTaskComplete && !isTaskClosed;
  const isLoading = userLoading || profileLoading || loading || usersLoading;

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
    }

    if (!loading && !userLoading && !profileLoading && task && user && rbacUser) {
      const canView = getTaskPermissions(task, rbacUser, user.uid).canView;
      if (!canView) {
        router.push("/tasks");
      }
    }
  }, [
    loading,
    profileLoading,
    router,
    task,
    user,
    userLoading,
    rbacUser,
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
      taskType: task?.taskType ?? "maintenance",
      status: normalizeTaskStatus(task?.status) ?? "open",
      dueDate,
      assignedTo: isAssigneeValid ? task.assignedTo ?? "" : "",
      departmentId: taskDepartmentId,
      locationId: task?.locationId ?? "",
      category: task?.category ?? "",
    };
  }, [task, taskDepartmentId, users]);

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
    if (!taskDepartmentId) return "Sin departamento";
    return departments.find((item) => item.id === taskDepartmentId)?.name || taskDepartmentId;
  }, [departments, taskDepartmentId]);

  const handleSubmit = async (values: TaskFormValues) => {
    if (!firestore || !task?.id) {
      setErrorMessage("No se pudo actualizar la tarea en este momento.");
      return;
    }

    if (!auth) {
      setErrorMessage("No se pudo inicializar la autenticación.");
      return;
    }

    if (!canEditContent) {
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

    const trimmedAssignedTo = values.assignedTo.trim();
    const assignmentChanged = trimmedAssignedTo !== (task?.assignedTo ?? "");
    const assignmentDepartmentName = values.departmentId.trim()
      ? departments.find((dept) => dept.id === values.departmentId.trim())?.name ||
        values.departmentId.trim()
      : "";
    const assignmentLocationName = values.locationId.trim()
      ? locations?.find((location) => location.id === values.locationId.trim())?.name ||
        values.locationId.trim()
      : "";

    const updates: MaintenanceTaskInput & { assignmentEmailSource?: "client" | "server" } = {
      title: values.title.trim(),
      description: values.description.trim(),
      priority: values.priority,
      taskType: values.taskType,
      status: values.status,
      dueDate: values.dueDate ? Timestamp.fromDate(new Date(values.dueDate)) : null,
      assignedTo: trimmedAssignedTo,
      originDepartmentId: values.departmentId.trim(),
      targetDepartmentId: values.departmentId.trim(),
      locationId: values.locationId.trim() || null,
      category: values.category.trim(),
    };

    if (assignmentChanged && trimmedAssignedTo) {
      updates.assignmentEmailSource = "client";
    }

    try {
      const targetOrgId = task.organizationId ?? organizationId;
      if (!targetOrgId) {
        setErrorMessage("No se encontró la organización asociada a la tarea.");
        setSubmitting(false);
        return;
      }
      await updateTask(firestore, auth, targetOrgId, task.id, updates);

      if (assignmentChanged && trimmedAssignedTo) {
        const baseUrl =
          typeof window !== "undefined"
            ? window.location.origin
            : "https://multi.maintelligence.app";

        void (async () => {
          try {
            await sendAssignmentEmail({
              users,
              departments,
              assignedTo: trimmedAssignedTo,
              departmentId: values.departmentId.trim() || null,
              departmentName: assignmentDepartmentName,
              locationName: assignmentLocationName,
              title: values.title.trim(),
              link: `${baseUrl}/tasks/${task.id}`,
              type: "tarea",
              identifier: task.id,
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
      usersLoading ||
      assignmentChecked ||
      !canEditContent
    ) {
      return;
    }

    const assigneeExists = users.some((item) => item.id === task.assignedTo);

    if (assigneeExists) {
      setAssignmentChecked(true);
      return;
    }

    const unassign = async () => {
      try {
        const targetOrgId = task.organizationId ?? organizationId;
        if (!targetOrgId) return;
        await updateTask(firestore, auth, targetOrgId, task.id, { assignedTo: "" });
      } catch (error) {
        console.error("No se pudo desasignar la tarea automáticamente", error);
      } finally {
        setAssignmentChecked(true);
      }
    };

    void unassign();
  }, [
    usersLoading,
    assignmentChecked,
    auth,
    canEditContent,
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
      const targetOrgId = task.organizationId ?? organizationId;
      if (!targetOrgId) {
        toast({
          title: "No se pudo registrar el informe",
          description: "No se encontró la organización asociada a la tarea.",
          variant: "destructive",
        });
        setReportSubmitting(false);
        return;
      }
      await addTaskReport(firestore, auth, targetOrgId, task.id, {
        description,
        createdBy: user.uid,
      });
      setReportDescription("");
      setIsReportDialogOpen(false);
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

  const handleCloseTask = async (reason: string) => {
    if (!firestore || !auth || !task?.id) {
      toast({
        title: "No se pudo cerrar la tarea",
        description: "Inténtalo nuevamente en unos instantes. Faltan datos obligatorios.",
        variant: "destructive",
      });
      return;
    }

    if (!canCloseTask) {
      toast({
        title: "Permisos insuficientes",
        description: "No tienes permisos para cerrar esta tarea.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Inicia sesión",
        description: "Debes iniciar sesión para cerrar la tarea.",
        variant: "destructive",
      });
      return;
    }

    setCloseSubmitting(true);

    try {
      const targetOrgId = task.organizationId ?? organizationId;
      if (!targetOrgId) {
        toast({
          title: "No se pudo cerrar la tarea",
          description: "No se encontró la organización asociada a la tarea.",
          variant: "destructive",
        });
        setCloseSubmitting(false);
        return;
      }
      await updateTask(firestore, auth, targetOrgId, task.id, {
        status: "done",
        closedAt: serverTimestamp(),
        closedBy: user.uid,
        closedReason: reason,
      });

      setCloseReason("");
      setCloseReasonError("");
      setIsCloseDialogOpen(false);
      toast({
        title: "Tarea cerrada",
        description: "La tarea se marcó como completada.",
      });
    } catch (error) {
      console.error("Error al cerrar la tarea", error);
      toast({
        title: "No se pudo cerrar la tarea",
        description: "Vuelve a intentarlo en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setCloseSubmitting(false);
    }
  };

  const handleRequestClose = () => {
    if (!canCloseTask || isTaskClosed) {
      return;
    }
    setCloseReason("");
    setCloseReasonError("");
    setIsCloseDialogOpen(true);
  };

  const handleConfirmClose = async () => {
    const reason = closeReason.trim();

    if (!reason) {
      setCloseReasonError("Agrega un motivo de cierre antes de continuar.");
      toast({
        title: "Motivo requerido",
        description: "Debes indicar el motivo del cierre de la tarea.",
        variant: "destructive",
      });
      return;
    }

    await handleCloseTask(reason);
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
              <Badge variant="outline">{statusCopy[normalizeTaskStatus(task.status)]}</Badge>
              <Badge variant={task.priority === "alta" ? "destructive" : "secondary"}>
                {priorityCopy[task.priority]}
              </Badge>
            </div>
            {task.category && (
              <p className="text-sm text-muted-foreground">Categoría: {task.category}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/tasks">Volver</Link>
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

            <Card className="bg-transparent">
              <CardHeader>
                <CardTitle>Informes</CardTitle>
                <CardDescription className="text-foreground/70">
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
                        <div
                          key={index}
                          className="rounded-lg border border-white/80 bg-sky-300/20 p-3 text-foreground"
                        >
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => setIsReportDialogOpen(true)}
                      disabled={reportSubmitting || isTaskClosed || !userProfile}
                    >
                      {reportSubmitting && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
                      Informar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleRequestClose}
                      disabled={!canCloseTask || isTaskClosed || closeSubmitting}
                    >
                      {closeSubmitting && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
                      Cerrar tarea
                    </Button>
                  </div>
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
                {canEditContent && !isTaskClosed && (
                  <Button
                    onClick={() => setIsEditDialogOpen(true)}
                    className="w-full"
                  >
                    <Icons.edit className="mr-2 h-4 w-4" />
                    Editar tarea
                  </Button>
                )}
                <InfoRow
                  icon={ClipboardList}
                  label="Estado"
                  value={statusCopy[normalizeTaskStatus(task.status)]}
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
        <div className="rounded-lg border border-white/80 bg-card p-6 shadow-sm">
          {renderContent()}
        </div>
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
            locations={locations}
            submitLabel="Guardar cambios"
            onSuccess={() => setIsEditDialogOpen(false)}
            disabled={!canEditContent || isTaskClosed}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo informe</DialogTitle>
            <DialogDescription>
              Describe el informe o avance que deseas registrar para esta tarea.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="task-report">Detalle del informe</Label>
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
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsReportDialogOpen(false)}
              disabled={reportSubmitting}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAddReport}
              disabled={reportSubmitting || isTaskClosed}
            >
              {reportSubmitting && (
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
              )}
              Informar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar tarea</DialogTitle>
            <DialogDescription>
              Indica el motivo del cierre antes de marcar la tarea como completada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="task-close-reason">Motivo de cierre</Label>
            <Textarea
              id="task-close-reason"
              placeholder="Ej. Trabajo completado, tarea resuelta, etc."
              value={closeReason}
              onChange={(event) => {
                setCloseReason(event.target.value);
                if (closeReasonError) {
                  setCloseReasonError("");
                }
              }}
              disabled={closeSubmitting}
            />
            {closeReasonError && (
              <p className="text-xs text-destructive">{closeReasonError}</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsCloseDialogOpen(false)}
              disabled={closeSubmitting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmClose}
              disabled={closeSubmitting}
            >
              {closeSubmitting && (
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirmar cierre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
