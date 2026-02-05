'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useDoc, useUser, useCollection, useFirestore } from '@/lib/firebase';
import type { Ticket, Site, Department, Asset, OrganizationMember } from '@/lib/firebase/models';
import { Icons } from '@/components/icons';
import { getTicketPermissions, normalizeRole } from '@/lib/rbac';
import { normalizeTicketStatus, ticketStatusLabel } from '@/lib/status';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Edit, CalendarIcon, User as UserIcon, Building, Archive, HardHat, AlertTriangle, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { EditIncidentDialog } from '@/components/edit-incident-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { arrayUnion, doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { orgCollectionPath, orgDocPath } from '@/lib/organization';
import { AppShell } from '@/components/app-shell';

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

  const { user, profile: userProfile, role, organizationId, loading: userLoading } = useUser();
  const { data: ticket, loading: ticketLoading, error: ticketError } = useDoc<Ticket>(
    ticketId && organizationId ? orgDocPath(organizationId, 'tickets', ticketId) : null
  );
  
  // Fetch org-scoped reference data
  const { data: sites, loading: sitesLoading } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  const { data: departments, loading: deptsLoading } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );
  const { data: assets, loading: assetsLoading } = useCollection<Asset>(
    organizationId ? orgCollectionPath(organizationId, 'assets') : null
  );

  const normalizedRole = normalizeRole(role ?? userProfile?.role);
  const isSuperAdmin = normalizedRole === 'super_admin';
  const isMantenimiento =
    isSuperAdmin || normalizedRole === 'admin' || normalizedRole === 'mantenimiento';

  const { data: members = [], loading: membersLoading } = useCollection<OrganizationMember>(
    organizationId ? orgCollectionPath(organizationId, 'members') : null
  );

  // Resolve ticket actors from org members (best-effort)
  const createdByMemberPath =
    ticket?.createdBy && organizationId
      ? orgDocPath(organizationId, 'members', ticket.createdBy)
      : null;
  const assignedToMemberPath =
    ticket?.assignedTo && organizationId
      ? orgDocPath(organizationId, 'members', ticket.assignedTo)
      : null;

  const { data: createdByMember } = useDoc<OrganizationMember>(createdByMemberPath);
  const { data: assignedToMember } = useDoc<OrganizationMember>(assignedToMemberPath);

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportDescription, setReportDescription] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [closeReasonError, setCloseReasonError] = useState('');
  const { toast } = useToast();

  const sortedReports = useMemo(() => {
    return [...(ticket?.reports ?? [])].sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() ?? new Date(0);
      const dateB = b.createdAt?.toDate?.() ?? new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
  }, [ticket?.reports]);
  const isClosed = normalizeTicketStatus(ticket?.status) === 'resolved';

  const currentMember = useMemo(
    () => members.find((m) => m.id === user?.uid) ?? null,
    [members, user?.uid]
  );

  const permissionUser = useMemo(
    () =>
      ({
        id: user?.uid ?? '',
        role: normalizedRole ?? undefined,
        organizationId: organizationId ?? undefined,
        departmentId: currentMember?.departmentId ?? userProfile?.departmentId ?? undefined,
        departmentIds: currentMember?.departmentIds ?? userProfile?.departmentIds ?? undefined,
        locationId: currentMember?.locationId ?? userProfile?.locationId ?? undefined,
        locationIds:
          currentMember?.locationIds ??
          userProfile?.locationIds ??
          undefined,
      } as any),
    [
      user?.uid,
      normalizedRole,
      organizationId,
      currentMember?.departmentId,
      currentMember?.departmentIds,
      currentMember?.locationId,
      currentMember?.locationIds,
      userProfile?.departmentId,
      userProfile?.departmentIds,
      userProfile?.locationId,
      userProfile?.locationIds,
    ]
  );

  const permissions = ticket && user ? getTicketPermissions(ticket, permissionUser, user.uid) : null;

  const userNameMap = useMemo(() => {
    const map: Record<string, string> = {};

    members.forEach((item) => {
      map[item.id] = item.displayName || item.email || item.id;
    });

    if (user) {
      map[user.uid] = userProfile?.displayName || user.email || user.uid;
    }

    if (createdByMember) {
      map[createdByMember.id] =
        createdByMember.displayName || createdByMember.email || createdByMember.id;
    }

    if (assignedToMember) {
      map[assignedToMember.id] =
        assignedToMember.displayName || assignedToMember.email || assignedToMember.id;
    }

    return map;
  }, [assignedToMember, createdByMember, members, user, userProfile]);

  // Memoize derived data
  const siteName = useMemo(() => {
    const locationId = ticket?.locationId;
    return sites?.find((s) => s.id === locationId)?.name || 'N/A';
  }, [sites, ticket]);
  const departmentName = useMemo(() => departments?.find(d => d.id === ticket?.departmentId)?.name || 'N/A', [departments, ticket]);
  const assetName = useMemo(() => assets?.find(a => a.id === ticket?.assetId)?.name || 'N/A', [assets, ticket]);


  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
    // Authorization check after data has loaded
    if (!userLoading && !ticketLoading && ticket && user && userProfile && permissions) {
      if (!permissions.canView) {
        router.push('/incidents');
      }
    }
  }, [permissions, router, ticket, ticketLoading, user, userProfile, userLoading]);

  const handleAddReport = async () => {
    if (!firestore || !ticket?.id) {
      toast({
        title: 'No se pudo registrar el informe',
        description: 'Inténtalo nuevamente en unos instantes. Faltan datos obligatorios.',
        variant: 'destructive',
      });
      return;
    }

    const targetOrganizationId = ticket.organizationId ?? organizationId;

    if (!targetOrganizationId) {
      toast({
        title: 'No se pudo registrar el informe',
        description: 'No se encontró la organización asociada a la incidencia.',
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

    if (!isSuperAdmin && ticket.organizationId !== organizationId) {
      toast({
        title: 'Organización no válida',
        description: 'Tu sesión no coincide con la organización de la incidencia.',
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
      const ticketRef = doc(firestore, orgDocPath(targetOrganizationId, 'tickets', ticket.id));
      await updateDoc(ticketRef, {
        reports: arrayUnion({
          description,
          createdAt: Timestamp.now(),
          createdBy: user.uid,
        }),
        organizationId: targetOrganizationId,
        updatedAt: serverTimestamp(),
      });

      setReportDescription('');
      setIsReportDialogOpen(false);
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

  const handleCloseIncident = async (reason: string) => {
    if (!firestore || !ticket?.id) {
      toast({
        title: 'No se pudo cerrar la incidencia',
        description: 'Inténtalo nuevamente en unos instantes. Faltan datos obligatorios.',
        variant: 'destructive',
      });
      return;
    }

    if (!permissions?.canClose) {
      toast({
        title: 'Permisos insuficientes',
        description: 'No tienes permisos para cerrar esta incidencia.',
        variant: 'destructive',
      });
      return;
    }

    const targetOrganizationId = ticket.organizationId ?? organizationId;

    if (!targetOrganizationId) {
      toast({
        title: 'No se pudo cerrar la incidencia',
        description: 'No se encontró la organización asociada a la incidencia.',
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({
        title: 'Inicia sesión',
        description: 'Debes iniciar sesión para cerrar la incidencia.',
        variant: 'destructive',
      });
      return;
    }

    if (!isSuperAdmin && ticket.organizationId !== organizationId) {
      toast({
        title: 'Organización no válida',
        description: 'Tu sesión no coincide con la organización de la incidencia.',
        variant: 'destructive',
      });
      return;
    }

    setCloseSubmitting(true);

    try {
      const ticketRef = doc(firestore, orgDocPath(targetOrganizationId, 'tickets', ticket.id));
      await updateDoc(ticketRef, {
        status: 'resolved',
        closedAt: serverTimestamp(),
        closedBy: user.uid,
        closedReason: reason,
        organizationId: targetOrganizationId,
        updatedAt: serverTimestamp(),
      });

      setCloseReason('');
      setCloseReasonError('');
      setIsCloseDialogOpen(false);
      toast({
        title: 'Incidencia cerrada',
        description: 'La incidencia se marcó como cerrada.',
      });
    } catch (error) {
      console.error('Error al cerrar la incidencia', error);
      toast({
        title: 'No se pudo cerrar la incidencia',
        description: 'Vuelve a intentarlo en unos segundos.',
        variant: 'destructive',
      });
    } finally {
      setCloseSubmitting(false);
    }
  };

  const handleRequestClose = () => {
    if (!canClose) {
      return;
    }
    setCloseReason('');
    setCloseReasonError('');
    setIsCloseDialogOpen(true);
  };

  const handleConfirmClose = async () => {
    const reason = closeReason.trim();

    if (!reason) {
      setCloseReasonError('Agrega un motivo de cierre antes de continuar.');
      toast({
        title: 'Motivo requerido',
        description: 'Debes indicar el motivo del cierre de la incidencia.',
        variant: 'destructive',
      });
      return;
    }

    await handleCloseIncident(reason);
  };

  const isLoading =
    userLoading ||
    ticketLoading ||
    sitesLoading ||
    deptsLoading ||
    assetsLoading ||
    (isMantenimiento && membersLoading);

  const canEdit = !!permissions?.canEditContent && !isClosed;
  const canClose = !!permissions?.canClose && !isClosed;
  const photoUrls = ticket?.photoUrls?.filter(Boolean) ?? [];
  const attachmentState =
    photoUrls.length > 0 ? 'ready' : ticket?.hasAttachments ? 'pending' : 'none';
  const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
  const getFileName = (url: string) => {
    const cleanUrl = url.split('?')[0] ?? url;
    const parts = cleanUrl.split('/');
    const name = parts[parts.length - 1] || 'Adjunto';
    return decodeURIComponent(name);
  };

  const renderContent = () => {
    if (isLoading || !user) {
      return (
        <div className="flex items-center justify-center py-12">
          <Icons.spinner className="h-8 w-8 animate-spin" />
        </div>
      );
    }

    if (ticketError) {
      return (
        <div className="flex justify-center px-4 py-12">
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
              <Button variant="outline" asChild>
                <Link href="/incidents">Volver al listado</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (!ticket) {
      return (
        <div className="flex justify-center px-4 py-12">
          <Card className="max-w-lg">
            <CardHeader className="text-center">
              <CardTitle>Incidencia no encontrada</CardTitle>
              <CardDescription>La incidencia solicitada no existe o ya no está disponible.</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center pb-6">
              <Button variant="outline" asChild>
                <Link href="/incidents">Volver al listado</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-headline text-2xl font-bold tracking-tight md:text-3xl">
                {ticket.title}
              </h1>
              <Badge variant="outline">{ticketStatusLabel(ticket.status)}</Badge>
              <Badge variant="secondary">{ticket.priority}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/incidents">Volver</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
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
                <CardTitle>Adjuntos</CardTitle>
                <CardDescription>Archivos e imágenes adjuntas a la incidencia.</CardDescription>
              </CardHeader>
              <CardContent>
                {attachmentState === 'ready' ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {photoUrls.map((url, index) => (
                      <a
                        key={`${url}-${index}`}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative block overflow-hidden rounded-lg border border-border/70 bg-muted/20"
                      >
                        {isImageUrl(url) ? (
                          <img
                            src={url}
                            alt={`Adjunto ${index + 1}`}
                            className="h-40 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-40 w-full flex-col items-center justify-center gap-2 px-3 text-center text-sm text-muted-foreground">
                            <FileText className="h-8 w-8" />
                            <span className="line-clamp-2 text-xs">{getFileName(url)}</span>
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-dashed border-border/80 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
                    <FileText className="mt-0.5 h-4 w-4" />
                    {attachmentState === 'pending'
                      ? 'Adjuntos en procesamiento. Si no aparecen en unos minutos, vuelve a intentar la subida.'
                      : 'No hay adjuntos registrados para esta incidencia.'}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="bg-transparent">
              <CardHeader>
                <CardTitle>Informes</CardTitle>
                <CardDescription className="text-foreground/70">
                  Registra los avisos o seguimientos de esta incidencia. Cada informe se agrega con fecha y descripción.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {sortedReports.length ? (
                    sortedReports.map((report, index) => {
                      const date = report.createdAt?.toDate?.() ?? new Date();
                      return (
                        <div
                          key={index}
                          className="rounded-lg border border-white/80 bg-sky-300/20 p-3 text-foreground"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{format(date, 'PPPp')}</span>
                            {report.createdBy ? (
                              <span>Por {userNameMap[report.createdBy] || report.createdBy}</span>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm whitespace-pre-line text-foreground">
                            {report.description}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Aún no hay informes para esta incidencia.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => setIsReportDialogOpen(true)} disabled={isClosed}>
                      Informar
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleRequestClose}
                      disabled={!canClose || closeSubmitting}
                    >
                      {closeSubmitting && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
                      Cerrar incidencia
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 md:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Detalles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {canEdit && (
                  <Button onClick={() => setIsEditDialogOpen(true)} className="w-full">
                    <Edit className="mr-2 h-4 w-4" />
                    Editar Incidencia
                  </Button>
                )}
                <InfoCard
                  icon={CalendarIcon}
                  label="Fecha de Creación"
                  value={
                    ticket.createdAt?.toDate
                      ? format(ticket.createdAt.toDate(), 'dd/MM/yyyy HH:mm')
                      : 'N/A'
                  }
                />
                <InfoCard
                  icon={UserIcon}
                  label="Creado por"
                  value={
                    ticket.createdByName ||
                    createdByMember?.displayName ||
                    (ticket.createdBy ? userNameMap[ticket.createdBy] || ticket.createdBy : 'N/A')
                  }
                />
                {ticket.assignedTo ? (
                  <InfoCard
                    icon={UserIcon}
                    label="Asignado a"
                    value={
                      assignedToMember?.displayName ||
                      (ticket.assignedTo ? userNameMap[ticket.assignedTo] || ticket.assignedTo : 'N/A')
                    }
                  />
                ) : null}
                <InfoCard icon={Building} label="Ubicación" value={siteName} />
                <InfoCard icon={Archive} label="Departamento" value={departmentName} />
                {ticket.assetId && <InfoCard icon={HardHat} label="Activo" value={assetName} />}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <AppShell
        title={ticket?.title || 'Detalle de incidencia'}
        description="Consulta y gestiona la incidencia, agrega informes y actualiza los datos."
      >
        <div className="rounded-lg border border-white/80 bg-card p-6 shadow-sm">
          {renderContent()}
        </div>
      </AppShell>

      {ticket && canEdit && (
        <EditIncidentDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          ticket={ticket}
          users={members}
          departments={departments}
        />
      )}
      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo informe</DialogTitle>
            <DialogDescription>
              Describe el informe o avance que deseas registrar para esta incidencia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="incident-report">Detalle del informe</Label>
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
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsReportDialogOpen(false)}
              disabled={reportSubmitting}
            >
              Cancelar
            </Button>
            <Button onClick={handleAddReport} disabled={reportSubmitting || isClosed}>
              {reportSubmitting && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
              Informar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar incidencia</DialogTitle>
            <DialogDescription>
              Indica el motivo del cierre antes de marcar la incidencia como cerrada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="incident-close-reason">Motivo de cierre</Label>
            <Textarea
              id="incident-close-reason"
              placeholder="Ej. Trabajo completado, incidencia resuelta, etc."
              value={closeReason}
              onChange={(event) => {
                setCloseReason(event.target.value);
                if (closeReasonError) {
                  setCloseReasonError('');
                }
              }}
              disabled={closeSubmitting}
            />
            {closeReasonError && <p className="text-xs text-destructive">{closeReasonError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsCloseDialogOpen(false)}
              disabled={closeSubmitting}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleConfirmClose} disabled={closeSubmitting}>
              {closeSubmitting && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar cierre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
