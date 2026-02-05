'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, where } from 'firebase/firestore';
import { MoreHorizontal } from 'lucide-react';

import { Icons } from '@/components/icons';
import { AppShell } from '@/components/app-shell';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useToast } from '@/hooks/use-toast';

import {
  PreventiveTemplateForm,
  type PreventiveTemplateFormValues,
} from '@/components/preventive-template-form';

import {
  useCollection,
  useCollectionQuery,
  useDoc,
  useFirebaseApp,
  useFirestore,
  useUser,
} from '@/lib/firebase';
import type {
  Asset,
  Department,
  Organization,
  PreventiveTemplate,
  Site,
  Ticket,
} from '@/lib/firebase/models';
import { orgCollectionPath, orgPreventiveTemplatesPath } from '@/lib/organization';
import { ticketStatusLabel } from '@/lib/status';
import { isFeatureEnabled } from '@/lib/entitlements';

const normalizeOptional = (value?: string) =>
  value && value !== '__none__' ? value : undefined;

const toIsoDate = (value: any): string | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value?.toDate) {
    const d: Date = value.toDate();
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return undefined;
};

const formatSchedule = (template: PreventiveTemplate) => {
  const schedule = template.schedule;
  if (!schedule) return 'Sin programación';
  switch (schedule.type) {
    case 'daily':
      return 'Diaria';
    case 'weekly': {
      const days = schedule.daysOfWeek?.length ? schedule.daysOfWeek.join(', ') : '—';
      return `Semanal (${days})`;
    }
    case 'monthly':
      return schedule.dayOfMonth ? `Mensual (día ${schedule.dayOfMonth})` : 'Mensual';
    case 'date':
      return schedule.date?.toDate ? schedule.date.toDate().toLocaleDateString() : 'Fecha específica';
    default:
      return 'Sin programación';
  }
};

function PreventiveTable({ tickets, loading }: { tickets: Ticket[]; loading: boolean }) {
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
              <TableCell className="font-medium">{ticket.displayId || ticket.id.substring(0, 6)}</TableCell>
              <TableCell>{ticket.title}</TableCell>
              <TableCell>
                <Badge variant="outline">{ticketStatusLabel(ticket.status)}</Badge>
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
                    <Button aria-haspopup="true" size="icon" variant="ghost">
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

function PreventiveTemplatesTable({
  organizationId,
  templates,
  loading,
  sites,
  departments,
  assets,
}: {
  organizationId: string;
  templates: PreventiveTemplate[];
  loading: boolean;
  sites: Site[];
  departments: Department[];
  assets: Asset[];
}) {
  const router = useRouter();
  const app = useFirebaseApp();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<PreventiveTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const defaultValues = useMemo(() => {
    if (!activeTemplate) return undefined;

    const schedule = activeTemplate.schedule;

    return {
      name: activeTemplate.name ?? '',
      description: activeTemplate.description ?? '',
      status: (activeTemplate.status as any) ?? 'active',
      automatic: Boolean(activeTemplate.automatic),
      scheduleType: (schedule?.type as any) ?? 'monthly',
      timeOfDay: schedule?.timeOfDay ?? '08:00',
      daysOfWeek: schedule?.daysOfWeek ?? [],
      dayOfMonth: schedule?.dayOfMonth ? String(schedule.dayOfMonth) : undefined,
      date: toIsoDate(schedule?.date),
      priority: (activeTemplate.priority as any) ?? 'Media',
      siteId: activeTemplate.siteId ?? '__none__',
      departmentId: activeTemplate.departmentId ?? '__none__',
      assetId: activeTemplate.assetId ?? '__none__',
    } as Partial<PreventiveTemplateFormValues>;
  }, [activeTemplate]);

  const openEdit = (template: PreventiveTemplate) => {
    setErrorMessage(null);
    setActiveTemplate(template);
    setEditOpen(true);
  };

  const handleDuplicate = async (template: PreventiveTemplate) => {
    if (!app) {
      toast({ title: 'Firebase', description: 'No se pudo inicializar Firebase App.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const fn = httpsCallable(getFunctions(app), 'duplicatePreventiveTemplate');
      const res = await fn({ organizationId, templateId: template.id });
      const newId = (res.data as any)?.templateId ?? null;
      toast({
        title: 'Plantilla duplicada',
        description: newId ? `Nueva plantilla creada (${newId}).` : 'Nueva plantilla creada.',
      });
    } catch (err: any) {
      console.error('duplicatePreventiveTemplate failed', err);
      toast({
        title: 'No se pudo duplicar',
        description: err?.message || 'Error inesperado.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (values: PreventiveTemplateFormValues) => {
    if (!app) {
      setErrorMessage('No se pudo inicializar Firebase App.');
      return;
    }

    if (!activeTemplate?.id) {
      setErrorMessage('No se pudo resolver la plantilla a editar.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const fn = httpsCallable(getFunctions(app), 'updatePreventiveTemplate');

      await fn({
        organizationId,
        templateId: activeTemplate.id,
        name: values.name.trim(),
        description: values.description?.trim() || null,
        status: values.status,
        automatic: values.automatic,
        schedule: {
          type: values.scheduleType,
          timezone:
            typeof Intl !== 'undefined'
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : undefined,
          timeOfDay: values.timeOfDay?.trim() || undefined,
          daysOfWeek: values.daysOfWeek?.length ? values.daysOfWeek : undefined,
          dayOfMonth:
            typeof values.dayOfMonth === 'number' && !Number.isNaN(values.dayOfMonth)
              ? values.dayOfMonth
              : undefined,
          date: values.date ? values.date : undefined,
        },
        priority: values.priority,
        siteId: normalizeOptional(values.siteId),
        departmentId: normalizeOptional(values.departmentId),
        assetId: normalizeOptional(values.assetId),
      });

      toast({ title: 'Plantilla actualizada' });
      setEditOpen(false);
      setActiveTemplate(null);
    } catch (error: any) {
      console.error('updatePreventiveTemplate failed', error);
      const msg = error?.message || 'No se pudo actualizar la plantilla.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Programación</TableHead>
              <TableHead>Automático</TableHead>
              <TableHead>Próxima ejecución</TableHead>
              <TableHead>
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length > 0 ? (
              templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{template.status}</Badge>
                  </TableCell>
                  <TableCell>{formatSchedule(template)}</TableCell>
                  <TableCell>
                    <Badge variant={template.automatic ? 'secondary' : 'outline'}>
                      {template.automatic ? 'Sí' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {template.schedule?.nextRunAt?.toDate
                      ? template.schedule.nextRunAt.toDate().toLocaleDateString()
                      : 'N/A'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost" disabled={submitting}>
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Menú de acciones</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => openEdit(template)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(template)}>Duplicar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No se encontraron plantillas preventivas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setActiveTemplate(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar plantilla preventiva</DialogTitle>
          </DialogHeader>
          <div className="rounded-lg border border-white/80 bg-card p-6 shadow-sm">
            <PreventiveTemplateForm
              defaultValues={defaultValues}
              onSubmit={handleUpdate}
              submitting={submitting}
              errorMessage={errorMessage}
              onCancel={() => { setEditOpen(false); setActiveTemplate(null); }}
              sites={sites}
              departments={departments}
              assets={assets}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
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
        const features = (snap.exists()
          ? (snap.data()?.features as Record<string, boolean>)
          : null) ?? null;
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
    organizationId ? orgCollectionPath(organizationId, 'tickets') : null,
    where('type', '==', 'preventivo')
  );

  const { data: templates, loading: templatesLoading } = useCollectionQuery<PreventiveTemplate>(
    organizationId ? orgPreventiveTemplatesPath(organizationId) : null
  );

  const { data: sites } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );
  const { data: assets } = useCollection<Asset>(
    organizationId ? orgCollectionPath(organizationId, 'assets') : null
  );

  if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">No se pudo resolver la organización.</p>
      </div>
    );
  }

  return (
    <AppShell
      title="Preventivos"
      description="Plantillas y órdenes de mantenimiento preventivo"
      action={
        preventivesBlocked || preventivesPaused ? (
          <Button disabled>Crear Plantilla</Button>
        ) : (
          <Button asChild>
            <Link href="/preventive/new">Crear Plantilla</Link>
          </Button>
        )
      }
    >
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Plantillas Preventivas</CardTitle>
              <CardDescription className="mt-2">
                Define la programación y alcance de las órdenes preventivas.
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
          </div>
        </CardHeader>
        <CardContent>
          <PreventiveTemplatesTable
            organizationId={organizationId}
            templates={templates}
            loading={templatesLoading}
            sites={sites}
            departments={departments}
            assets={assets}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Mantenimiento Preventivo</CardTitle>
              <CardDescription className="mt-2">
                Visualiza y gestiona todas las órdenes de mantenimiento preventivo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <PreventiveTable tickets={tickets} loading={ticketsLoading} />
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
