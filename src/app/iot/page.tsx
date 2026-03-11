'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Cpu, Plus, RadioTower, Thermometer, Waypoints } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { AddAssetDialog } from '@/components/add-asset-dialog';
import { IotPanelCard } from '@/components/iot-panel-card';
import { IotDeviceAdminDialog } from '@/components/iot-device-admin-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { useCollection, useUser } from '@/lib/firebase';
import type { Asset, Site } from '@/lib/firebase/models';
import { orgCollectionPath } from '@/lib/organization';
import { canManageMasterData, normalizeRole } from '@/lib/rbac';
import { useRouter } from 'next/navigation';

export default function IotPage() {
  const { user, loading: userLoading, organizationId, role } = useUser();
  const router = useRouter();
  const [isAddAssetOpen, setIsAddAssetOpen] = useState(false);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [router, user, userLoading]);

  const { data: assets = [], loading: assetsLoading } = useCollection<Asset>(
    organizationId ? orgCollectionPath(organizationId, 'assets') : null
  );
  const { data: sites = [], loading: sitesLoading } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );

  const normalizedRole = normalizeRole(role);
  const canManage = canManageMasterData(normalizedRole);
  const iotAssets = assets.filter((asset) => asset.iot?.enabled);
  const siteNameById = sites.reduce<Record<string, string>>((acc, site) => {
    acc[site.id] = site.name;
    return acc;
  }, {});
  const onlineCount = iotAssets.filter((asset) => {
    const status = asset.iot?.lastReading?.status ?? null;
    return status === 'online';
  }).length;

  if (userLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <AppShell
      title="Panel IoT"
      description="Dispositivos conectados, sensores y paneles visuales dentro de Mainteligence."
      action={
        canManage ? (
          <Button onClick={() => setIsAddAssetOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo activo IoT
          </Button>
        ) : null
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={<Cpu className="h-5 w-5 text-sky-300" />}
          label="Dispositivos IoT"
          value={String(iotAssets.length)}
          help="Activos con panel configurado"
        />
        <SummaryCard
          icon={<RadioTower className="h-5 w-5 text-emerald-300" />}
          label="En linea"
          value={String(onlineCount)}
          help="Segun el ultimo estado recibido"
        />
        <SummaryCard
          icon={<Waypoints className="h-5 w-5 text-amber-300" />}
          label="Pendientes de migrar"
          value={String(assets.length - iotAssets.length)}
          help="Activos sin configuracion IoT"
        />
      </div>

      <Card className="mt-6 border-white/60 bg-sky-400/15">
        <CardHeader>
          <CardTitle>Puente de migracion</CardTitle>
          <CardDescription>
            Esta vista ya lee los paneles desde `assets`. El siguiente paso natural es sincronizar la ultima lectura en `asset.iot.lastReading` desde tu MySQL o desde los ESP directamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-xl border border-white/60 bg-background p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <Thermometer className="h-4 w-4 text-sky-500" />
              Campos legacy compatibles
            </div>
            Temp1, Temp2, Hum1, Set1, REL1..REL4, AL0..AL8.
          </div>
          <div className="rounded-xl border border-white/60 bg-background p-4">
            <div className="mb-2 font-semibold text-foreground">Ruta recomendada</div>
            Firestore `organizations/{orgId}/assets/{assetId}` con `iot.deviceKey`, `panelType`, `lastReading`.
          </div>
          <div className="rounded-xl border border-white/60 bg-background p-4">
            <div className="mb-2 font-semibold text-foreground">Estado actual</div>
            La app ya no depende del plugin WordPress para renderizar el panel dentro de Mainteligence.
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        {assetsLoading || sitesLoading ? (
          <div className="flex min-h-40 items-center justify-center rounded-2xl border border-white/60 bg-background xl:col-span-2">
            <Icons.spinner className="h-8 w-8 animate-spin" />
          </div>
        ) : iotAssets.length > 0 ? (
          iotAssets.map((asset) => (
            <div key={asset.id} className="space-y-3">
              <IotPanelCard asset={asset} siteName={siteNameById[asset.siteId]} />
              {canManage ? <IotDeviceAdminDialog asset={asset} /> : null}
            </div>
          ))
        ) : (
          <Card className="border-dashed border-white/60 bg-background xl:col-span-2">
            <CardContent className="flex min-h-56 flex-col items-center justify-center text-center">
              <Cpu className="mb-4 h-10 w-10 text-muted-foreground" />
              <h3 className="text-lg font-semibold">Todavia no hay activos IoT configurados</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Los activos normales ya existen en la app, pero aun no tienen metadatos IoT. Marca un activo nuevo como IoT para empezar a visualizar termostatos, sensores o reles desde aqui.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {canManage ? (
                  <Button onClick={() => setIsAddAssetOpen(true)}>Crear activo IoT</Button>
                ) : null}
                <Button asChild variant="outline">
                  <Link href="/assets">Ir a activos</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {canManage ? (
        <AddAssetDialog open={isAddAssetOpen} onOpenChange={setIsAddAssetOpen} sites={sites} />
      ) : null}
    </AppShell>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  help,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  help: string;
}) {
  return (
    <Card className="border-white/60 bg-slate-950 text-white shadow-lg shadow-slate-950/20">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-300">{label}</div>
            <div className="mt-2 text-4xl font-semibold">{value}</div>
            <div className="mt-2 text-xs text-slate-400">{help}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}


