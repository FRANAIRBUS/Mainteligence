import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Droplets,
  Gauge,
  MapPin,
  Power,
  Thermometer,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Asset, AssetIotReading, AssetIotRelay } from '@/lib/firebase/models';

type IotPanelCardProps = {
  asset: Asset;
  siteName?: string;
};

type DateLike =
  | { toDate?: () => Date; toMillis?: () => number }
  | Date
  | string
  | number
  | null
  | undefined;

function toDateValue(value: DateLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value.toDate === 'function') {
    const parsed = value.toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value.toMillis === 'function') {
    const parsed = new Date(value.toMillis());
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatReadingDate(value: DateLike) {
  const date = toDateValue(value);
  if (!date) return 'Sin lectura';
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.').trim());
    return Number.isFinite(normalized) ? normalized : null;
  }
  return null;
}

function relayLabel(index: number) {
  return `REL${index + 1}`;
}

function normalizeRelays(reading?: AssetIotReading | null): AssetIotRelay[] {
  if (Array.isArray(reading?.relays) && reading?.relays.length > 0) {
    return reading.relays.filter((relay): relay is AssetIotRelay => Boolean(relay?.label));
  }

  const raw = reading?.raw;
  if (!raw || typeof raw !== 'object') return [];

  return [0, 1, 2, 3]
    .map((index) => {
      const key = relayLabel(index);
      const rawValue = (raw as Record<string, unknown>)[key];
      if (rawValue == null || rawValue === '') return null;
      const normalized = String(rawValue).trim().toLowerCase();
      return {
        label: key,
        active: ['1', 'true', 'on', 'activo'].includes(normalized),
      };
    })
    .filter((relay): relay is AssetIotRelay => Boolean(relay));
}

function normalizeAlarms(reading?: AssetIotReading | null): string[] {
  if (Array.isArray(reading?.alarms) && reading.alarms.length > 0) {
    return reading.alarms.filter(Boolean);
  }

  const raw = reading?.raw;
  if (!raw || typeof raw !== 'object') return [];

  return Object.entries(raw as Record<string, unknown>)
    .filter(([key, value]) => key.startsWith('AL') && value != null && String(value).trim() !== '' && String(value) !== '0')
    .map(([key, value]) => `${key}: ${String(value)}`);
}

function readingMetric(reading: AssetIotReading | null | undefined, directKey: keyof AssetIotReading, rawKey: string) {
  return asNumber(reading?.[directKey]) ?? asNumber(reading?.raw?.[rawKey]);
}

function readingStatus(asset: Asset) {
  const status = asset.iot?.lastReading?.status ?? null;
  if (status) return status;

  const lastSeen = toDateValue(asset.iot?.lastSeenAt ?? asset.iot?.lastReading?.readingAt);
  if (!lastSeen) return 'offline';

  const ageMinutes = (Date.now() - lastSeen.getTime()) / 60000;
  if (ageMinutes <= 15) return 'online';
  if (ageMinutes <= 120) return 'warning';
  return 'offline';
}

function panelAccent(status: string) {
  if (status === 'online') return 'from-emerald-500/25 via-slate-950 to-slate-950';
  if (status === 'warning') return 'from-amber-500/25 via-slate-950 to-slate-950';
  return 'from-slate-700/40 via-slate-950 to-slate-950';
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'online') {
    return <Badge className="border-emerald-400/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15"><Wifi className="mr-1 h-3.5 w-3.5" />Online</Badge>;
  }
  if (status === 'warning') {
    return <Badge className="border-amber-400/30 bg-amber-500/15 text-amber-100 hover:bg-amber-500/15"><AlertTriangle className="mr-1 h-3.5 w-3.5" />Latente</Badge>;
  }
  return <Badge className="border-slate-500/40 bg-slate-500/10 text-slate-200 hover:bg-slate-500/10"><WifiOff className="mr-1 h-3.5 w-3.5" />Offline</Badge>;
}

function MetricTile({ label, value, suffix, icon }: { label: string; value: string; suffix?: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="text-2xl font-semibold text-white">{value}</span>
        {suffix ? <span className="pb-1 text-sm text-slate-400">{suffix}</span> : null}
      </div>
    </div>
  );
}

export function IotPanelCard({ asset, siteName }: IotPanelCardProps) {
  const reading = asset.iot?.lastReading ?? null;
  const panelType = asset.iot?.panelType ?? 'sensor';
  const status = readingStatus(asset);
  const temperature = readingMetric(reading, 'temperature', 'Temp1');
  const secondaryTemperature = readingMetric(reading, 'secondaryTemperature', 'Temp2');
  const humidity = readingMetric(reading, 'humidity', 'Hum1');
  const setpoint = readingMetric(reading, 'setpoint', 'Set1');
  const relays = normalizeRelays(reading);
  const alarms = normalizeAlarms(reading);

  return (
    <Card className="overflow-hidden border-white/10 bg-slate-950 text-white shadow-xl shadow-slate-950/30">
      <div className={`bg-gradient-to-br ${panelAccent(status)}`}>
        <CardHeader className="space-y-4 border-b border-white/10 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl text-white">
                <Cpu className="h-5 w-5 text-sky-300" />
                {asset.name}
              </CardTitle>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
                <Badge variant="outline" className="border-sky-300/20 bg-sky-400/10 text-sky-100">
                  {asset.iot?.deviceKey ?? asset.code}
                </Badge>
                {siteName ? (
                  <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
                    <MapPin className="mr-1 h-3.5 w-3.5" />
                    {siteName}
                  </Badge>
                ) : null}
                {asset.iot?.locationLabel ? (
                  <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
                    {asset.iot.locationLabel}
                  </Badge>
                ) : null}
              </div>
            </div>
            <StatusBadge status={status} />
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/25 p-4 backdrop-blur-sm">
            {panelType === 'thermostat' ? (
              <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-[28px] border border-cyan-400/20 bg-slate-900/80 p-5 shadow-[inset_0_0_40px_rgba(8,145,178,0.12)]">
                  <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">Termostato</div>
                  <div className="mt-3 flex items-end gap-2">
                    <span className="text-6xl font-semibold tracking-tight text-cyan-100">
                      {temperature != null ? temperature.toFixed(1) : '--'}
                    </span>
                    <span className="pb-2 text-lg text-cyan-100/70">C</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-sm text-slate-300">
                    <span>Set {setpoint != null ? `${setpoint.toFixed(1)} C` : '--'}</span>
                    <span>Hum {humidity != null ? `${humidity.toFixed(0)} %` : '--'}</span>
                  </div>
                </div>
                <div className="grid gap-3">
                  <MetricTile
                    label="Sonda 2"
                    value={secondaryTemperature != null ? secondaryTemperature.toFixed(1) : '--'}
                    suffix="C"
                    icon={<Thermometer className="h-3.5 w-3.5" />}
                  />
                  <MetricTile
                    label="Humedad"
                    value={humidity != null ? humidity.toFixed(0) : '--'}
                    suffix="%"
                    icon={<Droplets className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            ) : null}

            {panelType === 'sensor' ? (
              <div className="grid gap-3 md:grid-cols-3">
                <MetricTile
                  label="Temperatura"
                  value={temperature != null ? temperature.toFixed(1) : '--'}
                  suffix="C"
                  icon={<Thermometer className="h-3.5 w-3.5" />}
                />
                <MetricTile
                  label="Humedad"
                  value={humidity != null ? humidity.toFixed(0) : '--'}
                  suffix="%"
                  icon={<Droplets className="h-3.5 w-3.5" />}
                />
                <MetricTile
                  label="Consigna"
                  value={setpoint != null ? setpoint.toFixed(1) : '--'}
                  suffix="C"
                  icon={<Gauge className="h-3.5 w-3.5" />}
                />
              </div>
            ) : null}

            {panelType === 'relay' ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(relays.length > 0 ? relays : [{ label: 'REL1', active: false }]).map((relay) => (
                  <div key={relay.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>{relay.label}</span>
                      <Power className={`h-4 w-4 ${relay.active ? 'text-emerald-300' : 'text-slate-500'}`} />
                    </div>
                    <div className={`mt-4 rounded-xl px-3 py-2 text-sm font-semibold ${relay.active ? 'bg-emerald-500/20 text-emerald-100' : 'bg-slate-800 text-slate-300'}`}>
                      {relay.active ? 'Activo' : 'Apagado'}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {relays.length > 0 && panelType !== 'relay' ? (
            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Salidas</div>
              <div className="flex flex-wrap gap-2">
                {relays.map((relay) => (
                  <Badge
                    key={relay.label}
                    className={relay.active ? 'border-emerald-400/20 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/15' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/5'}
                  >
                    {relay.label}: {relay.active ? 'ON' : 'OFF'}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Ultima lectura</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-200">
                <Activity className="h-4 w-4 text-sky-300" />
                {formatReadingDate(asset.iot?.lastSeenAt ?? reading?.readingAt)}
              </div>
            </div>
            <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
              Panel {panelType}
            </Badge>
          </div>

          {alarms.length > 0 ? (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Alarmas activas
              </div>
              <div className="flex flex-wrap gap-2">
                {alarms.map((alarm) => (
                  <Badge key={alarm} className="border-amber-300/30 bg-amber-500/10 text-amber-50 hover:bg-amber-500/10">
                    {alarm}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
              Sin alarmas activas. El panel ya esta preparado para consumir lecturas en `asset.iot.lastReading`.
            </div>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

