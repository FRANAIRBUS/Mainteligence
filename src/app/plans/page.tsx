'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useDoc, useUser } from '@/lib/firebase';
import type { Organization } from '@/lib/firebase/models';

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
  const { data: organization, loading: orgLoading } = useDoc<Organization>(
    organizationId ? `organizations/${organizationId}` : null
  );

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [router, user, userLoading]);

  const entitlement = organization?.entitlement ?? null;
  const planLabel = entitlement?.planId ? PLAN_LABELS[entitlement.planId] ?? entitlement.planId : '—';

  const usageRows: UsageRow[] = useMemo(() => {
    return [
      {
        label: 'Ubicaciones',
        usage: entitlement?.usage?.sitesCount,
        limit: entitlement?.limits?.maxSites,
      },
      {
        label: 'Activos',
        usage: entitlement?.usage?.assetsCount,
        limit: entitlement?.limits?.maxAssets,
      },
      {
        label: 'Departamentos',
        usage: entitlement?.usage?.departmentsCount,
        limit: entitlement?.limits?.maxDepartments,
      },
      {
        label: 'Usuarios',
        usage: entitlement?.usage?.usersCount,
        limit: entitlement?.limits?.maxUsers,
      },
      {
        label: 'Preventivos activos',
        usage: entitlement?.usage?.activePreventivesCount,
        limit: entitlement?.limits?.maxActivePreventives,
      },
    ];
  }, [entitlement?.limits, entitlement?.usage]);

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

  return (
    <AppShell title="Planes" description="Revisa tu plan actual y el uso de la cuenta.">
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Plan actual</CardTitle>
            <CardDescription>
              {orgLoading ? 'Cargando...' : `Plan: ${planLabel}`}
            </CardDescription>
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
            <CardTitle>Actualizar plan</CardTitle>
            <CardDescription>Elige la modalidad de facturación que prefieras.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleMonthlyCta}>Elegir mensual</Button>
            <Button variant="outline" onClick={handleAnnualCta}>
              Elegir anual
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
