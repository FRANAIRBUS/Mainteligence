'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDoc, useUser, useCollection } from '@/lib/firebase';
import type { Ticket, User, Site, Department, Asset } from '@/lib/firebase/models';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import { Icons } from '@/components/icons';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit, CalendarIcon, User as UserIcon, Building, Archive, HardHat } from 'lucide-react';
import { format } from 'date-fns';

function InfoCard({ icon: Icon, label, value }: { icon: React.ElementType, label: string, value: string | React.ReactNode }) {
    return (
        <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className="text-base font-semibold">{value}</p>
            </div>
        </div>
    )
}

export default function IncidentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { id } = params;
  const ticketId = Array.isArray(id) ? id[0] : id;

  const { user, loading: userLoading } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : '');

  const { data: ticket, loading: ticketLoading } = useDoc<Ticket>(ticketId ? `tickets/${ticketId}` : '');
  const { data: createdByUser, loading: createdByLoading } = useDoc<User>(ticket ? `users/${ticket.createdBy}` : '');
  
  const { data: sites } = useCollection<Site>('sites');
  const { data: departments } = useCollection<Department>('departments');
  const { data: assets } = useCollection<Asset>('assets');

  const siteName = useMemo(() => sites?.find(s => s.id === ticket?.siteId)?.name || 'N/A', [sites, ticket]);
  const departmentName = useMemo(() => departments?.find(d => d.id === ticket?.departmentId)?.name || 'N/A', [departments, ticket]);
  const assetName = useMemo(() => assets?.find(a => a.id === ticket?.assetId)?.name || 'N/A', [assets, ticket]);


  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const isLoading = userLoading || profileLoading || ticketLoading || createdByLoading;

  if (isLoading || !ticket) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const isAdmin = userProfile?.role === 'admin';

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
           <div className="flex items-center gap-2">
            <SidebarTrigger className="md:hidden" />
            <Button variant="outline" size="icon" onClick={() => router.back()} className='h-8 w-8'>
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Volver</span>
            </Button>
          </div>
          <div className="flex w-full items-center justify-end">
            <UserNav />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 md:p-8">
            <div className="mx-auto max-w-4xl space-y-8">
                {/* Header */}
                <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                    <div className="grid gap-1">
                        <div className="flex items-center gap-2">
                            <h1 className="font-headline text-2xl font-bold tracking-tight md:text-3xl">
                                {ticket.title}
                            </h1>
                            <Badge variant="outline">{ticket.status}</Badge>
                            <Badge variant="secondary">{ticket.priority}</Badge>
                        </div>
                        <p className="text-muted-foreground">ID de Incidencia: {ticket.displayId}</p>
                    </div>
                     {isAdmin && (
                        <Button>
                            <Edit className="mr-2 h-4 w-4" />
                            Editar Incidencia
                        </Button>
                     )}
                </div>

                {/* Main Content */}
                <div className="grid gap-8 md:grid-cols-3">
                    {/* Left Column (Details) */}
                    <div className="space-y-6 md:col-span-2">
                         <Card>
                            <CardHeader>
                                <CardTitle>Descripción del Problema</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-foreground/80">{ticket.description}</p>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Column (Info) */}
                    <div className="space-y-6 md:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle>Detalles</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <InfoCard 
                                    icon={CalendarIcon}
                                    label="Fecha de Creación"
                                    value={ticket.createdAt?.toDate ? format(ticket.createdAt.toDate(), 'dd/MM/yyyy HH:mm') : 'N/A'}
                                />
                                <InfoCard 
                                    icon={UserIcon}
                                    label="Creado por"
                                    value={createdByUser?.displayName || 'N/A'}
                                />
                                <InfoCard 
                                    icon={Building}
                                    label="Ubicación"
                                    value={siteName}
                                />
                                 <InfoCard 
                                    icon={Archive}
                                    label="Departamento"
                                    value={departmentName}
                                />
                                {ticket.assetId && (
                                    <InfoCard 
                                        icon={HardHat}
                                        label="Activo"
                                        value={assetName}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
