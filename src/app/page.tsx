"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { format, isBefore, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CalendarDays, CheckCircle2, Inbox, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  normalizeTaskStatus,
  normalizeTicketStatus,
  taskStatusLabel,
  ticketStatusLabel,
} from "@/lib/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { AppShell } from "@/components/app-shell";
import { useCollection, useDoc, useUser } from "@/lib/firebase";
import type { OrganizationMember, Ticket } from "@/lib/firebase/models";
import type { MaintenanceTask } from "@/types/maintenance-task";
import { orgCollectionPath, orgDocPath } from "@/lib/organization";
import { buildRbacUser, getTaskPermissions, getTicketPermissions } from "@/lib/rbac";
import { useScopedTasks, useScopedTickets } from "@/lib/scoped-collections";

const priorityLabel: Record<string, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

const statusLabel: Record<string, string> = {
  open: taskStatusLabel("open"),
  in_progress: taskStatusLabel("in_progress"),
  done: taskStatusLabel("done"),
  canceled: taskStatusLabel("canceled"),
  validated: taskStatusLabel("validated"),
  blocked: taskStatusLabel("blocked"),
};

const incidentPriorityOrder: Record<Ticket["priority"], number> = {
  Crítica: 3,
  Alta: 2,
  Media: 1,
  Baja: 0,
};

type FirestoreDateValue =
  | {
      toDate?: () => Date;
      toMillis?: () => number;
    }
  | Date
  | string
  | number
  | null
  | undefined;

const toDateValue = (value: FirestoreDateValue): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  const maybeTimestamp = value as { toDate?: () => Date; toMillis?: () => number };
  if (typeof maybeTimestamp.toDate === "function") {
    const date = maybeTimestamp.toDate();
    return date instanceof Date && !isNaN(date.getTime()) ? date : null;
  }
  if (typeof maybeTimestamp.toMillis === "function") {
    const date = new Date(maybeTimestamp.toMillis());
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const toMillisValue = (value: FirestoreDateValue): number => {
  const date = toDateValue(value);
  return date ? date.getTime() : 0;
};

export default function Home() {
  const {
    user,
    profile: userProfile,
    activeMembership,
    organizationId,
    role,
    isRoot,
    loading: userLoading,
  } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!userLoading && !user) {
      router.replace("/login");
    }
    if (!userLoading && user && !organizationId && !isRoot) {
      router.replace("/onboarding");
    }
  }, [userLoading, user, organizationId, isRoot, router]);
  const { data: currentMember } = useDoc<OrganizationMember>(
    user && organizationId ? orgDocPath(organizationId, "members", user.uid) : null
  );

  const organizationLabel =
    activeMembership?.organizationName ??
    activeMembership?.organizationId ??
    organizationId ??
    "Organización";

  const rbacUser = buildRbacUser({
    role,
    organizationId,
    member: currentMember,
    profile: userProfile ?? null,
  });

  const { data: tasks, loading } = useScopedTasks({
    organizationId,
    rbacUser,
    uid: user?.uid ?? null,
  });
  const { data: tickets = [], loading: ticketsLoading } = useScopedTickets({
    organizationId,
    rbacUser,
    uid: user?.uid ?? null,
  });

  const visibleTasks = rbacUser
    ? tasks.filter((task) => getTaskPermissions(task, rbacUser, user?.uid ?? null).canView)
    : tasks;
  const visibleTickets = rbacUser
    ? tickets.filter((ticket) => getTicketPermissions(ticket, rbacUser, user?.uid ?? null).canView)
    : tickets;

  const pendingTasks = visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "open");
  const completedTasks = visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "done");
  const dueSoonTasks = visibleTasks.filter((task) => {
    if (!task.dueDate) return false;
    const date = toDateValue(task.dueDate);
    if (!date) return false;
    const now = new Date();
    return isBefore(date, addDays(now, 7)) && date >= now && normalizeTaskStatus(task.status) !== "done";
  });

  const overdueTasks = visibleTasks.filter((task) => {
    if (!task.dueDate) return false;
    const date = toDateValue(task.dueDate);
    if (!date) return false;
    return isBefore(date, new Date()) && normalizeTaskStatus(task.status) !== "done";
  });

  const nextInspections = visibleTasks
    .filter((task) => task.dueDate)
    .sort((a, b) => {
      if (!a.dueDate || !b.dueDate) return 0;
      return toMillisValue(a.dueDate) - toMillisValue(b.dueDate);
    })
    .slice(0, 5);

  const openTickets = visibleTickets.filter(
    (ticket) => normalizeTicketStatus(ticket.status) !== "resolved"
  );
  const criticalTickets = openTickets.filter((ticket) => ticket.priority === "Crítica");
  const pendingIncidents = [...openTickets].sort((a, b) => {
    if (incidentPriorityOrder[b.priority] !== incidentPriorityOrder[a.priority]) {
      return incidentPriorityOrder[b.priority] - incidentPriorityOrder[a.priority];
    }

    const aCreatedAt = toMillisValue(a.createdAt);
    const bCreatedAt = toMillisValue(b.createdAt);

    return bCreatedAt - aCreatedAt;
  });

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
              <Link href="/incidents/new">Crear incidencia</Link>
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="border-white/80 bg-sky-300/20">
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
                <Link
                  key={task.id}
                  href={task.id ? `/tasks/${task.id}` : "/tasks"}
                  className="block"
                >
                  <div className="flex items-start justify-between rounded-lg border border-white/60 bg-background p-3 transition hover:bg-muted/40">
                    <div className="space-y-1">
                      <p className="font-medium">{task.title}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {task.description || "Sin descripción"}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>
                          {(() => {
                            const dueDate = toDateValue(task.dueDate);
                            return dueDate ? format(dueDate, "PPP", { locale: es }) : "Sin fecha";
                          })()}
                        </span>
                        {task.priority && (
                          <Badge variant="secondary">Prioridad {priorityLabel[task.priority]}</Badge>
                        )}
                      </div>
                    </div>
                    <Badge>{statusLabel[normalizeTaskStatus(task.status)]}</Badge>
                  </div>
                </Link>
              ))}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-sky-300/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xl">Incidencias pendientes</CardTitle>
            {criticalTickets.length > 0 && (
              <Badge variant="destructive">{criticalTickets.length} críticas</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {ticketsLoading && (
              <div className="space-y-2">
                <SkeletonRow />
                <SkeletonRow />
              </div>
            )}
            {!ticketsLoading && pendingIncidents.length === 0 && (
              <EmptyState message="No hay incidencias pendientes" />
            )}
            {!ticketsLoading &&
              pendingIncidents.slice(0, 4).map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/incidents/${ticket.id}`}
                  className="block"
                >
                  <div className="flex items-start justify-between rounded-lg border border-destructive/80 bg-destructive/30 p-3 transition hover:bg-destructive/40">
                    <div className="space-y-1">
                      <p className="font-medium">{ticket.title}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {ticket.description || "Sin descripción"}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="border-destructive text-destructive">
                          {ticketStatusLabel(ticket.status)}
                        </Badge>
                        {(() => {
                          const createdAt = toDateValue(ticket.createdAt);
                          if (!createdAt) return null;
                          return (
                            <span>
                              Creada: {format(createdAt, "PPP", { locale: es })}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <Badge variant="destructive">{ticket.priority}</Badge>
                  </div>
                </Link>
              ))}
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
    <Card
      className="border-white/80 bg-sky-300/20"
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={highlight ? "text-white" : "text-muted-foreground"}>{icon}</div>
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
