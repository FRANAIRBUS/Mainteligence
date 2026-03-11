'use client';

import { useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Bot, KeyRound, Send, SlidersHorizontal } from 'lucide-react';

import type { Asset } from '@/lib/firebase/models';
import { useFirebaseApp, useUser } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const modeOptions = [
  { value: 'cool', label: 'Cool' },
  { value: 'heat', label: 'Heat' },
  { value: 'auto', label: 'Auto' },
  { value: 'fan', label: 'Fan' },
  { value: 'off', label: 'Off' },
];

const fanOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

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
  const [loadingDesiredState, setLoadingDesiredState] = useState(false);
  const [provisioning, setProvisioning] = useState<ProvisioningResult | null>(null);
  const [setpoint, setSetpoint] = useState(() => String(asset.iot?.desiredState?.setpoint ?? asset.iot?.lastReading?.setpoint ?? ''));
  const [mode, setMode] = useState(asset.iot?.desiredState?.mode ?? 'cool');
  const [fan, setFan] = useState(asset.iot?.desiredState?.fan ?? 'auto');
  const [power, setPower] = useState(asset.iot?.desiredState?.power ?? true);
  const [note, setNote] = useState('');

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

  const handleSendDesiredState = async () => {
    if (!app || !organizationId) return;
    setLoadingDesiredState(true);
    try {
      const payload: Record<string, unknown> = {
        assetId: asset.id,
        state: {
          power,
          mode,
          fan,
          note: note.trim() || undefined,
        },
      };

      const numericSetpoint = Number(String(setpoint).replace(',', '.'));
      if (String(setpoint).trim() !== '' && Number.isFinite(numericSetpoint)) {
        (payload.state as Record<string, unknown>).setpoint = numericSetpoint;
      }

      const fn = httpsCallable(getFunctions(app), 'setAssetIotDesiredState');
      await fn({ organizationId, payload });
      toast({
        title: 'Orden enviada',
        description: 'El dispositivo recibira el nuevo desiredState en su siguiente sincronizacion.',
      });
      setNote('');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo enviar la orden',
        description: error.message || 'Error actualizando desiredState.',
      });
    } finally {
      setLoadingDesiredState(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        Provision y control
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{asset.name}</DialogTitle>
            <DialogDescription>
              Provisiona el dispositivo con token temporal y define el `desiredState` que el ESP aplicara localmente.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 lg:grid-cols-2">
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
                    <Input value={bootstrappedAt ? `Activo desde ${bootstrappedAt}` : 'Pendiente'} readOnly />
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

            <section className="rounded-2xl border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Send className="h-4 w-4" />
                Desired state
              </div>
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`setpoint-${asset.id}`}>Setpoint</Label>
                    <Input id={`setpoint-${asset.id}`} value={setpoint} onChange={(e) => setSetpoint(e.target.value)} placeholder="Ej: 4.5" />
                  </div>
                  <div>
                    <Label htmlFor={`power-${asset.id}`}>Power</Label>
                    <select
                      id={`power-${asset.id}`}
                      value={power ? 'on' : 'off'}
                      onChange={(e) => setPower(e.target.value === 'on')}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="on">ON</option>
                      <option value="off">OFF</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`mode-${asset.id}`}>Mode</Label>
                    <select
                      id={`mode-${asset.id}`}
                      value={mode}
                      onChange={(e) => setMode(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {modeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`fan-${asset.id}`}>Fan</Label>
                    <select
                      id={`fan-${asset.id}`}
                      value={fan}
                      onChange={(e) => setFan(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {fanOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <Label htmlFor={`note-${asset.id}`}>Nota opcional</Label>
                  <Textarea id={`note-${asset.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Ej: bajar consigna por carga nocturna" />
                </div>
                <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                  El dispositivo no se controla directamente desde la nube. El ESP lee este estado deseado, aplica el cambio localmente por Modbus o GPIO y luego confirma el resultado en `reportedState`.
                </div>
                <Button onClick={handleSendDesiredState} disabled={loadingDesiredState} className="w-full">
                  {loadingDesiredState ? 'Enviando...' : 'Enviar orden al dispositivo'}
                </Button>
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


