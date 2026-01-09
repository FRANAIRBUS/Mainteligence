'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser, useCollection, useCollectionQuery } from '@/lib/firebase';
import type { Ticket, Site, Department, User } from '@/lib/firebase/models';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MoreHorizontal } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddIncidentDialog } from '@/app/add-incident-dialog';
import { EditIncidentDialog } from '@/components/edit-incident-dialog';
import { where, or } from 'firebase/firestore';
import { getTicketPermissions, normalizeRole } from '@/lib/rbac';
import Link from 'next/link';

const incidentPriorityOrder: Record<Ticket['priority'], number> = {
  Crítica: 3,
  Alta: 2,
  Media: 1,
  Baja: 0,
};

export default function IncidentsPage() {
  const { user, profile: userProfile, organizationId, loading: userLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isAddIncidentOpen, setIsAddIncidentOpen] = useState(false);
  const [isEditIncidentOpen, setIsEditIncidentOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Phase 1: Wait for user authentication to complete.
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [userLoading, user, router]);

  useEffect(() => {
    if (searchParams?.get('new') === 'true') {
      setIsAddIncidentOpen(true);
    }
  }, [searchParams]);
  
  const normalizedRole = normalizeRole(userProfile?.role);
  const isSuperAdmin = normalizedRole === 'super_admin';
  const isMantenimiento = isSuperAdmin || normalizedRole === 'admin' || normalizedRole === 'maintenance';

  // Phase 3: Construct the tickets query only when user and userProfile are ready.
  const ticketsConstraints = useMemo(() => {
    if (userLoading || !user || !userProfile || (!organizationId && !isSuperAdmin) || !normalizedRole) return null;

    if (isSuperAdmin) {
      return [] as const;
    }

    const scopedOrgConstraint = [where('organizationId', '==', organizationId as string)] as const;

    if (isMantenimiento) {
      return scopedOrgConstraint;
    }

    const scopeDepartments = (userProfile.departmentIds ?? []).length
      ? userProfile.departmentIds ?? []
      : userProfile.departmentId
        ? [userProfile.departmentId]
        : [];

    const departmentFilters: any[] = [];
    if (scopeDepartments.length === 1) {
      const deptId = scopeDepartments[0];
      departmentFilters.push(
        where('departmentId', '==', deptId),
        where('originDepartmentId', '==', deptId),
        where('targetDepartmentId', '==', deptId),
      );
    } else if (scopeDepartments.length > 1) {
      const scoped = scopeDepartments.slice(0, 10);
      departmentFilters.push(
        where('departmentId', 'in', scoped),
        where('originDepartmentId', 'in', scoped),
        where('targetDepartmentId', 'in', scoped),
      );
    }

    const baseFilters = [
      where('createdBy', '==', user.uid),
      where('assignedTo', '==', user.uid),
      ...departmentFilters,
    ];

    return [where('organizationId', '==', organizationId as string), or(...baseFilters)];
  }, [user, userProfile, organizationId, normalizedRole, isMantenimiento, isSuperAdmin]);

  // Phase 4: Execute the query for tickets and load other collections.
  const { data: tickets = [], loading: ticketsLoading } = useCollectionQuery<Ticket>(
    ticketsConstraints ? 'tickets' : null,
    ...(ticketsConstraints ?? [])
  );
  const { data: sites = [], loading: sitesLoading } = useCollection<Site>('sites');
  const { data: departments = [], loading: deptsLoading } = useCollection<Department>('departments');
  // Only fetch users if the current user is an admin or maintenance staff.
  const { data: users = [], loading: usersLoading } = useCollection<User>(isMantenimiento ? 'users' : null);


  const sitesMap = useMemo(() => sites.reduce((acc, site) => ({ ...acc, [site.id]: site.name }), {} as Record<string, string>), [sites]);
  const departmentsMap = useMemo(() => departments.reduce((acc, dept) => ({ ...acc, [dept.id]: dept.name }), {} as Record<string, string>), [departments]);

  const sortedTickets = useMemo(() => {
    const openTickets = tickets.filter((ticket) => ticket.status !== 'Cerrada');
    const effectiveDateFilter = dateFilter || 'recientes';

    return [...openTickets].sort((a, b) => {
      const aCreatedAt = a.createdAt?.toMillis?.()
        ?? a.createdAt?.toDate?.().getTime()
        ?? 0;
      const bCreatedAt = b.createdAt?.toMillis?.()
        ?? b.createdAt?.toDate?.().getTime()
        ?? 0;

      if (bCreatedAt !== aCreatedAt) {
        return effectiveDateFilter === 'antiguas'
          ? aCreatedAt - bCreatedAt
          : bCreatedAt - aCreatedAt;
      }

      return incidentPriorityOrder[b.priority] - incidentPriorityOrder[a.priority];
    });
  }, [dateFilter, tickets]);

  const filteredTickets = useMemo(() => {
    return sortedTickets.filter((ticket) => {
      const matchesStatus =
        statusFilter === '' || statusFilter === 'todas' || ticket.status === statusFilter;
      const matchesPriority =
        priorityFilter === '' || priorityFilter === 'todas' || ticket.priority === priorityFilter;
      const query = searchQuery.toLowerCase();
      const matchesQuery =
        !query ||
        ticket.title.toLowerCase().includes(query) ||
        ticket.description.toLowerCase().includes(query) ||
        ticket.displayId?.toLowerCase().includes(query) ||
        ticket.id.toLowerCase().includes(query);

      return matchesStatus && matchesPriority && matchesQuery;
    });
  }, [priorityFilter, searchQuery, sortedTickets, statusFilter]);

  const handleViewDetails = (ticketId: string) => {
    router.push(`/incidents/${ticketId}`);
  };

  const handleEditRequest = (ticket: Ticket) => {
    setEditingTicket(ticket);
    setIsEditIncidentOpen(true);
  };
  
  const initialLoading = userLoading;
  
  if (initialLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  const tableDataIsLoading = ticketsLoading || sitesLoading || deptsLoading || (isMantenimiento && usersLoading);

  return (
    <>
      <AppShell
        title="Incidencias"
        description="Visualiza y gestiona todas las incidencias correctivas."
        action={
          <Button className="w-full sm:w-auto" onClick={() => setIsAddIncidentOpen(true)}>
            Crear Incidencia
          </Button>
        }
      >
        <Card className="border-white/60 bg-sky-400/15">
          <CardHeader className="p-4 pb-0">
            <CardTitle>Listado de incidencias</CardTitle>
            <CardDescription>Consulta, edita y prioriza incidencias en curso.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <Input
                placeholder="Buscar por título o ID"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="md:max-w-xs"
              />
              <div className="flex flex-wrap gap-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Estados" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todos los estados</SelectItem>
                    <SelectItem value="Abierta">Abiertas</SelectItem>
                    <SelectItem value="En curso">En curso</SelectItem>
                    <SelectItem value="En espera">En espera</SelectItem>
                    <SelectItem value="Resuelta">Resueltas</SelectItem>
                    <SelectItem value="Cierre solicitado">Cierre solicitado</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Prioridad" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas las prioridades</SelectItem>
                    <SelectItem value="Crítica">Crítica</SelectItem>
                    <SelectItem value="Alta">Alta</SelectItem>
                    <SelectItem value="Media">Media</SelectItem>
                    <SelectItem value="Baja">Baja</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Fecha" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recientes">Más recientes</SelectItem>
                    <SelectItem value="antiguas">Más antiguas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tableDataIsLoading && (
                <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-white/20 bg-background text-muted-foreground sm:col-span-2 xl:col-span-3">
                  <Icons.spinner className="h-4 w-4 animate-spin" />
                  Cargando incidencias...
                </div>
              )}
              {!tableDataIsLoading && filteredTickets.length === 0 && (
                <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground sm:col-span-2 xl:col-span-3">
                  No se encontraron incidencias con esos filtros.
                </div>
              )}
              {!tableDataIsLoading &&
                filteredTickets.map((ticket) => {
                  const permissions = getTicketPermissions(ticket, userProfile ?? null, user?.uid ?? null);
                  const createdAtLabel = ticket.createdAt?.toDate
                    ? ticket.createdAt.toDate().toLocaleDateString()
                    : 'N/A';
                  const siteLabel = sitesMap[ticket.siteId] || 'N/A';
                  const departmentLabel = departmentsMap[ticket.departmentId] || 'N/A';
                  const ticketIdLabel = ticket.displayId || ticket.id.substring(0, 6);
                  return (
                    <div
                      key={ticket.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleViewDetails(ticket.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleViewDetails(ticket.id);
                        }
                      }}
                      className="block rounded-lg border border-white/20 bg-background p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-foreground">{ticket.title}</p>
                            <Badge variant="outline">{ticket.status}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {ticket.description || 'Sin descripción'}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>ID: {ticketIdLabel}</span>
                            <span>Ubicación: {siteLabel}</span>
                            <span>Departamento: {departmentLabel}</span>
                            <span>Creado: {createdAtLabel}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={ticket.priority === 'Crítica' ? 'destructive' : 'secondary'}>
                            Prioridad {ticket.priority}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-haspopup="true"
                                size="icon"
                                variant="ghost"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Menú de acciones</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleViewDetails(ticket.id);
                                }}
                              >
                                Ver Detalles
                              </DropdownMenuItem>
                              {permissions.canEditContent && (
                                <DropdownMenuItem
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleEditRequest(ticket);
                                  }}
                                >
                                  Editar
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </AppShell>

      <AddIncidentDialog open={isAddIncidentOpen} onOpenChange={setIsAddIncidentOpen} />
      {editingTicket && (
        <EditIncidentDialog
          open={isEditIncidentOpen}
          onOpenChange={setIsEditIncidentOpen}
          ticket={editingTicket}
          users={users}
          departments={departments}
        />
      )}
    </>
  );
}
