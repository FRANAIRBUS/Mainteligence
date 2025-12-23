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
import { useUser, useCollection } from '@/lib/firebase';
import type { Ticket, Site, Department, Asset } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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

function IncidentsTable({
  tickets,
  loading,
  onViewDetails,
}: {
  tickets: Ticket[];
  loading: boolean;
  onViewDetails: (ticketId: string) => void;
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
                    <DropdownMenuItem disabled>Editar</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={6} className="h-24 text-center">
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

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const { data: tickets, loading: ticketsLoading } = useCollection<Ticket>('tickets');
  const { data: sites, loading: sitesLoading } = useCollection<Site>('sites');
  const { data: departments, loading: departmentsLoading } = useCollection<Department>('departments');
  const { data: assets, loading: assetsLoading } = useCollection<Asset>('assets');
  const [isAddIncidentOpen, setIsAddIncidentOpen] = useState(false);

  const isLoading = userLoading || ticketsLoading || sitesLoading || departmentsLoading || assetsLoading;

  if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  const handleViewDetails = (ticketId: string) => {
    router.push(`/incidents/${ticketId}`);
  };

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4">
          <a href="/" className="flex items-center gap-2">
            <Icons.logo className="h-8 w-8 text-sidebar-primary" />
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
              <IncidentsTable tickets={tickets} loading={ticketsLoading} onViewDetails={handleViewDetails} />
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
    </SidebarProvider>
  );
}
