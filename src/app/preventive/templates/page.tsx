'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { MoreHorizontal } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
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
} from '@/lib/firebase/models';
import { orgCollectionPath, orgPreventiveTemplatesPath } from '@/lib/organization';
import { isFeatureEnabled, normalizePlanId, resolveEffectivePlanFeatures } from '@/lib/entitlements';

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

const formatDateTime = (value: any) => {
  if (!value?.toDate) return 'N/A';
  const d: Date = value.toDate();
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

type TemplateChecklistItem = { label: string; required?: boolean; order?: number };

const serializeChecklistToText = (items?: unknown[]) => {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items
    .map((it: any) => {
      const label = String(it?.label ?? it ?? '').trim();
      if (!label) return null;
      const required = it?.required !== false;
      return required ? label : `? ${label}`;
    })
    .filter(Boolean)
    .join('\n');
};

const parseChecklistText = (text?: string): TemplateChecklistItem[] => {
  const raw = String(text ?? '').split(/\r?\n/);
  const out: TemplateChecklistItem[] = [];
  let order = 0;
  for (const line of raw) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const optional = trimmed.startsWith('?');
    const label = trimmed.replace(/^\?\s*/, '').trim();
    if (!label) continue;
    out.push({ label, required: optional ? false : true, order: order++ });
  }
  return out;
};

function PreventiveTemplatesTable({
  organizationId,
  templates,
  loading,
  sites,
  departments,
  assets,
  preventivesBlocked,
  preventivesPaused,
}: {
  organizationId: string;
  templates: PreventiveTemplate[];
  loading: boolean;
  sites: Site[];
  departments: Department[];
  assets: Asset[];
  preventivesBlocked: boolean;
  preventivesPaused: boolean;
}) {
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
      checklistText: serializeChecklistToText((activeTemplate as any).checklist),
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

  const handleGenerateNow = async (template: PreventiveTemplate) => {
    if (!app) {
      toast({ title: 'Firebase', description: 'No se pudo inicializar Firebase App.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const fn = httpsCallable(getFunctions(app), 'workOrders_generateNow');
      const res = await fn({ organizationId, templateId: template.id });
      const woId = (res.data as any)?.woId ?? null;
      toast({
        title: 'Preventivo generado',
        description: woId ? `OT creada (${woId}).` : 'OT creada.',
      });
    } catch (err: any) {
      console.error('workOrders_generateNow failed', err);
      toast({
        title: 'No se pudo generar',
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

      const checklist = parseChecklistText((values as any).checklistText);

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
        checklist,
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
              <TableHead>Motivo pausa</TableHead>
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
                  <TableCell>{formatDateTime(template.schedule?.nextRunAt)}</TableCell>
                  <TableCell>{template.status === 'paused' ? template.pausedReason || '—' : '—'}</TableCell>
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
                        <DropdownMenuItem
                          onClick={() => handleGenerateNow(template)}
                          disabled={
                            submitting ||
                            preventivesBlocked ||
                            preventivesPaused ||
                            template.status !== 'active' ||
                            !template.siteId ||
                            !template.departmentId
                          }
                        >
                          Generar ahora
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(template)} disabled={submitting}>
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(template)} disabled={submitting}>
                          Duplicar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No se encontraron plantillas preventivas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setActiveTemplate(null);
        }}
      >
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
              onCancel={() => {
                setEditOpen(false);
                setActiveTemplate(null);
              }}
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

export default function PreventiveTemplatesPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user, loading: userLoading, organizationId } = useUser();
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
    const normalizedPlanId = normalizePlanId(organization.entitlement.planId);
    getDoc(doc(firestore, 'planCatalog', normalizedPlanId))
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
  const preventivesAllowed = entitlement
    ? isFeatureEnabled(
        {
          ...entitlement,
          features: resolveEffectivePlanFeatures(normalizePlanId(entitlement.planId), planFeatures),
        },
        'PREVENTIVES'
      )
    : false;
  const preventivesPaused = Boolean(organization?.preventivesPausedByEntitlement);
  const isDemoOrganization =
    organization?.type === 'demo' ||
    organization?.subscriptionPlan === 'trial' ||
    (organizationId ? organizationId.startsWith('demo-') : false);

  const { data: templates, loading: templatesLoading } = useCollectionQuery<PreventiveTemplate>(
    organizationId ? orgPreventiveTemplatesPath(organizationId) : null
  );

  const demoTemplateLimitReached = isDemoOrganization && templates.length >= 5;
  const preventivesBlockedByPlan = !preventivesAllowed && !isDemoOrganization;
  const preventivesBlocked = preventivesBlockedByPlan || demoTemplateLimitReached;

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
      title="Plantillas"
      description="Plantillas de mantenimiento preventivo"
      action={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/preventive">Volver</Link>
          </Button>
          {preventivesBlocked || preventivesPaused ? (
            <Button disabled>Crear plantilla</Button>
          ) : (
            <Button asChild>
              <Link href="/preventive/new">Crear plantilla</Link>
            </Button>
          )}
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Plantillas Preventivas</CardTitle>
          <CardDescription className="mt-2">
            Define la programación y alcance de las órdenes preventivas.
          </CardDescription>
          {preventivesBlocked ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-200">
              <span>
                {demoTemplateLimitReached
                  ? 'La demo permite hasta 5 plantillas preventivas. Cambia tu plan para crear más.'
                  : 'Tu plan actual no incluye preventivos. Actualiza tu plan para habilitar esta función.'}
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
        </CardHeader>
        <CardContent>
          <PreventiveTemplatesTable
            organizationId={organizationId}
            templates={templates}
            loading={templatesLoading}
            sites={sites}
            departments={departments}
            assets={assets}
            preventivesBlocked={preventivesBlocked}
            preventivesPaused={preventivesPaused}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
