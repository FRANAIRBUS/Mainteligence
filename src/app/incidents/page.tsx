'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser, useCollection, useDoc, useCollectionQuery } from '@/lib/firebase';
import type { Ticket, Site, Department, Asset, User } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddIncidentDialog } from '@/components/add-incident-dialog';
import { EditIncidentDialog } from '@/components/edit-incident-dialog';
import { where, or } from 'firebase/firestore';
import { getTicketPermissions, normalizeRole } from '@/lib/rbac';

const incidentPriorityOrder: Record<Ticket['priority'], number> = {
  Crítica: 3,
  Alta: 2,
  Media: 1,
  Baja: 0,
};

function IncidentsTable({
  tickets,
  sites,
  departments,
  loading,
  onViewDetails,
  onEdit,
  currentUser,
  userId,
}: {
  tickets: Ticket[];
  sites: Record<string, string>;
  departments: Record<string, string>;
  loading: boolean;
  onViewDetails: (ticketId: string) => void;
  onEdit: (ticket: Ticket) => void;
  currentUser?: User | null;
  userId?: string;
}) {
  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Título</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Prioridad</TableHead>
          <TableHead>Ubicación</TableHead>
          <TableHead>Departamento</TableHead>
          <TableHead>Creado</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.length > 0 ? (
          tickets.map((ticket) => {
            const permissions = getTicketPermissions(ticket, currentUser ?? null, userId ?? null);
            return (
              <TableRow key={ticket.id} className="cursor-pointer" onClick={() => onViewDetails(ticket.id)}>
                <TableCell className="font-medium">{ticket.displayId || ticket.id.substring(0,6)}</TableCell>
                <TableCell>{ticket.title}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ticket.status}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{ticket.priority}</Badge>
                </TableCell>
                <TableCell>{sites[ticket.siteId] || 'N/A'}</TableCell>
                <TableCell>{departments[ticket.departmentId] || 'N/A'}</TableCell>
                <TableCell>
                  {ticket.createdAt?.toDate ? ticket.createdAt.toDate().toLocaleDateString() : 'N/A'}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-haspopup="true"
                        size="icon"
                        variant="ghost"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Menú de acciones</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => onViewDetails(ticket.id)}>Ver Detalles</DropdownMenuItem>
                      {permissions.canEditContent && (
                        <DropdownMenuItem onClick={() => onEdit(ticket)}>Editar</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={8} className="h-24 text-center">
              No se encontraron incidencias.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}


export default function IncidentsPage() {
  const { user, profile: userProfile, organizationId, loading: userLoading } = useUser();
  const router = useRouter();

  const [isAddIncidentOpen, setIsAddIncidentOpen] = useState(false);
  const [isEditIncidentOpen, setIsEditIncidentOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);

  // Phase 1: Wait for user authentication to complete.
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [userLoading, user, router]);
  
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

    return [...openTickets].sort((a, b) => {
      const aCreatedAt = a.createdAt?.toMillis?.()
        ?? a.createdAt?.toDate?.().getTime()
        ?? 0;
      const bCreatedAt = b.createdAt?.toMillis?.()
        ?? b.createdAt?.toDate?.().getTime()
        ?? 0;

      if (bCreatedAt !== aCreatedAt) {
        return bCreatedAt - aCreatedAt;
      }

      return incidentPriorityOrder[b.priority] - incidentPriorityOrder[a.priority];
    });
  }, [tickets]);

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
        <Card>
          <CardHeader>
            <CardTitle>Listado de incidencias</CardTitle>
            <CardDescription>Consulta, edita y prioriza incidencias en curso.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <IncidentsTable
                tickets={sortedTickets}
                sites={sitesMap}
                departments={departmentsMap}
                loading={tableDataIsLoading}
                onViewDetails={handleViewDetails}
                onEdit={handleEditRequest}
                currentUser={userProfile}
                userId={user?.uid}
              />
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
