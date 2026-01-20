"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icons } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import {
  useAuth,
  useCollection,
  useCollectionQuery,
  useFirestore,
  useUser,
} from "@/lib/firebase";
import type { MaintenanceTask } from "@/types/maintenance-task";
import type { Department, OrganizationMember } from "@/lib/firebase/models";
import { Timestamp, where } from "firebase/firestore";
import { createTask, updateTask } from "@/lib/firestore-tasks";
import { useToast } from "@/hooks/use-toast";
import { normalizeRole } from "@/lib/rbac";
import { orgCollectionPath } from "@/lib/organization";

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

type DateFilter = "todas" | "hoy" | "semana" | "mes";

type TaskWithId = MaintenanceTask & { id: string };

export default function ClosedTasksPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { user, profile, role, loading: userLoading, organizationId } = useUser();
  const { toast } = useToast();

  const normalizedRole = normalizeRole(role ?? profile?.role);
  const isSuperAdmin = normalizedRole === "super_admin";
  const canViewAll =
    normalizedRole === "admin" ||
    normalizedRole === "maintenance" ||
    isSuperAdmin;
  const isAdmin = normalizedRole === "admin" || isSuperAdmin;

  const tasksConstraints = useMemo(() => {
    if (!user) return null;
    // Cargamos todas las tareas completadas de la organización y filtramos por permisos en el cliente.
    return [where("status", "==", "completada")];
  }, [user]);

  const { data: tasks, loading } = useCollectionQuery<TaskWithId>(
    tasksConstraints && organizationId ? orgCollectionPath(organizationId, "tasks") : null,
    ...(tasksConstraints ?? [])
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, "departments") : null
  );
  const { data: users } = useCollection<OrganizationMember>(
    organizationId ? orgCollectionPath(organizationId, "members") : null
  );

  const currentMember = useMemo(() => {
    if (!user) return null;
    return (users ?? []).find((m) => m.id === user.uid) ?? null;
  }, [users, user]);

  const [dateFilter, setDateFilter] = useState<DateFilter>("todas");
  const [departmentFilter, setDepartmentFilter] = useState("todas");
  const [userFilter, setUserFilter] = useState("todas");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
    }
  }, [router, user, userLoading]);

  const filteredTasks = useMemo(() => {
    const now = new Date();
    const dateLimits: Record<DateFilter, Date | null> = {
      todas: null,
      hoy: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      semana: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      mes: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    };

    const scopeDepartments = Array.from(
      new Set(
        [
          currentMember?.departmentId ?? profile?.departmentId,
          ...((currentMember?.departmentIds ?? profile?.departmentIds ?? []) as string[]),
        ].filter((id): id is string => Boolean(id))
      )
    );

    const visibleTasks = canViewAll
      ? tasks
      : tasks.filter((task) => {
          if (task.createdBy === user?.uid) return true;
          if (task.assignedTo === user?.uid) return true;
          if (scopeDepartments.length > 0 && task.location) {
            return scopeDepartments.includes(task.location);
          }
          return false;
        });

    return [...visibleTasks]
      .filter((task) => {
        const createdAtDate = task.createdAt?.toDate?.() ?? null;
        if (dateLimits[dateFilter] && createdAtDate) {
          return createdAtDate >= (dateLimits[dateFilter] as Date);
        }
        return true;
      })
      .filter((task) =>
        departmentFilter === "todas" || task.location === departmentFilter
      )
      .filter((task) => {
        if (userFilter === "todas") return true;
        return task.createdBy === userFilter || task.assignedTo === userFilter;
      })
      .filter((task) => {
        if (!searchQuery) return true;
        return task.title.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .sort((a, b) => {
        const aCreatedAt = a.createdAt?.toMillis?.() ?? 0;
        const bCreatedAt = b.createdAt?.toMillis?.() ?? 0;
        return bCreatedAt - aCreatedAt;
      });
  }, [canViewAll, dateFilter, departmentFilter, searchQuery, tasks, user, userFilter, currentMember, profile]);

  const handleReopen = async (task: TaskWithId) => {
    if (!firestore || !auth || !user || !isAdmin) return;

    try {
      const targetOrgId = organizationId ?? task.organizationId;
      if (!targetOrgId) return;
      await updateTask(firestore, auth, targetOrgId, task.id, {
        status: "pendiente",
        reopened: true,
        reopenedBy: user.uid,
        reopenedAt: Timestamp.now(),
      });
      toast({ title: "Tarea reabierta", description: "Se movió la tarea a pendientes." });
    } catch (error) {
      console.error("No se pudo reabrir la tarea", error);
      toast({
        title: "Error al reabrir",
        description: "Inténtalo de nuevo en unos segundos.",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = async (task: TaskWithId) => {
    const targetOrgId = organizationId ?? task.organizationId;

    if (!firestore || !auth || !user || !isAdmin || !targetOrgId) return;

    try {
      await createTask(firestore, auth, {
        title: task.title,
        description: task.description,
        status: "pendiente",
        priority: task.priority,
        dueDate: task.dueDate ?? null,
        assignedTo: task.assignedTo ?? "",
        location: task.location ?? "",
        category: task.category ?? "",
        reopened: false,
        organizationId: targetOrgId,
      });
      toast({ title: "Tarea duplicada", description: "Se creó una nueva tarea a partir de la cerrada." });
    } catch (error) {
      console.error("No se pudo duplicar la tarea", error);
      toast({
        title: "Error al duplicar",
        description: "Revisa tu conexión e inténtalo nuevamente.",
        variant: "destructive",
      });
    }
  };

  const isLoading = loading || userLoading;
  return (
    <AppShell
      title="Tareas cerradas"
      description="Historial de tareas completadas con filtros avanzados."
    >
      <div className="flex flex-col gap-4 rounded-lg border border-white/60 bg-sky-400/15 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Input
            placeholder="Buscar por título"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="md:max-w-xs"
          />
          <div className="flex flex-wrap gap-3">
            <Select value={dateFilter} onValueChange={(value: DateFilter) => setDateFilter(value)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Fecha" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todo el historial</SelectItem>
                <SelectItem value="hoy">Hoy</SelectItem>
                <SelectItem value="semana">Últimos 7 días</SelectItem>
                <SelectItem value="mes">Últimos 30 días</SelectItem>
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Departamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos los departamentos</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos los usuarios</SelectItem>
                {users.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.displayName || item.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {isLoading && (
            <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-white/20 bg-background text-muted-foreground sm:col-span-2 xl:col-span-3">
              <Icons.spinner className="h-4 w-4 animate-spin" /> Cargando tareas...
            </div>
          )}
          {!isLoading && filteredTasks.length === 0 && (
            <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground sm:col-span-2 xl:col-span-3">
              No se encontraron tareas cerradas con esos filtros.
            </div>
          )}
          {!isLoading &&
            filteredTasks.map((task) => {
              const departmentLabel =
                departments.find((dept) => dept.id === task.location)?.name || "Sin departamento";
              const createdAtLabel = task.createdAt?.toDate
                ? format(task.createdAt.toDate(), "dd/MM/yyyy", { locale: es })
                : "Sin fecha";
              return (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/tasks/${task.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/tasks/${task.id}`);
                    }
                  }}
                  className="block rounded-lg border border-white/20 bg-background p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-foreground">{task.title}</p>
                        <Badge variant="outline">{statusCopy[task.status]}</Badge>
                        {task.reopened && (
                          <Badge variant="outline" className="text-xs">
                            Reabierta
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Departamento: {departmentLabel}</span>
                        <span>Creada: {createdAtLabel}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={task.priority === "alta" ? "destructive" : "secondary"}>
                        Prioridad {priorityCopy[task.priority]}
                      </Badge>
                      {isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleReopen(task);
                            }}
                          >
                            Reabrir
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDuplicate(task);
                            }}
                          >
                            Duplicar
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </AppShell>
  );
}
