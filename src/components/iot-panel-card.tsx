import type { CSSProperties, ReactNode } from 'react';
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

const digitalFontStyle: CSSProperties = {
  fontFamily: "'Digital-7', monospace",
  letterSpacing: '0.08em',
  textShadow: '0 0 8px rgba(255, 0, 0, 0.35)',
};

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

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'on', 'activo', 'online'].includes(normalized)) return true;
    if (['0', 'false', 'off', 'apagado', 'offline'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
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
    return reading.alarms
      .map((alarm) => String(alarm ?? '').trim())
      .filter(Boolean);
  }
  return [];
}

function readingMetric(reading: AssetIotReading | null | undefined, directKey: keyof AssetIotReading, rawKey: string) {
  return asNumber(reading?.[directKey]) ?? asNumber(reading?.raw?.[rawKey]);
}

function readingBoolean(reading: AssetIotReading | null | undefined, directKey: keyof AssetIotReading, rawKey: string) {
  return asBoolean(reading?.[directKey]) ?? asBoolean(reading?.raw?.[rawKey]);
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

function readingTimestamp(asset: Asset, reading: AssetIotReading | null | undefined) {
  return (
    reading?.readingAt ??
    asset.iot?.lastSeenAt ??
    asset.iot?.provisioning?.lastSyncAt ??
    reading?.raw?.reading_time ??
    null
  );
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

function formatLedValue(value: number | null, decimals = 1) {
  if (value == null) return '--';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(decimals);
}

function getRelayState(relays: AssetIotRelay[], label: string) {
  return relays.find((relay) => relay.label === label)?.active ?? false;
}

function thermostatMode(reading: AssetIotReading | null | undefined) {
  const directMode = typeof reading?.mode === 'string' ? reading.mode.toLowerCase() : '';
  if (directMode === 'heat' || directMode === 'heating') return 'HEAT';
  if (directMode === 'cool' || directMode === 'cooling') return 'COOL';

  const rawMode = String(reading?.raw?.MODEUP ?? '').trim();
  if (rawMode === '1') return 'HEAT';
  if (rawMode === '0') return 'COOL';
  return 'AUTO';
}

function LegacyThermostatPanel({
  asset,
  reading,
  status,
  temperature,
  humidity,
  setpoint,
  relays,
  alarms,
}: {
  asset: Asset;
  reading: AssetIotReading | null;
  status: string;
  temperature: number | null;
  humidity: number | null;
  setpoint: number | null;
  relays: AssetIotRelay[];
  alarms: string[];
}) {
  const powerOn = readingBoolean(reading, 'power', 'RUN') ?? status !== 'offline';
  const relay1On = getRelayState(relays, 'REL1');
  const relay2On = getRelayState(relays, 'REL2');
  const alarmOn = alarms.length > 0;
  const timestamp = formatReadingDate(readingTimestamp(asset, reading));
  const legacyMode = thermostatMode(reading);
  const primaryValue = powerOn ? formatLedValue(temperature, 1) : 'OFF';
  const humidityValue = humidity != null ? formatLedValue(humidity, 0) : '--';
  const secondaryTemperature = readingMetric(reading, 'secondaryTemperature', 'Temp2');

  return (
    <div className="space-y-4">
      <div
        className="relative mx-auto aspect-[557/300] w-full max-w-[557px] overflow-hidden rounded-[20px] bg-cover bg-center bg-no-repeat shadow-[0_18px_45px_rgba(0,0,0,0.45)]"
        style={{ backgroundImage: "url('/iot/lh1t/images/DISPLAY_FONDO_TEMP.png')" }}
      >
        <div className="absolute left-1/2 top-[5.0%] -translate-x-1/2 text-center text-[10px] font-bold text-black sm:text-[14px]">
          Ultimo Dato: {timestamp}
        </div>
        <div className="absolute left-1/2 top-[16.7%] -translate-x-1/2 text-center text-[14px] font-bold text-red-600 sm:text-[18px]">
          {asset.name}
        </div>

        <div className="absolute left-[8.1%] top-[81.7%] flex gap-1.5 text-[7px] sm:text-[9px]">
          {['MODE ' + legacyMode, 'PROBE 1', 'DATOS'].map((label) => (
            <div key={label} className="rounded border border-gray-500/80 bg-transparent px-2 py-1 text-white shadow-sm">
              {label}
            </div>
          ))}
        </div>

        <div className="absolute left-[83.8%] top-[34.0%] h-[11.7%] w-[6.3%] rounded-full bg-black/5 p-0.5">
          <img src="/iot/lh1t/images/graf.png" alt="Grafica" className="h-full w-full object-contain" />
        </div>
        <div className="absolute left-[84%] top-[60.0%] h-[11.7%] w-[6.3%] rounded-full bg-black/5 p-0.5">
          <img
            src={powerOn ? '/iot/lh1t/images/power_on.png' : '/iot/lh1t/images/power_off.png'}
            alt={powerOn ? 'Encendido' : 'Apagado'}
            className="h-full w-full object-contain"
          />
        </div>

        <div className="absolute left-[6.3%] top-[18.3%] h-[8.3%] w-[4.5%]" style={{ opacity: alarmOn ? 1 : 0 }}>
          <img src="/iot/lh1t/images/alarma.png" alt="Alarma" className="h-full w-full object-contain" />
        </div>

        <div
          className="absolute left-[16.8%] top-[30.5%] w-[30%] text-center text-[44px] text-red-600 sm:text-[65px]"
          style={digitalFontStyle}
        >
          {primaryValue}
        </div>
        {powerOn ? (
          <div className="absolute left-[48.5%] top-[38.5%] h-[8.3%] w-[4.5%]">
            <img src="/iot/lh1t/images/centigrados.png" alt="Grados" className="h-full w-full object-contain" />
          </div>
        ) : null}

        <div className="absolute left-[17.6%] top-[64.5%] text-[12px] text-red-600 sm:text-[14px]">Humidity =</div>
        <div className="absolute left-[36.5%] top-[61.5%] text-[18px] text-red-600 sm:text-[24px]" style={digitalFontStyle}>
          {humidityValue}
        </div>
        <div className="absolute left-[48.5%] top-[68.0%] h-[5.7%] w-[3.1%]">
          <img src="/iot/lh1t/images/porcent.png" alt="Porcentaje" className="h-full w-full object-contain" />
        </div>

        {relay1On ? (
          <div className="absolute left-[55.8%] top-[35%] h-[10.7%] w-[5.7%]">
            <img src="/iot/lh1t/images/RL_1_FRIO.png" alt="Compresor" className="h-full w-full object-contain" />
          </div>
        ) : null}
        {relay2On ? (
          <div className="absolute left-[56%] top-[50%] h-[11.7%] w-[6.3%]">
            <img src="/iot/lh1t/images/RL_2_FAN.png" alt="Ventilador" className="h-full w-full object-contain" />
          </div>
        ) : null}
        <div className="absolute left-[67.7%] top-[32.3%] h-[17.7%] w-[10.2%]">
          <img src={relay1On ? '/iot/lh1t/images/RELE_ON.png' : '/iot/lh1t/images/RELE_OFF.png'} alt="Relay 1" className="h-full w-full object-cover" />
        </div>
        <div className="absolute left-[67.7%] top-[59%] h-[17.7%] w-[10.2%]">
          <img src={relay2On ? '/iot/lh1t/images/RELE_ON.png' : '/iot/lh1t/images/RELE_OFF.png'} alt="Relay 2" className="h-full w-full object-cover" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricTile
          label="Consigna"
          value={setpoint != null ? formatLedValue(setpoint, 1) : '--'}
          suffix="C"
          icon={<Gauge className="h-3.5 w-3.5" />}
        />
        <MetricTile
          label="Humedad"
          value={humidity != null ? formatLedValue(humidity, 0) : '--'}
          suffix="%"
          icon={<Droplets className="h-3.5 w-3.5" />}
        />
        <MetricTile
          label="Sonda 2"
          value={secondaryTemperature != null ? formatLedValue(secondaryTemperature, 0) : '--'}
          suffix="C"
          icon={<Thermometer className="h-3.5 w-3.5" />}
        />
        <MetricTile
          label="Modo"
          value={legacyMode}
          icon={<Thermometer className="h-3.5 w-3.5" />}
        />
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

          <div className="rounded-3xl border border-white/10 p-4 backdrop-blur-sm" style={{ backgroundColor: '#333333' }}>
            {panelType === 'thermostat' ? (
              <LegacyThermostatPanel
                asset={asset}
                reading={reading}
                status={status}
                temperature={temperature}
                humidity={humidity}
                setpoint={setpoint}
                relays={relays}
                alarms={alarms}
              />
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
                {formatReadingDate(readingTimestamp(asset, reading))}
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
          ) : null}

          {panelType === 'thermostat' && secondaryTemperature != null ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
              Sonda 2 disponible: <span className="font-semibold text-white">{secondaryTemperature.toFixed(1)} C</span>
            </div>
          ) : null}
        </CardContent>
      </div>
    </Card>
  );
}

