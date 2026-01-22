'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser, useCollection, useCollectionQuery, useDoc } from '@/lib/firebase';
import type { Ticket, Site, Department, OrganizationMember } from '@/lib/firebase/models';
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
import { CalendarRange, ListFilter, MapPin, MoreHorizontal, ShieldAlert } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EditIncidentDialog } from '@/components/edit-incident-dialog';
import { where } from 'firebase/firestore';
import { getTicketPermissions, normalizeRole, type RBACUser } from '@/lib/rbac';
import { normalizeTicketStatus, ticketStatusLabel } from '@/lib/status';
import Link from 'next/link';
import { orgCollectionPath, orgDocPath } from '@/lib/organization';
import { useToast } from '@/hooks/use-toast';

const incidentPriorityOrder: Record<Ticket['priority'], number> = {
  Crítica: 3,
  Alta: 2,
  Media: 1,
  Baja: 0,
};

export default function IncidentsPage() {
  const { user, profile: userProfile, role, organizationId, loading: userLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [isEditIncidentOpen, setIsEditIncidentOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Phase 1: Wait for user authentication to complete.
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [userLoading, user, router]);

  useEffect(() => {
    if (!searchParams) return;
    if (searchParams.get('created') !== '1') return;

    const title = searchParams.get('title') ?? 'Nueva incidencia';
    toast({
      title: 'Incidencia creada',
      description: `Incidencia '${title}' creada correctamente.`,
    });
    router.replace('/incidents');
  }, [router, searchParams, toast]);

  const normalizedRole = normalizeRole(role ?? userProfile?.role);
  const isMantenimiento = normalizedRole === 'super_admin' || normalizedRole === 'admin' || normalizedRole === 'mantenimiento';
  const { data: currentMember } = useDoc<OrganizationMember>(
    user && organizationId ? orgDocPath(organizationId, 'members', user.uid) : null
  );
  const rbacUser: RBACUser | null =
    normalizedRole && organizationId
      ? {
          role: normalizedRole,
          organizationId,
          departmentId: currentMember?.departmentId ?? userProfile?.departmentId ?? undefined,
          locationId:
            currentMember?.locationId ??
            userProfile?.locationId ??
            userProfile?.siteId ??
            undefined,
        }
      : null;

  // Phase 3: Construct the tickets query only when user and userProfile are ready.
  const ticketsConstraints = useMemo(() => {
    if (userLoading || !user || !organizationId || !normalizedRole) return null;

    return [where('organizationId', '==', organizationId as string)] as const;
  }, [user, userLoading, organizationId, normalizedRole]);

  // Phase 4: Execute the query for tickets and load other collections.
  const { data: tickets = [], loading: ticketsLoading } = useCollectionQuery<Ticket>(
    ticketsConstraints && organizationId ? orgCollectionPath(organizationId, 'tickets') : null,
    ...(ticketsConstraints ?? [])
  );
  const { data: sites = [], loading: sitesLoading } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  const { data: departments = [], loading: deptsLoading } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );
  // Only fetch users if the current user is an admin or mantenimiento staff.
  const { data: users = [], loading: usersLoading } = useCollection<OrganizationMember>(
    isMantenimiento && organizationId ? orgCollectionPath(organizationId, 'members') : null
  );


  const sitesMap = useMemo(() => sites.reduce((acc, site) => ({ ...acc, [site.id]: site.name }), {} as Record<string, string>), [sites]);
  const departmentsMap = useMemo(() => departments.reduce((acc, dept) => ({ ...acc, [dept.id]: dept.name }), {} as Record<string, string>), [departments]);

  const sortedTickets = useMemo(() => {
    const visibleTickets = tickets.filter((ticket) =>
      getTicketPermissions(ticket, rbacUser, user?.uid ?? null).canView
    );
    const openTickets = visibleTickets.filter((ticket) => normalizeTicketStatus(ticket.status) !== 'resolved');
    const effectiveDateFilter = dateFilter === 'all' ? 'recientes' : dateFilter || 'recientes';

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
  }, [dateFilter, tickets, user?.uid, rbacUser]);

  const filteredTickets = useMemo(() => {
    return sortedTickets.filter((ticket) => {
      const matchesStatus =
        statusFilter === 'all' ||
        statusFilter === 'todas' ||
        normalizeTicketStatus(ticket.status) === statusFilter;
      const matchesPriority =
        priorityFilter === 'all' || priorityFilter === 'todas' || ticket.priority === priorityFilter;
      const ticketLocationId = ticket.locationId ?? ticket.siteId ?? null;
      const matchesLocation = locationFilter === 'all' || ticketLocationId === locationFilter;
      const query = searchQuery.toLowerCase();
      const matchesQuery =
        !query ||
        ticket.title.toLowerCase().includes(query) ||
        ticket.description.toLowerCase().includes(query) ||
        ticket.displayId?.toLowerCase().includes(query) ||
        ticket.id.toLowerCase().includes(query);

      return matchesStatus && matchesPriority && matchesLocation && matchesQuery;
    });
  }, [locationFilter, priorityFilter, searchQuery, sortedTickets, statusFilter]);

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
          <Button className="w-full sm:w-auto" asChild>
            <Link href="/incidents/new">Crear Incidencia</Link>
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
                placeholder="Buscar por título"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="md:max-w-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger
                    className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                      statusFilter !== 'all'
                        ? 'border-primary/70 bg-primary/10 text-primary'
                        : 'bg-transparent'
                    }`}
                  >
                    <SelectValue className="sr-only" />
                    <ListFilter className="h-5 w-5" aria-hidden="true" />
                    <span className="sr-only">Estados</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Sin Filtro</SelectItem>
                    <SelectItem value="new">Nuevas</SelectItem>
                    <SelectItem value="in_progress">En progreso</SelectItem>
                    <SelectItem value="resolved">Resueltas</SelectItem>
                    <SelectItem value="canceled">Canceladas</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger
                    className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                      priorityFilter !== 'all'
                        ? 'border-primary/70 bg-primary/10 text-primary'
                        : 'bg-transparent'
                    }`}
                  >
                    <SelectValue className="sr-only" />
                    <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                    <span className="sr-only">Prioridad</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Sin Filtro</SelectItem>
                    <SelectItem value="Crítica">Crítica</SelectItem>
                    <SelectItem value="Alta">Alta</SelectItem>
                    <SelectItem value="Media">Media</SelectItem>
                    <SelectItem value="Baja">Baja</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger
                    className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                      dateFilter !== 'all'
                        ? 'border-primary/70 bg-primary/10 text-primary'
                        : 'bg-transparent'
                    }`}
                  >
                    <SelectValue className="sr-only" />
                    <CalendarRange className="h-5 w-5" aria-hidden="true" />
                    <span className="sr-only">Fecha</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Sin Filtro</SelectItem>
                    <SelectItem value="recientes">Más recientes</SelectItem>
                    <SelectItem value="antiguas">Más antiguas</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger
                    className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                      locationFilter !== 'all'
                        ? 'border-primary/70 bg-primary/10 text-primary'
                        : 'bg-transparent'
                    }`}
                  >
                    <SelectValue className="sr-only" />
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                    <span className="sr-only">Ubicaciones</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Sin Filtro</SelectItem>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3">
              {tableDataIsLoading && (
                <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-white/20 bg-background text-muted-foreground">
                  <Icons.spinner className="h-4 w-4 animate-spin" />
                  Cargando incidencias...
                </div>
              )}
              {!tableDataIsLoading && filteredTickets.length === 0 && (
                <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground">
                  No se encontraron incidencias con esos filtros.
                </div>
              )}
              {!tableDataIsLoading &&
                filteredTickets.map((ticket) => {
                  const permissions = getTicketPermissions(ticket, rbacUser, user?.uid ?? null);
                  const createdAtLabel = ticket.createdAt?.toDate
                    ? ticket.createdAt.toDate().toLocaleDateString()
                    : 'N/A';
                  const ticketLocationId = ticket.locationId ?? ticket.siteId ?? null;
                  const siteLabel = (ticketLocationId && sitesMap[ticketLocationId]) || 'N/A';
                  const departmentId =
                    ticket.targetDepartmentId ??
                    ticket.originDepartmentId ??
                    ticket.departmentId ??
                    null;
                  const departmentLabel = (departmentId && departmentsMap[departmentId]) || 'N/A';
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
                            <Badge variant="outline">{ticketStatusLabel(ticket.status)}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {ticket.description || 'Sin descripción'}
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
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
