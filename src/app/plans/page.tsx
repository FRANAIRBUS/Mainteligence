'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
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
  free: 'Demo',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

type UsageRow = {
  label: string;
  usage?: number;
  limit?: number;
};

const PLAN_ORDER: EntitlementPlanId[] = ['free', 'starter', 'pro', 'enterprise'];

const PLAN_PRICE_LABELS: Record<EntitlementPlanId, { price: string; note: string }> = {
  free: { price: 'Gratis', note: 'Para equipos pequeños y pruebas.' },
  starter: { price: 'Consultar', note: 'Ideal para operaciones en crecimiento.' },
  pro: { price: 'Consultar', note: 'Mayor capacidad y automatización.' },
  enterprise: { price: 'A medida', note: 'Para organizaciones con altos volúmenes.' },
};

const LIMIT_LABELS: Array<{ key: keyof ReturnType<typeof getDefaultPlanLimits>; label: string }> = [
  { key: 'maxSites', label: 'Ubicaciones' },
  { key: 'maxAssets', label: 'Activos' },
  { key: 'maxDepartments', label: 'Departamentos' },
  { key: 'maxUsers', label: 'Usuarios' },
  { key: 'maxActivePreventives', label: 'Preventivos activos' },
  { key: 'attachmentsMonthlyMB', label: 'Adjuntos al mes (MB)' },
];

const FEATURE_LABELS = {
  EXPORT_PDF: 'Exportación PDF',
  AUDIT_TRAIL: 'Auditoría y trazabilidad',
  PREVENTIVES: 'Preventivos automáticos',
} as const;

function formatLimit(limit?: number) {
  if (!Number.isFinite(limit)) return '∞';
  if (limit == null) return '—';
  if (limit <= 0) return '∞';
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
    toast({
      title: `Plan ${PLAN_LABELS[planId]}`,
      description: 'Para activar este plan, contacta al equipo comercial.',
    });
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
                      <p className="text-xs text-muted-foreground">Factura según contrato comercial.</p>
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
                        <Button variant="outline" onClick={() => router.push('/onboarding')}>
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
      </div>
    </AppShell>
  );
}
