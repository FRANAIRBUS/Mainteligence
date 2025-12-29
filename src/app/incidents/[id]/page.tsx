'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useDoc, useUser, useCollection, useFirestore } from '@/lib/firebase';
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
import { ArrowLeft, Edit, CalendarIcon, User as UserIcon, Building, Archive, HardHat, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { EditIncidentDialog } from '@/components/edit-incident-dialog';
import { DynamicClientLogo } from '@/components/dynamic-client-logo';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore';

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
  const firestore = useFirestore();

  const { user, loading: userLoading } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : null);
  const isMantenimiento = userProfile?.role === 'admin' || userProfile?.role === 'mantenimiento';

  const { data: ticket, loading: ticketLoading, error: ticketError } = useDoc<Ticket>(ticketId ? `tickets/${ticketId}` : null);
  
  // Fetch all collections needed for display unconditionally
  const { data: createdByUser, loading: createdByLoading } = useDoc<User>(ticket ? `users/${ticket.createdBy}` : null);
  const { data: assignedToUser, loading: assignedToLoading } = useDoc<User>(ticket && ticket.assignedTo ? `users/${ticket.assignedTo}` : null);
  const { data: sites, loading: sitesLoading } = useCollection<Site>('sites');
  const { data: departments, loading: deptsLoading } = useCollection<Department>('departments');
  const { data: assets, loading: assetsLoading } = useCollection<Asset>('assets');
  // Only fetch users if the current user is an admin or maintenance staff.
  const { data: users, loading: usersLoading } = useCollection<User>(isMantenimiento ? 'users' : null);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [reportDescription, setReportDescription] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const { toast } = useToast();

  const sortedReports = useMemo(() => {
    return [...(ticket?.reports ?? [])].sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() ?? new Date(0);
      const dateB = b.createdAt?.toDate?.() ?? new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [ticket?.reports]);
  const isClosed = ticket?.status === 'Cerrada';

  // Memoize derived data
  const siteName = useMemo(() => sites?.find(s => s.id === ticket?.siteId)?.name || 'N/A', [sites, ticket]);
  const departmentName = useMemo(() => departments?.find(d => d.id === ticket?.departmentId)?.name || 'N/A', [departments, ticket]);
  const assetName = useMemo(() => assets?.find(a => a.id === ticket?.assetId)?.name || 'N/A', [assets, ticket]);


  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
     // Authorization check after data has loaded
     if (!ticketLoading && !userLoading && !profileLoading && ticket && user && userProfile) {
      const canView = userProfile?.role === 'admin' || userProfile?.role === 'mantenimiento' || ticket.createdBy === user.uid;
      if (!canView) {
        router.push('/incidents');
      }
    }
  }, [user, userLoading, router, ticket, ticketLoading, userProfile, profileLoading]);

  const handleAddReport = async () => {
    if (!firestore || !ticket?.id) {
      toast({
        title: 'No se pudo registrar el informe',
        description: 'Inténtalo nuevamente en unos instantes.',
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({
        title: 'Inicia sesión',
        description: 'Debes iniciar sesión para informar la incidencia.',
        variant: 'destructive',
      });
      return;
    }

    const description = reportDescription.trim();

    if (!description) {
      toast({
        title: 'Agrega una descripción',
        description: 'Describe el informe antes de enviarlo.',
        variant: 'destructive',
      });
      return;
    }

    setReportSubmitting(true);

    try {
      const ticketRef = doc(firestore, 'tickets', ticket.id);
      await updateDoc(ticketRef, {
        reports: arrayUnion({
          description,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        }),
        updatedAt: serverTimestamp(),
      });

      setReportDescription('');
      toast({
        title: 'Informe agregado',
        description: 'Se registró el seguimiento de la incidencia.',
      });
    } catch (error) {
      console.error('Error al agregar informe de incidencia', error);
      toast({
        title: 'No se pudo guardar el informe',
        description: 'Vuelve a intentarlo en unos segundos.',
        variant: 'destructive',
      });
    } finally {
      setReportSubmitting(false);
    }
  };

  const isLoading = userLoading || profileLoading || ticketLoading || createdByLoading || sitesLoading || deptsLoading || assetsLoading || (isMantenimiento && usersLoading) || assignedToLoading;

  if (isLoading || !userProfile) { // Also check for userProfile, since it's needed for auth
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (ticketError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center px-4">
        <Card className="max-w-lg">
          <CardHeader className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <CardTitle>No se pudo cargar la incidencia</CardTitle>
            <CardDescription className="text-balance">
              {ticketError.message || 'Ocurrió un error inesperado al consultar la incidencia.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            <Button variant="outline" onClick={() => router.push('/incidents')}>
              Volver al listado
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // After loading, if ticket is not found (and not loading), show not found message
  if (!ticket && !ticketLoading) {
    return (
       <div className="flex h-screen w-screen items-center justify-center">
          <p>Incidencia no encontrada.</p>
      </div>
    )
  }

  if (!ticket) {
    return null;
  }

  const canEdit =
    userProfile.role === 'admin' ||
    userProfile.role === 'mantenimiento' ||
    (user ? ticket.createdBy === user.uid : false);

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
           <div className="flex items-center gap-2">
            <SidebarTrigger className="md:hidden" />
            <Button variant="outline" size="icon" onClick={() => router.push('/incidents')} className='h-8 w-8'>
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
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="font-headline text-2xl font-bold tracking-tight md:text-3xl">
                                {ticket.title}
                            </h1>
                            <Badge variant="outline">{ticket.status}</Badge>
                            <Badge variant="secondary">{ticket.priority}</Badge>
                        </div>
                        <p className="text-muted-foreground">ID de Incidencia: {ticket.displayId}</p>
                    </div>
                     {canEdit && (
                        <Button onClick={() => setIsEditDialogOpen(true)}>
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
                        <Card>
                          <CardHeader>
                            <CardTitle>Informes</CardTitle>
                            <CardDescription>
                              Registra los avisos o seguimientos de esta incidencia. Cada informe se agrega con fecha y descripción.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="space-y-3">
                              {sortedReports.length ? (
                                sortedReports.map((report, index) => {
                                  const date = report.createdAt?.toDate?.() ?? new Date();
                                  return (
                                    <div key={index} className="rounded-lg border bg-muted/40 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                        <span>{format(date, 'PPPp')}</span>
                                        {report.createdBy ? <span>Por {report.createdBy}</span> : null}
                                      </div>
                                      <p className="mt-2 text-sm whitespace-pre-line text-foreground">{report.description}</p>
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="text-sm text-muted-foreground">Aún no hay informes para esta incidencia.</p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <Label htmlFor="incident-report">Nuevo informe</Label>
                              <Textarea
                                id="incident-report"
                                placeholder="Describe el informe o avance que deseas registrar"
                                value={reportDescription}
                                onChange={(event) => setReportDescription(event.target.value)}
                                disabled={reportSubmitting || isClosed}
                              />
                              {isClosed && (
                                <p className="text-xs text-muted-foreground">
                                  La incidencia está cerrada. No se pueden agregar más informes.
                                </p>
                              )}
                              <Button
                                onClick={handleAddReport}
                                disabled={reportSubmitting || isClosed}
                              >
                                {reportSubmitting && (
                                  <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Informar
                              </Button>
                            </div>
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
                                {assignedToUser && (
                                  <InfoCard 
                                      icon={UserIcon}
                                      label="Asignado a"
                                      value={assignedToUser?.displayName || 'N/A'}
                                  />
                                )}
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
      {canEdit && (
        <EditIncidentDialog
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
            ticket={ticket}
            users={users}
            departments={departments}
        />
      )}
    </SidebarProvider>
  );
}
