'use client';

import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useDoc, useFirestore, useUser } from '@/lib/firebase';
import type { EntitlementPlanId, Organization } from '@/lib/firebase/models';
import {
  getDefaultPlanFeatures,
  getDefaultPlanLimits,
  isFeatureEnabled,
  resolveEffectivePlanFeatures,
  resolveEffectivePlanLimits,
} from '@/lib/entitlements';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  basic: 'Basic',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

type UsageRow = {
  label: string;
  usage?: number;
  limit?: number;
};

const PLAN_ORDER: EntitlementPlanId[] = ['free', 'basic', 'starter', 'pro', 'enterprise'];

const PLAN_PRICE_LABELS: Record<EntitlementPlanId, { price: string; note: string }> = {
  free: { price: '0€ / mes', note: 'Para equipos pequeños y pruebas.' },
  basic: { price: '4,99€ / mes', note: 'Para operaciones básicas con límites ampliados.' },
  starter: { price: '19€ / mes', note: 'Ideal para operaciones en crecimiento.' },
  pro: { price: '49€ / mes', note: 'Mayor capacidad y automatización.' },
  enterprise: { price: 'A medida', note: 'Para organizaciones con altos volúmenes.' },
};

const LIMIT_LABELS: Array<{ key: keyof ReturnType<typeof getDefaultPlanLimits>; label: string }> = [
  { key: 'maxOpenTickets', label: 'Incidencias abiertas' },
  { key: 'maxOpenTasks', label: 'Tareas abiertas' },
  { key: 'maxSites', label: 'Ubicaciones' },
  { key: 'maxAssets', label: 'Activos' },
  { key: 'maxDepartments', label: 'Departamentos' },
  { key: 'maxUsers', label: 'Usuarios' },
  { key: 'maxActivePreventives', label: 'Preventivos activos' },
  { key: 'attachmentsMonthlyMB', label: 'Adjuntos al mes (MB)' },
  { key: 'maxAttachmentMB', label: 'Tamaño máximo por adjunto (MB)' },
  { key: 'maxAttachmentsPerTicket', label: 'Adjuntos por incidencia' },
  { key: 'retentionDays', label: 'Retención (días)' },
];

const FEATURE_LABELS = {
  EXPORT_PDF: 'Exportación PDF',
  AUDIT_TRAIL: 'Auditoría y trazabilidad',
  PREVENTIVES: 'Preventivos automáticos',
} as const;

function formatLimit(limit?: number) {
  if (limit == null) return '—';
  if (!Number.isFinite(limit)) return '∞';
  return String(limit);
}

function getProgress(usage?: number, limit?: number) {
  if (!Number.isFinite(limit) || limit == null || limit <= 0) return 0;
  if (usage == null) return 0;
  return Math.min(100, Math.round((usage / limit) * 100));
}

export default function PlansPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, loading: userLoading, organizationId } = useUser();
  const firestore = useFirestore();
  const [planFeatures, setPlanFeatures] = useState<Record<string, boolean> | null>(null);
  const [planLimits, setPlanLimits] = useState<Record<string, number> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<EntitlementPlanId>('free');
  const { data: organization, loading: orgLoading } = useDoc<Organization>(
    organizationId ? `organizations/${organizationId}` : null
  );

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [router, user, userLoading]);

  useEffect(() => {
    if (!firestore || !organization?.entitlement?.planId) {
      setPlanFeatures(null);
      setPlanLimits(null);
      return;
    }

    let cancelled = false;

    getDoc(doc(firestore, 'planCatalog', organization.entitlement.planId))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : null;
        setPlanFeatures((data?.features as Record<string, boolean> | undefined) ?? null);
        setPlanLimits((data?.limits as Record<string, number> | undefined) ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setPlanFeatures(null);
        setPlanLimits(null);
      });

    return () => {
      cancelled = true;
    };
  }, [firestore, organization?.entitlement?.planId]);

  const entitlement = organization?.entitlement ?? null;
  const planLabel = entitlement?.planId ? PLAN_LABELS[entitlement.planId] ?? entitlement.planId : '—';
  const currentPlanId = entitlement?.planId ?? 'free';
  const currentPlanLimits = getDefaultPlanLimits(currentPlanId);
  const currentPlanFeatures = getDefaultPlanFeatures(currentPlanId);

  const effectiveLimits = entitlement
    ? resolveEffectivePlanLimits(entitlement.planId, (planLimits as any) ?? entitlement.limits)
    : null;
  const effectiveFeatures = entitlement
    ? resolveEffectivePlanFeatures(entitlement.planId, (planFeatures as any) ?? null)
    : null;
  const preventivesEnabled = entitlement
    ? isFeatureEnabled({ ...entitlement, features: effectiveFeatures ?? undefined }, 'PREVENTIVES')
    : false;

  const usageRows: UsageRow[] = useMemo(() => {
    return [
      {
        label: 'Incidencias abiertas',
        usage: entitlement?.usage?.openTicketsCount,
        limit: effectiveLimits?.maxOpenTickets,
      },
      {
        label: 'Tareas abiertas',
        usage: entitlement?.usage?.openTasksCount,
        limit: effectiveLimits?.maxOpenTasks,
      },
      {
        label: 'Ubicaciones',
        usage: entitlement?.usage?.sitesCount,
        limit: effectiveLimits?.maxSites,
      },
      {
        label: 'Activos',
        usage: entitlement?.usage?.assetsCount,
        limit: effectiveLimits?.maxAssets,
      },
      {
        label: 'Departamentos',
        usage: entitlement?.usage?.departmentsCount,
        limit: effectiveLimits?.maxDepartments,
      },
      {
        label: 'Usuarios',
        usage: entitlement?.usage?.usersCount,
        limit: effectiveLimits?.maxUsers,
      },
      {
        label: 'Preventivos activos',
        usage: entitlement?.usage?.activePreventivesCount,
        limit: effectiveLimits?.maxActivePreventives,
      },
      {
        label: 'Adjuntos este mes (MB)',
        usage: entitlement?.usage?.attachmentsThisMonthMB,
        limit: effectiveLimits?.attachmentsMonthlyMB,
      },
    ];
  }, [effectiveLimits, entitlement?.usage]);

  const handleMonthlyCta = () => {
    toast({
      title: 'Plan mensual',
      description: 'Para activar el plan mensual, contacta al equipo comercial.',
    });
  };

  const handleAnnualCta = () => {
    toast({
      title: 'Plan anual',
      description: 'Para activar el plan anual, contacta al equipo comercial.',
    });
  };

  const handlePlanCta = (planId: EntitlementPlanId) => {
    setSelectedPlanId(planId);
    setDialogOpen(true);
  };

  const handleSalesCta = (planId: EntitlementPlanId) => {
    setSelectedPlanId(planId);
    setDialogOpen(true);
  };

  const handleSubmitLead = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    if (!name || !email) {
      toast({
        title: 'Completa los datos',
        description: 'Nombre y correo son obligatorios para enviar la solicitud.',
      });
      return;
    }

    toast({
      title: 'Solicitud enviada',
      description: 'El equipo comercial revisará tu solicitud y te contactará pronto.',
    });
    event.currentTarget.reset();
    setDialogOpen(false);
  };

  const planCards = PLAN_ORDER.map((planId) => {
    const limits = getDefaultPlanLimits(planId);
    const features = getDefaultPlanFeatures(planId);
    const improvements = LIMIT_LABELS.flatMap(({ key, label }) => {
      const currentValue = currentPlanLimits[key];
      const nextValue = limits[key];
      if (!Number.isFinite(currentValue) || !Number.isFinite(nextValue)) return [];
      if (nextValue > currentValue) {
        return [`Más ${label.toLowerCase()} (hasta ${formatLimit(nextValue)})`];
      }
      return [];
    });

    (Object.keys(FEATURE_LABELS) as Array<keyof typeof FEATURE_LABELS>).forEach((featureKey) => {
      if (features[featureKey] && !currentPlanFeatures[featureKey]) {
        improvements.push(`Incluye ${FEATURE_LABELS[featureKey]}`);
      }
    });

    return {
      planId,
      label: PLAN_LABELS[planId] ?? planId,
      pricing: PLAN_PRICE_LABELS[planId],
      limits,
      features,
      improvements: improvements.length ? improvements : ['Sin cambios respecto a tu plan actual.'],
    };
  });

  return (
    <AppShell title="Planes" description="Revisa tu plan actual y compara opciones de upgrade.">
      <div className="space-y-6">
        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Plan actual</CardTitle>
                  <CardDescription>
                    {orgLoading ? 'Cargando...' : `Plan: ${planLabel}`}
                  </CardDescription>
                  {!orgLoading && entitlement ? (
                    <p className="text-xs text-muted-foreground">
                      Preventivos: {preventivesEnabled ? 'habilitados' : 'no incluidos en el plan'}
                    </p>
                  ) : null}
                </div>
                <Badge variant="secondary">Activo</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {usageRows.map((row) => (
                <div key={row.label} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{row.label}</span>
                    <span className="text-muted-foreground">
                      {row.usage ?? 0}/{formatLimit(row.limit)}
                    </span>
                  </div>
                  <Progress value={getProgress(row.usage, row.limit)} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Modalidades de facturación</CardTitle>
              <CardDescription>Selecciona la opción que mejor se adapte.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Button onClick={handleMonthlyCta}>Elegir mensual</Button>
              <Button variant="outline" onClick={handleAnnualCta}>
                Elegir anual
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Planes disponibles</h2>
            <p className="text-sm text-muted-foreground">
              Compara capacidades, limitaciones y nuevas funciones antes de solicitar un upgrade.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {planCards.map((plan) => (
              <Card key={plan.planId} className="h-full">
                <Collapsible>
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{plan.label}</CardTitle>
                        <CardDescription>{plan.pricing.note}</CardDescription>
                      </div>
                      {currentPlanId === plan.planId ? (
                        <Badge variant="default">Tu plan</Badge>
                      ) : (
                        <Badge variant="outline">Disponible</Badge>
                      )}
                    </div>
                    <div>
                      <p className="text-2xl font-semibold leading-none">{plan.pricing.price}</p>
                      <p className="text-xs text-muted-foreground">Precio por organización.</p>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>Ubicaciones: {formatLimit(plan.limits.maxSites)}</p>
                      <p>Activos: {formatLimit(plan.limits.maxAssets)}</p>
                      <p>Preventivos: {formatLimit(plan.limits.maxActivePreventives)}</p>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full">
                        Ver detalles
                      </Button>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CardContent>
                    <CollapsibleContent className="space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold">Mejoras al cambiar</h3>
                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {plan.improvements.map((item) => (
                            <li key={item}>• {item}</li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold">Límites incluidos</h3>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {LIMIT_LABELS.map(({ key, label }) => (
                            <div key={key} className="flex items-center justify-between">
                              <span>{label}</span>
                              <span>{formatLimit(plan.limits[key])}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold">Funciones</h3>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {(Object.keys(FEATURE_LABELS) as Array<keyof typeof FEATURE_LABELS>).map((key) => (
                            <div key={key} className="flex items-center justify-between">
                              <span>{FEATURE_LABELS[key]}</span>
                              <span>{plan.features[key] ? 'Incluido' : 'No incluido'}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Button
                          onClick={() => handlePlanCta(plan.planId)}
                          disabled={currentPlanId === plan.planId}
                        >
                          {currentPlanId === plan.planId ? 'Plan actual' : 'Solicitar upgrade'}
                        </Button>
                        <Button variant="outline" onClick={() => handleSalesCta(plan.planId)}>
                          Hablar con ventas
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </CardContent>
                </Collapsible>
              </Card>
            ))}
          </div>
        </section>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Solicitar upgrade</DialogTitle>
              <DialogDescription>
                Comparte tus datos para activar el plan {PLAN_LABELS[selectedPlanId]}.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleSubmitLead}>
              <div className="grid gap-2">
                <Label htmlFor="lead-name">Nombre completo</Label>
                <Input id="lead-name" name="name" placeholder="Tu nombre" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lead-email">Correo corporativo</Label>
                <Input
                  id="lead-email"
                  name="email"
                  type="email"
                  placeholder="nombre@empresa.com"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lead-company">Empresa</Label>
                <Input id="lead-company" name="company" placeholder="Nombre de la empresa" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lead-message">Necesidades específicas</Label>
                <Textarea
                  id="lead-message"
                  name="message"
                  placeholder="Ej. número de usuarios, activos o integraciones requeridas"
                  rows={4}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit">Enviar solicitud</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
