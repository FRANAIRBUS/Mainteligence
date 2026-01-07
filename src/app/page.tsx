"use client";

import Link from "next/link";
import { format, isBefore, addDays, isWithinInterval } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CalendarDays, CheckCircle2, Inbox, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import { useCollection } from "@/lib/firebase";
import type { MaintenanceTask } from "@/types/maintenance-task";

const priorityLabel: Record<string, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

const statusLabel: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
};

export default function Home() {
  const { data: tasks, loading } = useCollection<MaintenanceTask>("tasks");

  const pendingTasks = tasks.filter((task) => task.status === "pendiente");
  const completedTasks = tasks.filter((task) => task.status === "completada");
  const dueSoonTasks = tasks.filter((task) => {
    if (!task.dueDate) return false;
    const date = task.dueDate.toDate();
    const now = new Date();
    return isBefore(date, addDays(now, 7)) && date >= now && task.status !== "completada";
  });

  const overdueTasks = tasks.filter((task) => {
    if (!task.dueDate) return false;
    return isBefore(task.dueDate.toDate(), new Date()) && task.status !== "completada";
  });

  const nextInspections = tasks
    .filter((task) => task.dueDate)
    .sort((a, b) => {
      if (!a.dueDate || !b.dueDate) return 0;
      return a.dueDate.toMillis() - b.dueDate.toMillis();
    })
    .slice(0, 5);

  return (
    <AppShell
      headerContent={
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h1 className="text-lg font-semibold leading-tight md:text-xl">Panel de Control</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <Link href="/tasks/new">Crear tarea</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/incidents">Crear incidencia</Link>
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardCard
          title="Tareas pendientes"
          value={pendingTasks.length}
          icon={<ListChecks className="h-4 w-4" />}
          subtitle="Acciones abiertas asignadas"
        />
        <DashboardCard
          title="Próximas 7 días"
          value={dueSoonTasks.length}
          icon={<CalendarDays className="h-4 w-4" />}
          subtitle="Vencen en la próxima semana"
        />
        <DashboardCard
          title="Atrasadas"
          value={overdueTasks.length}
          icon={<AlertTriangle className="h-4 w-4" />}
          subtitle="Requieren atención inmediata"
          highlight
        />
        <DashboardCard
          title="Completadas"
          value={completedTasks.length}
          icon={<CheckCircle2 className="h-4 w-4" />}
          subtitle="Cerradas este periodo"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xl">Próximas tareas</CardTitle>
            {loading && <Icons.spinner className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardHeader>
          <CardContent className="space-y-4">
            {!loading && nextInspections.length === 0 && (
              <EmptyState message="No hay tareas programadas" />
            )}
            {loading && (
              <div className="space-y-2">
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </div>
            )}
            {!loading &&
              nextInspections.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start justify-between rounded-lg border p-3"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {task.description || "Sin descripción"}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>
                        {task.dueDate
                          ? format(task.dueDate.toDate(), "PPP", { locale: es })
                          : "Sin fecha"}
                      </span>
                      {task.priority && (
                        <Badge variant="secondary">Prioridad {priorityLabel[task.priority]}</Badge>
                      )}
                    </div>
                  </div>
                  <Badge>{statusLabel[task.status]}</Badge>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xl">Incidencias pendientes</CardTitle>
            {overdueTasks.length > 0 && (
              <Badge variant="destructive">{overdueTasks.length} críticas</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && (
              <div className="space-y-2">
                <SkeletonRow />
                <SkeletonRow />
              </div>
            )}
            {!loading && overdueTasks.length === 0 && (
              <EmptyState message="No hay incidencias pendientes" />
            )}
            {!loading &&
              overdueTasks.slice(0, 4).map((task) => {
                const isOverdue = task.dueDate
                  ? isBefore(task.dueDate.toDate(), new Date())
                  : false;
                const isDueToday = task.dueDate
                  ? isWithinInterval(new Date(), {
                      start: task.dueDate.toDate(),
                      end: addDays(task.dueDate.toDate(), 1),
                    })
                  : false;
                return (
                  <div
                    key={task.id}
                    className="flex items-start justify-between rounded-lg border border-destructive/40 bg-destructive/5 p-3"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{task.title}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {task.description || "Sin descripción"}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="border-destructive text-destructive">
                          {isDueToday
                            ? "Vence hoy"
                            : isOverdue
                              ? "Atrasada"
                              : "Próxima"}
                        </Badge>
                        {task.dueDate && (
                          <span>
                            Fecha límite: {format(task.dueDate.toDate(), "PPP", { locale: es })}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="destructive">{priorityLabel[task.priority]}</Badge>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function DashboardCard({
  title,
  value,
  subtitle,
  icon,
  highlight,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-destructive/50" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={highlight ? "text-destructive" : "text-muted-foreground"}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      <Inbox className="h-8 w-8" />
      <p>{message}</p>
      <Button asChild variant="outline" size="sm">
        <Link href="/tasks/new">Añadir tarea</Link>
      </Button>
    </div>
  );
}

function SkeletonRow() {
  return <div className="h-14 rounded-md bg-muted" />;
}
