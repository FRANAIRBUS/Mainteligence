'use client';

import { useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Bot, Download, KeyRound, Send, SlidersHorizontal } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

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

type TelemetryPreset = '24h' | '7d' | '30d';

type TelemetryRow = {
  id: string;
  readingAt: string | null;
  createdAt: string | null;
  temperature: number | null;
  humidity: number | null;
};

type TelemetryResult = {
  rows: TelemetryRow[];
  count: number;
};

type CsvResult = {
  filename: string;
  csv: string;
};

function normalizeCapabilities(capabilities?: string[] | null) {
  return Array.from(new Set((capabilities ?? []).map((capability) => capability.trim().toLowerCase()).filter(Boolean)));
}

function normalizeRelayBoolean(active: unknown) {
  if (typeof active === 'boolean') return active;
  return ['1', 'true', 'on', 'activo', 'online'].includes(String(active ?? '').trim().toLowerCase());
}

function normalizeRelayEntries(asset: Asset) {
  const relayEntries = new Map<string, boolean>();

  const registerRelayEntries = (reading?: Asset['iot'] extends infer T ? any : never) => {
    if (!reading) return;

    if (Array.isArray(reading.relays)) {
      for (const relay of reading.relays) {
        if (!relay?.label) continue;
        relayEntries.set(relay.label.trim().toUpperCase(), Boolean(relay.active));
      }
      return;
    }

    if (reading.relays && typeof reading.relays === 'object') {
      for (const [label, active] of Object.entries(reading.relays as Record<string, unknown>)) {
        const normalizedLabel = label.trim().toUpperCase();
        if (!normalizedLabel) continue;
        relayEntries.set(normalizedLabel, normalizeRelayBoolean(active));
      }
      return;
    }

    if (reading.raw && typeof reading.raw === 'object') {
      for (const [label, active] of Object.entries(reading.raw as Record<string, unknown>)) {
        if (!/^REL\d+$/i.test(label)) continue;
        relayEntries.set(label.trim().toUpperCase(), normalizeRelayBoolean(active));
      }
    }
  };

  registerRelayEntries(asset.iot?.lastReading);
  if (relayEntries.size === 0) {
    registerRelayEntries(asset.iot?.reportedState);
  }

  if (asset.iot?.desiredState?.relays) {
    for (const [label, active] of Object.entries(asset.iot.desiredState.relays)) {
      relayEntries.set(label.trim().toUpperCase(), Boolean(active));
    }
  }

  return Array.from(relayEntries.entries()).sort((left, right) => left[0].localeCompare(right[0]));
}

function resolveRelayStateMap(asset: Asset) {
  const relayState: Record<string, boolean> = {};

  for (const [label, active] of normalizeRelayEntries(asset)) {
    relayState[label] = active;
  }

  return relayState;
}

function resolveRelayLabels(asset: Asset) {
  const labels = new Set<string>();

  for (const [label] of normalizeRelayEntries(asset)) {
    if (label.trim()) labels.add(label);
  }

  if (labels.size === 0 && asset.iot?.panelType === 'relay') {
    ['REL1', 'REL2', 'REL3', 'REL4'].forEach((label) => labels.add(label));
  }

  return Array.from(labels);
}

function telemetryRange(preset: TelemetryPreset) {
  const now = new Date();
  const from = new Date(now);
  if (preset === '24h') from.setHours(from.getHours() - 24);
  if (preset === '7d') from.setDate(from.getDate() - 7);
  if (preset === '30d') from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: now.toISOString() };
}

function saveCsvLocally(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

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
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [exportingTelemetry, setExportingTelemetry] = useState(false);
  const [provisioning, setProvisioning] = useState<ProvisioningResult | null>(null);
  const [telemetryPreset, setTelemetryPreset] = useState<TelemetryPreset>('24h');
  const [telemetryRows, setTelemetryRows] = useState<TelemetryRow[]>([]);
  const [setpoint, setSetpoint] = useState(() => String(asset.iot?.desiredState?.setpoint ?? asset.iot?.lastReading?.setpoint ?? ''));
  const [mode, setMode] = useState(asset.iot?.desiredState?.mode ?? 'cool');
  const [fan, setFan] = useState(asset.iot?.desiredState?.fan ?? 'auto');
  const [power, setPower] = useState(asset.iot?.desiredState?.power ?? true);
  const [note, setNote] = useState('');
  const panelType = asset.iot?.panelType ?? 'sensor';
  const relayLabels = useMemo(() => resolveRelayLabels(asset), [asset]);
  const [relayStates, setRelayStates] = useState<Record<string, boolean>>(() => resolveRelayStateMap(asset));
  const capabilitySet = useMemo(() => new Set(normalizeCapabilities(asset.iot?.capabilities)), [asset.iot?.capabilities]);
  const supportsSetpoint = panelType === 'thermostat' || capabilitySet.has('setpoint');
  const supportsPower = panelType === 'thermostat' || capabilitySet.has('power');
  const supportsMode = panelType === 'thermostat' || capabilitySet.has('mode');
  const supportsFan = capabilitySet.has('fan')
    || typeof asset.iot?.lastReading?.fan === 'string'
    || typeof asset.iot?.reportedState?.fan === 'string'
    || typeof asset.iot?.desiredState?.fan === 'string';
  const supportsRelays = panelType === 'relay' || capabilitySet.has('relays') || relayLabels.length > 0;

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

  const chartData = useMemo(
    () =>
      telemetryRows
        .map((row) => {
          const sourceDate = row.readingAt ?? row.createdAt;
          const parsed = sourceDate ? new Date(sourceDate) : null;
          return {
            ts: parsed,
            label: parsed ? parsed.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--',
            temperature: typeof row.temperature === 'number' ? row.temperature : null,
            humidity: typeof row.humidity === 'number' ? row.humidity : null,
          };
        })
        .filter((point) => point.ts !== null),
    [telemetryRows],
  );

  const averageTemp = useMemo(() => {
    const values = telemetryRows
      .map((row) => row.temperature)
      .filter((value): value is number => typeof value === 'number');
    if (values.length === 0) return null;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return (sum / values.length).toFixed(1);
  }, [telemetryRows]);

  const handleLoadTelemetry = async (preset: TelemetryPreset) => {
    if (!app || !organizationId) return;
    setLoadingTelemetry(true);
    try {
      const range = telemetryRange(preset);
      const fn = httpsCallable(getFunctions(app), 'getAssetIotTelemetry');
      const result = await fn({
        organizationId,
        payload: {
          assetId: asset.id,
          from: range.from,
          to: range.to,
          limit: 1000,
        },
      });
      const data = result.data as TelemetryResult;
      setTelemetryRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo cargar el historico',
        description: error.message || 'Error consultando telemetria.',
      });
    } finally {
      setLoadingTelemetry(false);
    }
  };

  const handleExportCsv = async () => {
    if (!app || !organizationId) return;
    setExportingTelemetry(true);
    try {
      const range = telemetryRange(telemetryPreset);
      const fn = httpsCallable(getFunctions(app), 'exportAssetIotTelemetryCsv');
      const result = await fn({
        organizationId,
        payload: {
          assetId: asset.id,
          from: range.from,
          to: range.to,
          limit: 5000,
        },
      });
      const data = result.data as CsvResult;
      saveCsvLocally(data.filename || `telemetry_${asset.id}.csv`, data.csv || '');
      toast({
        title: 'CSV descargado',
        description: 'Se descargo el historico seleccionado.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo exportar CSV',
        description: error.message || 'Error exportando telemetria.',
      });
    } finally {
      setExportingTelemetry(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void handleLoadTelemetry(telemetryPreset);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSetpoint(String(asset.iot?.desiredState?.setpoint ?? asset.iot?.lastReading?.setpoint ?? ''));
    setMode(asset.iot?.desiredState?.mode ?? 'cool');
    setFan(asset.iot?.desiredState?.fan ?? 'auto');
    setPower(asset.iot?.desiredState?.power ?? true);
    setRelayStates(resolveRelayStateMap(asset));
  }, [
    open,
    asset,
  ]);

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
      const state: Record<string, unknown> = {
        note: note.trim() || undefined,
      };

      if (supportsPower) state.power = power;
      if (supportsMode) state.mode = mode;
      if (supportsFan) state.fan = fan;

      const payload: Record<string, unknown> = {
        assetId: asset.id,
        state,
      };

      const numericSetpoint = Number(String(setpoint).replace(',', '.'));
      if (supportsSetpoint && String(setpoint).trim() !== '' && Number.isFinite(numericSetpoint)) {
        state.setpoint = numericSetpoint;
      }

      if (supportsRelays && relayLabels.length > 0) {
        state.relays = relayLabels.reduce<Record<string, boolean>>((acc, label) => {
          acc[label] = Boolean(relayStates[label]);
          return acc;
        }, {});
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
                  {supportsSetpoint ? (
                    <div>
                      <Label htmlFor={`setpoint-${asset.id}`}>Setpoint</Label>
                      <Input id={`setpoint-${asset.id}`} value={setpoint} onChange={(e) => setSetpoint(e.target.value)} placeholder="Ej: 4.5" />
                    </div>
                  ) : null}
                  {supportsPower ? (
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
                  ) : null}
                  {supportsMode ? (
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
                  ) : null}
                  {supportsFan ? (
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
                  ) : null}
                </div>
                {supportsRelays ? (
                  <div className="grid gap-2">
                    <Label>Relés</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {relayLabels.map((label) => (
                        <div key={label}>
                          <Label htmlFor={`relay-${asset.id}-${label}`}>{label}</Label>
                          <select
                            id={`relay-${asset.id}-${label}`}
                            value={relayStates[label] ? 'on' : 'off'}
                            onChange={(e) => {
                              const isActive = e.target.value === 'on';
                              setRelayStates((current) => ({ ...current, [label]: isActive }));
                            }}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="on">ON</option>
                            <option value="off">OFF</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
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

          <section className="rounded-2xl border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Historico de telemetria</div>
              <div className="flex flex-wrap items-center gap-2">
                {(['24h', '7d', '30d'] as TelemetryPreset[]).map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant={telemetryPreset === preset ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setTelemetryPreset(preset);
                      void handleLoadTelemetry(preset);
                    }}
                    disabled={loadingTelemetry}
                  >
                    {preset}
                  </Button>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={handleExportCsv} disabled={exportingTelemetry}>
                  <Download className="mr-2 h-4 w-4" />
                  {exportingTelemetry ? 'Exportando...' : 'Descargar CSV'}
                </Button>
              </div>
            </div>

            <div className="mb-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-2">Lecturas: {telemetryRows.length}</div>
              <div className="rounded-lg border bg-muted/20 p-2">Promedio temp: {averageTemp ? `${averageTemp} C` : '--'}</div>
              <div className="rounded-lg border bg-muted/20 p-2">Rango: {telemetryPreset}</div>
            </div>

            <div className="h-56 w-full rounded-xl border bg-background p-2">
              {loadingTelemetry ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando historico...</div>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" minTickGap={24} />
                    <YAxis yAxisId="temp" width={36} />
                    <YAxis yAxisId="hum" orientation="right" width={36} />
                    <Tooltip />
                    <Line yAxisId="temp" type="monotone" dataKey="temperature" stroke="#0ea5e9" dot={false} strokeWidth={2} name="Temp" />
                    <Line yAxisId="hum" type="monotone" dataKey="humidity" stroke="#14b8a6" dot={false} strokeWidth={2} name="Humedad" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No hay historico para este rango. Verifica que el dispositivo envie storeTelemetry=true.
                </div>
              )}
            </div>
          </section>

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
