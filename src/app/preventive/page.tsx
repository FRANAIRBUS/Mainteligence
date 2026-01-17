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
import { useCollectionQuery, useDoc, useFirestore, useUser } from '@/lib/firebase';
import type { Organization, Ticket } from '@/lib/firebase/models';
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
import { doc, getDoc, where } from 'firebase/firestore';
import { DynamicClientLogo } from '@/components/dynamic-client-logo';
import { isFeatureEnabled } from '@/lib/entitlements';

function PreventiveTable({
  tickets,
  loading,
}: {
  tickets: Ticket[];
  loading: boolean;
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
            <TableRow key={ticket.id}>
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
              <TableCell>
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
                    <DropdownMenuItem>Ver Detalles</DropdownMenuItem>
                    <DropdownMenuItem>Ejecutar</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={6} className="h-24 text-center">
              No se encontraron órdenes de mantenimiento preventivo.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}


export default function PreventivePage() {
  const { user, loading: userLoading, organizationId } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const [planFeatures, setPlanFeatures] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const { data: organization } = useDoc<Organization>(
    organizationId ? `organizations/${organizationId}` : null
  );

  useEffect(() => {
    if (!firestore || !organization?.entitlement?.planId) {
      setPlanFeatures(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(firestore, 'planCatalog', organization.entitlement.planId))
      .then((snap) => {
        if (cancelled) return;
        const features = (snap.exists() ? (snap.data()?.features as Record<string, boolean>) : null) ?? null;
        setPlanFeatures(features);
      })
      .catch(() => {
        if (cancelled) return;
        setPlanFeatures(null);
      });

    return () => {
      cancelled = true;
    };
  }, [firestore, organization?.entitlement?.planId]);

  const entitlement = organization?.entitlement ?? null;
  const preventivesAllowed =
    planFeatures && entitlement
      ? isFeatureEnabled({ ...entitlement, features: planFeatures }, 'PREVENTIVES')
      : true;
  const preventivesPaused = Boolean(organization?.preventivesPausedByEntitlement);
  const preventivesBlocked = planFeatures !== null && !preventivesAllowed;

  const { data: tickets, loading: ticketsLoading } = useCollectionQuery<Ticket>(
    'tickets',
    where('type', '==', 'preventivo')
  );

  if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

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
                  <CardTitle>Mantenimiento Preventivo</CardTitle>
                  <CardDescription className="mt-2">
                    Visualiza y gestiona todas las órdenes de mantenimiento preventivo.
                  </CardDescription>
                  {preventivesBlocked ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-200">
                      <span>
                        Tu plan actual no incluye preventivos. Actualiza tu plan para habilitar esta función.
                      </span>
                      <Button variant="outline" size="sm" onClick={() => router.push('/plans')}>
                        Ver planes
                      </Button>
                    </div>
                  ) : null}
                  {preventivesPaused ? (
                    <p className="mt-2 text-xs text-amber-200">
                      Los preventivos están pausados por limitaciones del plan actual.
                    </p>
                  ) : null}
                </div>
                <Button disabled={preventivesBlocked || preventivesPaused}>Crear Plantilla</Button>
              </div>
            </CardHeader>
            <CardContent>
              <PreventiveTable tickets={tickets} loading={ticketsLoading} />
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
