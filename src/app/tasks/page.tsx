"use client";


import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { useCollection } from "@/lib/firebase";
import { useUser } from "@/lib/firebase/auth/use-user";
import type { MaintenanceTask } from "@/types/maintenance-task";
import type { Department, OrganizationMember } from "@/lib/firebase/models";
import { getTaskPermissions, normalizeRole, type RBACUser } from "@/lib/rbac";
import { normalizeTaskStatus, taskStatusLabel } from "@/lib/status";
import { CalendarRange, ListFilter, MapPin, ShieldAlert } from "lucide-react";
import { orgCollectionPath } from "@/lib/organization";

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

const priorityOrder: Record<MaintenanceTask["priority"], number> = {
  alta: 2,
  media: 1,
  baja: 0,
};

export default function TasksPage() {
  const { user, profile: userProfile, role, organizationId, loading: userLoading, isLoaded } =
    useUser();
  const router = useRouter();

  const normalizedRole = normalizeRole(role ?? userProfile?.role);
  const rbacUser: RBACUser | null =
    userProfile ??
    (normalizedRole && organizationId
      ? {
          role: normalizedRole,
          organizationId,
          departmentId: undefined,
          locationId: undefined,
        }
      : null);

  const { data: tasks, loading } = useCollection<MaintenanceTask>(
    organizationId ? orgCollectionPath(organizationId, "tasks") : null
  );
  const { data: users, loading: usersLoading } = useCollection<OrganizationMember>(
    organizationId ? orgCollectionPath(organizationId, "members") : null
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, "departments") : null
  );
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [priorityFilter, setPriorityFilter] = useState<string>("todas");
  const [dateFilter, setDateFilter] = useState<string>("recientes");
  const [locationFilter, setLocationFilter] = useState<string>("todas");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 6;

  useEffect(() => {
    if (isLoaded && !user) {
      router.push("/login");
    }
  }, [isLoaded, router, user]);

  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};

    users.forEach((user) => {
      map[user.id] = user.displayName || user.email || user.id;
    });

    if (user) {
      map[user.uid] = userProfile?.displayName || user.email || user.uid;
    }

    return map;
  }, [user, userProfile?.displayName, users]);

  const filteredTasks = useMemo(() => {
    const visibleTasks = tasks.filter((task) =>
      getTaskPermissions(task, rbacUser, user?.uid ?? null).canView
    );

    const openTasks = visibleTasks.filter((task) => normalizeTaskStatus(task.status) !== "done");

    const sortedTasks = [...openTasks].sort((a, b) => {
      const aCreatedAt = a.createdAt?.toMillis?.()
        ?? a.createdAt?.toDate?.().getTime()
        ?? 0;
      const bCreatedAt = b.createdAt?.toMillis?.()
        ?? b.createdAt?.toDate?.().getTime()
        ?? 0;

      if (bCreatedAt !== aCreatedAt) {
        return dateFilter === "antiguas" ? aCreatedAt - bCreatedAt : bCreatedAt - aCreatedAt;
      }

      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    return sortedTasks.filter((task) => {
      const matchesStatus =
        statusFilter === "todas" || normalizeTaskStatus(task.status) === statusFilter;
      const matchesPriority =
        priorityFilter === "todas" || task.priority === priorityFilter;
      const taskDepartmentId =
        task.targetDepartmentId ?? task.originDepartmentId ?? task.departmentId ?? "";
      const matchesLocation =
        locationFilter === "todas" || taskDepartmentId === locationFilter;
      const assignedName =
        task.assignedTo && userNameMap[task.assignedTo]
          ? userNameMap[task.assignedTo]
          : "";
      const matchesQuery =
        !searchQuery ||
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        assignedName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        "no asignada".includes(searchQuery.toLowerCase());
      return matchesStatus && matchesPriority && matchesLocation && matchesQuery;
    });
  }, [dateFilter, locationFilter, priorityFilter, searchQuery, statusFilter, tasks, user, userNameMap, rbacUser]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / perPage));
  const paginated = filteredTasks.slice((page - 1) * perPage, page * perPage);
  if (!user || userLoading || !rbacUser || (!organizationId && normalizedRole !== "super_admin")) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const formatDueDate = (task: MaintenanceTask) => {
    const dueDate = task.dueDate as unknown as { toDate?: () => Date } | null;
    const date = dueDate?.toDate?.();
    if (date instanceof Date && !isNaN(date.getTime())) {
      return format(date, "PPP", { locale: es });
    }
    return "Sin fecha";
  };

  return (
    <AppShell
      title="Tareas"
      description="Lista de Tareas pendientes"
      action={
        <Button asChild>
          <Link href="/tasks/new">Nueva tarea</Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-4 rounded-lg border border-white/60 bg-sky-400/15 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Input
            placeholder="Buscar por título o responsable"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="md:max-w-xs"
          />
          <div className="flex flex-wrap gap-3">
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  statusFilter !== "todas"
                    ? "border-primary/70 bg-primary/10 text-primary"
                    : "bg-transparent"
                }`}
              >
                <SelectValue className="sr-only" />
                <ListFilter className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Estados</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos los estados</SelectItem>
                <SelectItem value="open">{taskStatusLabel("open")}</SelectItem>
                <SelectItem value="in_progress">{taskStatusLabel("in_progress")}</SelectItem>
                <SelectItem value="done">{taskStatusLabel("done")}</SelectItem>
                <SelectItem value="canceled">{taskStatusLabel("canceled")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={priorityFilter}
              onValueChange={(value) => {
                setPriorityFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  priorityFilter !== "todas"
                    ? "border-primary/70 bg-primary/10 text-primary"
                    : "bg-transparent"
                }`}
              >
                <SelectValue className="sr-only" />
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Prioridad</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las prioridades</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="media">Media</SelectItem>
                <SelectItem value="baja">Baja</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={dateFilter}
              onValueChange={(value) => {
                setDateFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  dateFilter !== "recientes"
                    ? "border-primary/70 bg-primary/10 text-primary"
                    : "bg-transparent"
                }`}
              >
                <SelectValue className="sr-only" />
                <CalendarRange className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Fecha</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recientes">Más recientes</SelectItem>
                <SelectItem value="antiguas">Más antiguas</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={locationFilter}
              onValueChange={(value) => {
                setLocationFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  locationFilter !== "todas"
                    ? "border-primary/70 bg-primary/10 text-primary"
                    : "bg-transparent"
                }`}
              >
                <SelectValue className="sr-only" />
                <MapPin className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Ubicaciones</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las ubicaciones</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3">
          {!loading && paginated.length === 0 && (
            <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground">
              No hay tareas que coincidan con los filtros.
            </div>
          )}
          {!loading &&
            paginated.map((task) => {
              const assignedToLabel =
                task.assignedTo && userNameMap[task.assignedTo]
                  ? userNameMap[task.assignedTo]
                  : "No asignada";
              return (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="block rounded-lg border border-white/20 bg-background p-4 shadow-sm transition hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-foreground">{task.title}</p>
                        <Badge variant="outline">{statusCopy[normalizeTaskStatus(task.status)]}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {task.description || task.category || "Sin descripción"}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Vence: {formatDueDate(task)}</span>
                        <span>Responsable: {assignedToLabel}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={task.priority === "alta" ? "destructive" : "secondary"}>
                        Prioridad {priorityCopy[task.priority]}
                      </Badge>
                      {task.category && (
                        <Badge variant="outline">{task.category}</Badge>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
        </div>

        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Mostrando {paginated.length} de {filteredTasks.length} tareas
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Anterior
            </Button>
            <span>
              Página {page} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
