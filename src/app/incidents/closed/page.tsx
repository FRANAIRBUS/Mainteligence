"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  useCollection,
  useCollectionQuery,
  useFirestore,
  useUser,
} from "@/lib/firebase";
import type { Department, Site, Ticket, OrganizationMember } from "@/lib/firebase/models";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { orgCollectionPath, orgDocPath } from "@/lib/organization";
import { format } from "date-fns";
import { getTicketPermissions, normalizeRole } from "@/lib/rbac";
import { normalizeTicketStatus, ticketStatusLabel } from "@/lib/status";

const statusLabels: Record<string, string> = {
  new: ticketStatusLabel("new"),
  in_progress: ticketStatusLabel("in_progress"),
  resolved: ticketStatusLabel("resolved"),
  canceled: ticketStatusLabel("canceled"),
};

type DateFilter = "todas" | "hoy" | "semana" | "mes";

export default function ClosedIncidentsPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user, profile: userProfile, organizationId, loading: userLoading } = useUser();
  const { toast } = useToast();

  const normalizedRole = normalizeRole(userProfile?.role);
  const isSuperAdmin = normalizedRole === "super_admin";
  const isAdmin = normalizedRole === "admin" || isSuperAdmin;

  const ticketsConstraints = useMemo(() => {
    if (userLoading || !user || !userProfile) return null;
    // Cargamos el histórico de la organización y filtramos por permisos en el cliente.
    return [where("status", "in", ["resolved", "Resuelta", "Cerrada"])];
  }, [user, userLoading, userProfile]);

  const { data: tickets, loading } = useCollectionQuery<Ticket>(
    ticketsConstraints && organizationId ? orgCollectionPath(organizationId, "tickets") : null,
    ...(ticketsConstraints ?? [])
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, "departments") : null
  );
  const { data: sites } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, "sites") : null
  );
  const { data: users } = useCollection<OrganizationMember>(
    organizationId ? orgCollectionPath(organizationId, "members") : null
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("todas");
  const [departmentFilter, setDepartmentFilter] = useState("todas");
  const [siteFilter, setSiteFilter] = useState("todas");
  const [userFilter, setUserFilter] = useState("todas");

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
    }
  }, [userLoading, router, user]);

  const filteredTickets = useMemo(() => {
    const now = new Date();
    const dateLimits: Record<DateFilter, Date | null> = {
      todas: null,
      hoy: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      semana: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      mes: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    };

    const visibleTickets = tickets.filter((ticket) =>
      getTicketPermissions(ticket, userProfile ?? null, user?.uid ?? null).canView
    );

    return [...visibleTickets]
      .filter((ticket) => {
        if (dateLimits[dateFilter] && ticket.createdAt?.toDate) {
          return ticket.createdAt.toDate() >= (dateLimits[dateFilter] as Date);
        }
        return true;
      })
      .filter((ticket) => {
        if (departmentFilter === "todas") return true;
        const ticketDepartmentId = ticket.targetDepartmentId ?? ticket.originDepartmentId ?? null;
        return ticketDepartmentId === departmentFilter;
      })
      .filter((ticket) => {
        const ticketLocationId = ticket.locationId ?? null;
        return siteFilter === "todas" ? true : ticketLocationId === siteFilter;
      })
      .filter((ticket) => {
        if (userFilter === "todas") return true;
        return ticket.createdBy === userFilter || ticket.assignedTo === userFilter;
      })
      .filter((ticket) => {
        if (!searchQuery) return true;
        return ticket.title.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .sort((a, b) => {
        const aDate = a.createdAt?.toMillis?.() ?? 0;
        const bDate = b.createdAt?.toMillis?.() ?? 0;
        return bDate - aDate;
      });
  }, [
    dateFilter,
    departmentFilter,
    searchQuery,
    siteFilter,
    tickets,
    user,
    userFilter,
    userProfile,
  ]);

  const handleReopen = async (ticket: Ticket) => {
    if (!firestore || !isAdmin || !user || !organizationId) return;

    if (ticket.organizationId !== organizationId) {
      toast({
        variant: "destructive",
        title: "Organización inválida",
        description: "No puedes modificar incidencias de otra organización.",
      });
      return;
    }

    try {
      await updateDoc(doc(firestore, orgDocPath(organizationId, "tickets", ticket.id)), {
        status: "new",
        reopened: true,
        reopenedBy: user.uid,
        reopenedAt: Timestamp.now(),
        organizationId,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Incidencia reabierta", description: "Se movió al listado activo." });
    } catch (error) {
      console.error("No se pudo reabrir la incidencia", error);
      toast({
        title: "Error al reabrir",
        description: "Inténtalo más tarde.",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = async (ticket: Ticket) => {
    if (!firestore || !isAdmin || !user || !organizationId) return;

    if (ticket.organizationId !== organizationId) {
      toast({
        variant: "destructive",
        title: "Organización inválida",
        description: "No puedes duplicar incidencias de otra organización.",
      });
      return;
    }

    try {
      await addDoc(collection(firestore, orgCollectionPath(organizationId, "tickets")), {
        title: ticket.title,
        description: ticket.description,
        status: "new",
        priority: ticket.priority,
        locationId: ticket.locationId ?? null,
        originDepartmentId: ticket.originDepartmentId ?? null,
        targetDepartmentId: ticket.targetDepartmentId ?? null,
        assetId: ticket.assetId ?? null,
        type: ticket.type,
        assignedRole: ticket.assignedRole ?? null,
        assignedTo: ticket.assignedTo ?? null,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        reopened: false,
        organizationId,
      });
      toast({ title: "Incidencia duplicada", description: "Se creó una nueva incidencia a partir de la cerrada." });
    } catch (error) {
      console.error("No se pudo duplicar la incidencia", error);
      toast({
        title: "No se pudo duplicar",
        description: "Revisa tu conexión o permisos.",
        variant: "destructive",
      });
    }
  };

  const isLoading = loading || userLoading;
  return (
    <AppShell
      title="Incidencias cerradas"
      description="Consulta y filtra incidencias cerradas para reportes."
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
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Ubicación" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las ubicaciones</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
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
              <Icons.spinner className="h-4 w-4 animate-spin" /> Cargando incidencias...
            </div>
          )}
          {!isLoading && filteredTickets.length === 0 && (
            <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground sm:col-span-2 xl:col-span-3">
              No se encontraron incidencias cerradas con esos filtros.
            </div>
          )}
          {!isLoading &&
            filteredTickets.map((ticket) => {
              const ticketDepartmentId = ticket.targetDepartmentId ?? ticket.originDepartmentId ?? null;
              const departmentLabel =
                (ticketDepartmentId && departments.find((dept) => dept.id === ticketDepartmentId)?.name) || "N/A";
              const ticketLocationId = ticket.locationId ?? null;
              const siteLabel = sites.find((site) => site.id === ticketLocationId)?.name || "N/A";
              const createdAtLabel = ticket.createdAt?.toDate
                ? format(ticket.createdAt.toDate(), "dd/MM/yyyy")
                : "Sin fecha";
              return (
                <div
                  key={ticket.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/incidents/${ticket.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/incidents/${ticket.id}`);
                    }
                  }}
                  className="block rounded-lg border border-white/20 bg-background p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-foreground">{ticket.title}</p>
                        <Badge variant="outline">
                          {statusLabels[normalizeTicketStatus(ticket.status)]}
                        </Badge>
                        {ticket.reopened && (
                          <Badge variant="outline" className="text-xs">Reabierta</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Departamento: {departmentLabel}</span>
                        <span>Ubicación: {siteLabel}</span>
                        <span>Creada: {createdAtLabel}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">Prioridad {ticket.priority}</Badge>
                      {isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleReopen(ticket);
                            }}
                          >
                            Reabrir
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDuplicate(ticket);
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
