"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  useDoc,
  useFirestore,
  useUser,
} from "@/lib/firebase";
import type { Department, Site, Ticket, User } from "@/lib/firebase/models";
import { collection, doc, or, query, serverTimestamp, Timestamp, updateDoc, where, addDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const statusLabels: Record<Ticket["status"], string> = {
  Abierta: "Abierta",
  "En curso": "En curso",
  "En espera": "En espera",
  Resuelta: "Resuelta",
  Cerrada: "Cerrada",
};

type DateFilter = "todas" | "hoy" | "semana" | "mes";

export default function ClosedIncidentsPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user, loading: userLoading } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : null);
  const { toast } = useToast();

  const canViewAll = userProfile?.role === "admin" || userProfile?.role === "mantenimiento";
  const isAdmin = userProfile?.role === "admin";

  const ticketsQuery = useMemo(() => {
    if (!firestore || !user || !userProfile) return null;

    const ticketsCollection = collection(firestore, "tickets");
    const statusCondition = where("status", "==", "Cerrada");

    if (canViewAll) {
      return query(ticketsCollection, statusCondition);
    }

    const conditions = [
      where("createdBy", "==", user.uid),
      where("assignedTo", "==", user.uid),
    ];

    if (userProfile.departmentId) {
      conditions.push(where("departmentId", "==", userProfile.departmentId));
    }

    if (conditions.length === 1) {
      return query(ticketsCollection, statusCondition, conditions[0]);
    }

    return query(ticketsCollection, statusCondition, or(...conditions));
  }, [canViewAll, firestore, user, userProfile]);

  const { data: tickets, loading } = useCollectionQuery<Ticket>(ticketsQuery);
  const { data: departments } = useCollection<Department>("departments");
  const { data: sites } = useCollection<Site>("sites");
  const { data: users } = useCollection<User>("users");

  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("todas");
  const [departmentFilter, setDepartmentFilter] = useState("todas");
  const [siteFilter, setSiteFilter] = useState("todas");
  const [userFilter, setUserFilter] = useState("todas");

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/login");
    }
  }, [router, user, userLoading]);

  const filteredTickets = useMemo(() => {
    const now = new Date();
    const dateLimits: Record<DateFilter, Date | null> = {
      todas: null,
      hoy: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      semana: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      mes: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    };

    return [...tickets]
      .filter((ticket) => {
        if (dateLimits[dateFilter] && ticket.createdAt?.toDate) {
          return ticket.createdAt.toDate() >= (dateLimits[dateFilter] as Date);
        }
        return true;
      })
      .filter((ticket) => (departmentFilter === "todas" ? true : ticket.departmentId === departmentFilter))
      .filter((ticket) => (siteFilter === "todas" ? true : ticket.siteId === siteFilter))
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
  }, [dateFilter, departmentFilter, searchQuery, siteFilter, tickets, userFilter]);

  const handleReopen = async (ticket: Ticket) => {
    if (!firestore || !isAdmin || !user) return;

    try {
      await updateDoc(doc(firestore, "tickets", ticket.id), {
        status: "Abierta",
        reopened: true,
        reopenedBy: user.uid,
        reopenedAt: Timestamp.now(),
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
    if (!firestore || !isAdmin || !user) return;

    try {
      await addDoc(collection(firestore, "tickets"), {
        title: ticket.title,
        description: ticket.description,
        status: "Abierta",
        priority: ticket.priority,
        siteId: ticket.siteId,
        departmentId: ticket.departmentId,
        assetId: ticket.assetId ?? null,
        type: ticket.type,
        assignedRole: ticket.assignedRole ?? null,
        assignedTo: ticket.assignedTo ?? null,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        reopened: false,
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

  const isLoading = loading || userLoading || profileLoading;
  const totalColumns = isAdmin ? 7 : 6;

  return (
    <AppShell
      title="Incidencias cerradas"
      description="Consulta y filtra incidencias cerradas para reportes."
    >
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm">
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

        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Departamento</TableHead>
                <TableHead>Ubicación</TableHead>
                <TableHead>Creada</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={totalColumns} className="h-24 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Icons.spinner className="h-4 w-4 animate-spin" /> Cargando incidencias...
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filteredTickets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={totalColumns} className="h-24 text-center text-muted-foreground">
                    No se encontraron incidencias cerradas con esos filtros.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                filteredTickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(`/incidents/${ticket.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <p>{ticket.title}</p>
                        {ticket.reopened && (
                          <Badge variant="outline" className="text-xs">Reabierta</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{statusLabels[ticket.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ticket.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      {departments.find((dept) => dept.id === ticket.departmentId)?.name || "N/A"}
                    </TableCell>
                    <TableCell>
                      {sites.find((site) => site.id === ticket.siteId)?.name || "N/A"}
                    </TableCell>
                    <TableCell>
                      {ticket.createdAt?.toDate
                        ? format(ticket.createdAt.toDate(), "dd/MM/yyyy")
                        : "Sin fecha"}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right space-x-2">
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
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
