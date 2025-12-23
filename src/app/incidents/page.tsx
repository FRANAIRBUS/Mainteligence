'use client';

import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Icons } from '@/components/icons';
import { useUser, useCollectionQuery, useDoc, useFirestore } from '@/lib/firebase';
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
import { DynamicClientLogo } from '@/components/dynamic-client-logo';
import { collection, query, where } from 'firebase/firestore';

function IncidentsTable({
  tickets,
  sites,
  departments,
  loading,
  onViewDetails,
  onEdit,
  userRole,
}: {
  tickets: Ticket[];
  sites: Record<string, string>;
  departments: Record<string, string>;
  loading: boolean;
  onViewDetails: (ticketId: string) => void;
  onEdit: (ticket: Ticket) => void;
  userRole?: string;
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
          tickets.map((ticket) => (
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
                    {(userRole === 'admin' || userRole === 'mantenimiento' || ticket.createdBy === userRole) && (
                       <DropdownMenuItem onClick={() => onEdit(ticket)}>Editar</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
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
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : '');
  
  const ticketsQuery = useMemo(() => {
    if (!firestore) return null;
    const ticketsCollection = collection(firestore, 'tickets');
    // All roles will now see all tickets. Permissions are handled by Firestore rules.
    return query(ticketsCollection);
  }, [firestore]);

  const { data: tickets, loading: ticketsLoading } = useCollectionQuery<Ticket>(ticketsQuery);

  const canLoadAdminCatalogs = userProfile?.role === 'admin' || userProfile?.role === 'mantenimiento';

  const sitesQuery = useMemo(() => (firestore && userProfile) ? collection(firestore, 'sites') : null, [firestore, userProfile]);
  const departmentsQuery = useMemo(() => (firestore && userProfile) ? collection(firestore, 'departments') : null, [firestore, userProfile]);
  
  const assetsQuery = useMemo(() => (firestore && canLoadAdminCatalogs) ? collection(firestore, 'assets') : null, [firestore, canLoadAdminCatalogs]);
  const usersQuery = useMemo(() => (firestore && canLoadAdminCatalogs) ? query(collection(firestore, 'users')) : null, [firestore, canLoadAdminCatalogs]);

  const { data: sites, loading: sitesLoading } = useCollectionQuery<Site>(sitesQuery);
  const { data: departments, loading: departmentsLoading } = useCollectionQuery<Department>(departmentsQuery);
  const { data: assets, loading: assetsLoading } = useCollectionQuery<Asset>(assetsQuery);
  const { data: users, loading: usersLoading } = useCollectionQuery<User>(usersQuery);
  
  const [isAddIncidentOpen, setIsAddIncidentOpen] = useState(false);
  const [isEditIncidentOpen, setIsEditIncidentOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const sitesMap = useMemo(() => sites.reduce((acc, site) => ({ ...acc, [site.id]: site.name }), {} as Record<string, string>), [sites]);
  const departmentsMap = useMemo(() => departments.reduce((acc, dept) => ({ ...acc, [dept.id]: dept.name }), {} as Record<string, string>), [departments]);
  
  const handleViewDetails = (ticketId: string) => {
    router.push(`/incidents/${ticketId}`);
  };

  const handleEditRequest = (ticket: Ticket) => {
    setEditingTicket(ticket);
    setIsEditIncidentOpen(true);
  };

  const isLoading = userLoading || profileLoading || ticketsLoading;
  
  if (isLoading && !tickets.length) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const tableIsLoading = ticketsLoading || (!!userProfile && (sitesLoading || departmentsLoading));

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
              <DynamicClientLogo />
            </div>
            <a href="/" className="flex flex-col items-center gap-2">
                <span className="text-xl font-headline font-semibold text-sidebar-foreground">
                Maintelligence
                </span>
            </a>
        </SidebarHeader>
        <SidebarContent>
          <MainNav />
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm lg:px-6">
          <SidebarTrigger className="md:hidden" />
          <div className="flex w-full items-center justify-end">
            <UserNav />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 md:p-8">
           <Card>
            <CardHeader>
               <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Incidencias</CardTitle>
                  <CardDescription className="mt-2">
                    Visualiza y gestiona todas las incidencias correctivas.
                  </CardDescription>
                </div>
                <Button onClick={() => setIsAddIncidentOpen(true)}>Crear Incidencia</Button>
              </div>
            </CardHeader>
            <CardContent>
              <IncidentsTable 
                tickets={tickets} 
                sites={sitesMap}
                departments={departmentsMap}
                loading={tableIsLoading && !tickets.length}
                onViewDetails={handleViewDetails}
                onEdit={handleEditRequest}
                userRole={userProfile?.role}
                />
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
      <AddIncidentDialog
        open={isAddIncidentOpen}
        onOpenChange={setIsAddIncidentOpen}
        sites={sites}
        departments={departments}
        assets={assets}
      />
      {editingTicket && (
        <EditIncidentDialog
          open={isEditIncidentOpen}
          onOpenChange={setIsEditIncidentOpen}
          ticket={editingTicket}
          users={users}
        />
      )}
    </SidebarProvider>
  );
}
