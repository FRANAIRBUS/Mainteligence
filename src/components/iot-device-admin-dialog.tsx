'use client';

import { useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Bot, KeyRound, SlidersHorizontal } from 'lucide-react';

import type { Asset } from '@/lib/firebase/models';
import { useFirebaseApp, useUser } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ProvisioningResult = {
  organizationId: string;
  assetId: string;
  deviceKey: string;
  bootstrapToken: string;
  bootstrapExpiresAt: string;
  bootstrapUrl: string;
  syncUrl: string;
  pollIntervalMs: number;
};

function formatMaybeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value.toLocaleString('es-ES');
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString('es-ES');
  }
  if (typeof value === 'object' && value !== null) {
    const maybeValue = value as { toDate?: () => Date; seconds?: number };
    if (typeof maybeValue.toDate === 'function') {
      return maybeValue.toDate().toLocaleString('es-ES');
    }
    if (typeof maybeValue.seconds === 'number') {
      return new Date(maybeValue.seconds * 1000).toLocaleString('es-ES');
    }
  }
  return null;
}

export function IotDeviceAdminDialog({ asset }: { asset: Asset }) {
  const app = useFirebaseApp();
  const { toast } = useToast();
  const { organizationId } = useUser();
  const [open, setOpen] = useState(false);
  const [loadingProvision, setLoadingProvision] = useState(false);
  const [provisioning, setProvisioning] = useState<ProvisioningResult | null>(null);

  const deviceSnippet = useMemo(() => {
    if (!provisioning) return '';
    return JSON.stringify(
      {
        organizationId: provisioning.organizationId,
        deviceKey: provisioning.deviceKey,
        bootstrapToken: provisioning.bootstrapToken,
        bootstrapUrl: provisioning.bootstrapUrl,
        syncUrl: provisioning.syncUrl,
        pollIntervalMs: provisioning.pollIntervalMs,
      },
      null,
      2
    );
  }, [provisioning]);

  const bootstrappedAt = formatMaybeDate(asset.iot?.provisioning?.bootstrappedAt);
  const isProvisioned = Boolean(
    asset.iot?.provisioning?.bootstrappedAt
      || asset.iot?.provisioning?.lastSyncAt
      || asset.iot?.lastSeenAt
      || asset.iot?.lastReading
      || asset.iot?.reportedState
  );
  const provisioningStatusText = isProvisioned
    ? bootstrappedAt
      ? `Provisionado correctamente desde ${bootstrappedAt}`
      : 'Provisionado correctamente'
    : 'Pendiente de provision';

  const handleProvision = async () => {
    if (!app || !organizationId) return;
    setLoadingProvision(true);
    try {
      const fn = httpsCallable(getFunctions(app), 'createIotProvisioningToken');
      const result = await fn({ organizationId, payload: { assetId: asset.id } });
      setProvisioning(result.data as ProvisioningResult);
      toast({
        title: 'Token generado',
        description: 'Copia la configuracion en el ESP y ejecuta el bootstrap una sola vez.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo provisionar',
        description: error.message || 'Error generando el bootstrap token.',
      });
    } finally {
      setLoadingProvision(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        Provision y control
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{asset.name}</DialogTitle>
            <DialogDescription>
              Provisiona el dispositivo con un token temporal para completar el alta desde el portal local del ESP.
            </DialogDescription>
          </DialogHeader>

          <section className="rounded-2xl border p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4" />
              Bootstrap seguro
            </div>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Genera un token temporal. Solo sirve una vez y se pega en el portal local del ESP.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label>deviceKey</Label>
                  <Input value={asset.iot?.deviceKey ?? ''} readOnly />
                </div>
                <div>
                  <Label>Estado actual</Label>
                  <Input value={provisioningStatusText} readOnly />
                </div>
              </div>
              <Button onClick={handleProvision} disabled={loadingProvision} className="w-full">
                <Bot className="mr-2 h-4 w-4" />
                {loadingProvision ? 'Generando token...' : 'Generar bootstrap token'}
              </Button>
              {provisioning ? (
                <>
                  <div>
                    <Label>Token expira</Label>
                    <Input value={new Date(provisioning.bootstrapExpiresAt).toLocaleString('es-ES')} readOnly />
                  </div>
                  <div>
                    <Label>Configuracion para el ESP</Label>
                    <Textarea value={deviceSnippet} readOnly rows={12} />
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
