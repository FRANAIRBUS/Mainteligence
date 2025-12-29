"use client";

import { useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { useCollection } from "@/lib/firebase";
import type { MaintenanceTask } from "@/types/maintenance-task";
import type { User } from "@/lib/firebase/models";

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

const priorityOrder: Record<MaintenanceTask["priority"], number> = {
  alta: 2,
  media: 1,
  baja: 0,
};

export default function TasksPage() {
  const router = useRouter();
  const { data: tasks, loading } = useCollection<MaintenanceTask>("tasks");
  const { data: users, loading: usersLoading } = useCollection<User>("users");
  const [statusFilter, setStatusFilter] = useState<string>("todas");
  const [priorityFilter, setPriorityFilter] = useState<string>("todas");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 6;

  const userNameMap = useMemo(() => {
    return users.reduce<Record<string, string>>((map, user) => {
      map[user.id] = user.displayName || user.email || user.id;
      return map;
    }, {});
  }, [users]);

  const filteredTasks = useMemo(() => {
    const sortedTasks = [...tasks].sort((a, b) => {
      const aCreatedAt = a.createdAt?.toMillis?.()
        ?? a.createdAt?.toDate?.().getTime()
        ?? 0;
      const bCreatedAt = b.createdAt?.toMillis?.()
        ?? b.createdAt?.toDate?.().getTime()
        ?? 0;

      if (bCreatedAt !== aCreatedAt) {
        return bCreatedAt - aCreatedAt;
      }

      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    return sortedTasks.filter((task) => {
      const matchesStatus =
        statusFilter === "todas" || task.status === statusFilter;
      const matchesPriority =
        priorityFilter === "todas" || task.priority === priorityFilter;
      const assignedName = task.assignedTo
        ? userNameMap[task.assignedTo] || task.assignedTo
        : "";
      const matchesQuery =
        !query ||
        task.title.toLowerCase().includes(query.toLowerCase()) ||
        assignedName.toLowerCase().includes(query.toLowerCase());
      return matchesStatus && matchesPriority && matchesQuery;
    });
  }, [priorityFilter, query, statusFilter, tasks, userNameMap]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / perPage));
  const paginated = filteredTasks.slice((page - 1) * perPage, page * perPage);
  const isLoading = loading || usersLoading;

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
      description="Lista de tareas de mantenimiento con filtros y edición."
      action={
        <Button asChild>
          <Link href="/tasks/new">Nueva tarea</Link>
        </Button>
      }
    >
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Input
            placeholder="Buscar por título o responsable"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
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
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todos los estados</SelectItem>
                <SelectItem value="pendiente">Pendientes</SelectItem>
                <SelectItem value="en_progreso">En progreso</SelectItem>
                <SelectItem value="completada">Completadas</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={priorityFilter}
              onValueChange={(value) => {
                setPriorityFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Prioridad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las prioridades</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="media">Media</SelectItem>
                <SelectItem value="baja">Baja</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarea</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Icons.spinner className="h-4 w-4 animate-spin" />
                      Cargando tareas...
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!loading && paginated.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No hay tareas que coincidan con los filtros.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                paginated.map((task) => (
                  <TableRow
                    key={task.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(`/tasks/${task.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <p>{task.title}</p>
                        {task.category && (
                          <p className="text-xs text-muted-foreground">{task.category}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{statusCopy[task.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={task.priority === "alta" ? "destructive" : "secondary"}>
                        {priorityCopy[task.priority]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDueDate(task)}
                    </TableCell>
                    <TableCell>
                      {task.assignedTo
                        ? userNameMap[task.assignedTo] || task.assignedTo
                        : "No asignada"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Link href={`/tasks/${task.id}`}>Ver</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            Mostrando {paginated.length} de {filteredTasks.length} tareas
          </p>
          <div className="flex items-center gap-2">
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
