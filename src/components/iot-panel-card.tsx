
'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Download,
  FileJson,
  Droplets,
  Gauge,
  MapPin,
  Power,
  Send,
  Settings,
  Thermometer,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp, useUser } from '@/lib/firebase';
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

type LegacyPanelSkinId = 'lh1t' | 'rele' | 'foto';

type LegacyPanelSkinOption = {
  id: LegacyPanelSkinId;
  label: string;
};

type LegacyPanelPhotoOption = {
  id: string;
  label: string;
  imageSrc: string;
};

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

const relay2ModeOptions = [
  { value: '0', label: 'Disabled' },
  { value: '1', label: 'Always On' },
  { value: '2', label: 'Follow Relay1' },
  { value: '3', label: 'Follow Setpoint2' },
];

const relay3ModeOptions = [
  { value: '0', label: 'Disabled' },
  { value: '1', label: 'Defrost' },
  { value: '2', label: 'Alarm' },
];

type ThermostatLogicFormState = {
  setpoint2: string;
  differentialX10: string;
  highAlarmX10: string;
  lowAlarmX10: string;
  tempAlarmDelayMin: string;
  controlPeriodMs: string;
  defrostIntervalMin: string;
  defrostDurationMin: string;
  defrostStopX10: string;
  stopRelay1OnDefrost: boolean;
  stopRelay2OnDefrost: boolean;
  relay2Mode: string;
  relay3Mode: string;
};

const digitalFontStyle: CSSProperties = {
  fontFamily: "'Digital-7', monospace",
  letterSpacing: '0.08em',
  textShadow: '0 0 8px rgba(255, 0, 0, 0.35)',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
  fontKerning: 'none',
  whiteSpace: 'nowrap',
};

const primaryDigitalValueStyle: CSSProperties = {
  ...digitalFontStyle,
  lineHeight: 1,
};

const secondaryDigitalValueStyle: CSSProperties = {
  ...digitalFontStyle,
  fontSize: 'clamp(18px, 2.7vw, 24px)',
  lineHeight: 1,
};

const legacyPanelSkins: LegacyPanelSkinOption[] = [
  { id: 'lh1t', label: 'LH1T' },
  { id: 'rele', label: 'RELE' },
  { id: 'foto', label: 'FOTO' },
];

const legacyPanelPhotoOptions: LegacyPanelPhotoOption[] = [
  { id: 'compresor', label: 'Compresor', imageSrc: '/iot/PANEL_FOTO/options/compresor.png' },
  { id: 'caldera', label: 'Caldera', imageSrc: '/iot/PANEL_FOTO/options/caldera.png' },
  { id: 'tanque-grande', label: 'Tanque grande', imageSrc: '/iot/PANEL_FOTO/options/tanque_grande.png' },
  { id: 'tanque-peq', label: 'Tanque pequeno', imageSrc: '/iot/PANEL_FOTO/options/tanque_peq.png' },
  { id: 'fancoil', label: 'Fancoil', imageSrc: '/iot/PANEL_FOTO/options/fancoil.png' },
  { id: 'ventana', label: 'Ventana', imageSrc: '/iot/PANEL_FOTO/options/ventana.png' },
  { id: 'aire-acond', label: 'Aire acondicionado', imageSrc: '/iot/PANEL_FOTO/options/aire_acond.png' },
];

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

function relayOrder(label: string) {
  const match = label.match(/^(?:REL)(\d+)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function resolveDisplayReading(asset: Asset): AssetIotReading | null {
  const lastReading = asset.iot?.lastReading ?? null;
  const reportedState = asset.iot?.reportedState ?? null;

  if (!lastReading && !reportedState) return null;
  if (!lastReading) return reportedState;
  if (!reportedState) return lastReading;

  return {
    ...reportedState,
    ...lastReading,
    alarms: lastReading ? (lastReading.alarms ?? null) : reportedState.alarms ?? null,
    raw: lastReading.raw ?? reportedState.raw ?? null,
    relays: lastReading.relays ?? reportedState.relays ?? null,
  };
}

function normalizeRelays(reading?: AssetIotReading | null): AssetIotRelay[] {
  if (Array.isArray(reading?.relays) && reading?.relays.length > 0) {
    return reading.relays
      .filter((relay): relay is AssetIotRelay => Boolean(relay?.label))
      .map((relay) => ({
        label: relay.label.trim().toUpperCase(),
        active: Boolean(relay.active),
      }))
      .sort((left, right) => relayOrder(left.label) - relayOrder(right.label) || left.label.localeCompare(right.label));
  }

  if (reading?.relays && !Array.isArray(reading.relays) && typeof reading.relays === 'object') {
    const relays = Object.entries(reading.relays as Record<string, unknown>)
      .map(([label, active]) => {
        const normalizedLabel = label.trim().toUpperCase();
        const normalizedActive = asBoolean(active);
        if (!normalizedLabel || normalizedActive == null) return null;
        return {
          label: normalizedLabel,
          active: normalizedActive,
        };
      })
      .filter((relay): relay is AssetIotRelay => Boolean(relay));
    if (relays.length > 0) {
      return relays.sort((left, right) => relayOrder(left.label) - relayOrder(right.label) || left.label.localeCompare(right.label));
    }
  }

  const raw = reading?.raw;
  if (!raw || typeof raw !== 'object') return [];

  const rawRelayEntries = Object.entries(raw as Record<string, unknown>)
    .filter(([key, value]) => /^REL\d+$/i.test(key) && value != null && value !== '')
    .map(([key, value]) => {
      const active = asBoolean(value);
      if (active == null) return null;
      return {
        label: key.trim().toUpperCase(),
        active,
      };
    })
    .filter((relay): relay is AssetIotRelay => Boolean(relay));

  if (rawRelayEntries.length > 0) {
    return rawRelayEntries.sort((left, right) => relayOrder(left.label) - relayOrder(right.label) || left.label.localeCompare(right.label));
  }

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
  if (reading?.raw && typeof reading.raw === 'object') {
    const rawAlarmEntries = Object.entries(reading.raw as Record<string, unknown>)
      .filter(([key]) => /^AL\d+$/i.test(key));

    if (rawAlarmEntries.length > 0) {
      const labelsFromRaw = rawAlarmEntries
        .map(([, value]) => {
          if (value == null) return null;
          const text = String(value).trim();
          if (!text) return null;

          const normalizedBoolean = asBoolean(value);
          const normalizedNumber = asNumber(value);

          if (normalizedBoolean === false || normalizedNumber === 0) {
            return null;
          }

          if (normalizedBoolean === true || normalizedNumber === 1) {
            return 'alarma';
          }

          return text;
        })
        .filter((label): label is string => Boolean(label));

      if (labelsFromRaw.length === 0) return [];

      if (Array.isArray(reading.alarms) && reading.alarms.length > 0) {
        const alarms = reading.alarms
          .map((alarm) => String(alarm ?? '').trim())
          .filter(Boolean);
        if (alarms.length > 0) return alarms;
      }

      return Array.from(new Set(labelsFromRaw));
    }
  }

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

function probeTemperature(reading: AssetIotReading | null | undefined, probeIndex: number) {
  if (probeIndex === 1) return readingMetric(reading, 'temperature', 'Temp1');
  if (probeIndex === 2) return readingMetric(reading, 'secondaryTemperature', 'Temp2');
  return asNumber(reading?.raw?.[`Temp${probeIndex}`]);
}

function probeHumidity(reading: AssetIotReading | null | undefined, probeIndex: number) {
  if (probeIndex === 1) return readingMetric(reading, 'humidity', 'Hum1');
  return asNumber(reading?.raw?.[`Hum${probeIndex}`]);
}

function probeSetpoint(reading: AssetIotReading | null | undefined, probeIndex: number) {
  if (probeIndex === 1) return readingMetric(reading, 'setpoint', 'Set1');
  return asNumber(reading?.raw?.[`Set${probeIndex}`]);
}

function latestDateValue(candidates: DateLike[]) {
  let latest: Date | null = null;

  for (const candidate of candidates) {
    const parsed = toDateValue(candidate);
    if (!parsed) continue;
    if (!latest || parsed.getTime() > latest.getTime()) {
      latest = parsed;
    }
  }

  return latest;
}

function lastIotActivityTimestamp(asset: Asset, reading: AssetIotReading | null | undefined) {
  return latestDateValue([
    reading?.readingAt,
    asset.iot?.lastReading?.readingAt,
    asset.iot?.reportedState?.readingAt,
    reading?.raw?.readingAt,
    reading?.raw?.reading_at,
    reading?.raw?.reading_time,
    asset.iot?.lastSeenAt,
    asset.iot?.provisioning?.lastSyncAt,
    asset.updatedAt,
  ]);
}

function readingStatus(asset: Asset) {
  const reading = resolveDisplayReading(asset);
  const lastActivity = toDateValue(lastIotActivityTimestamp(asset, reading));
  if (!lastActivity) return 'offline';

  const ageMinutes = (Date.now() - lastActivity.getTime()) / 60000;
  if (ageMinutes <= 15) return 'online';
  if (ageMinutes <= 120) return 'warning';
  return 'offline';
}

function readingTimestamp(asset: Asset, reading: AssetIotReading | null | undefined) {
  return (
    lastIotActivityTimestamp(asset, reading) ??
    asset.updatedAt ??
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
    return <Badge className="border-amber-400/30 bg-amber-500/15 text-amber-100 hover:bg-amber-500/15"><AlertTriangle className="mr-1 h-3.5 w-3.5" />Error</Badge>;
  }
  return <Badge className="border-slate-500/40 bg-slate-500/10 text-slate-200 hover:bg-slate-500/10"><WifiOff className="mr-1 h-3.5 w-3.5" />Offline</Badge>;
}

function relayDisplayItems(relays: AssetIotRelay[]) {
  return relays.length > 0
    ? relays
    : ['REL1', 'REL2', 'REL3', 'REL4'].map((label) => ({ label, active: false }));
}

function MetricTile({
  label,
  value,
  suffix,
  icon,
  centered = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 p-3 ${centered ? 'text-center' : ''}`}>
      <div className={`text-xs uppercase tracking-[0.18em] text-slate-400 ${centered ? 'flex items-center justify-center gap-2' : 'flex items-center gap-2'}`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 flex items-end gap-1 ${centered ? 'justify-center' : ''}`}>
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

function normalizeCapabilities(capabilities?: string[] | null) {
  return Array.from(new Set((capabilities ?? []).map((capability) => capability.trim().toLowerCase()).filter(Boolean)));
}

function normalizeRelayBoolean(active: unknown) {
  if (typeof active === 'boolean') return active;
  return ['1', 'true', 'on', 'activo', 'online'].includes(String(active ?? '').trim().toLowerCase());
}

function normalizeRelayEntriesFromAsset(asset: Asset) {
  const relayEntries = new Map<string, boolean>();

  const registerRelayEntries = (reading?: AssetIotReading | null) => {
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

  registerRelayEntries(asset.iot?.lastReading ?? null);
  if (relayEntries.size === 0) {
    registerRelayEntries(asset.iot?.reportedState ?? null);
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

  for (const [label, active] of normalizeRelayEntriesFromAsset(asset)) {
    relayState[label] = active;
  }

  return relayState;
}

function resolveRelayLabels(asset: Asset) {
  const labels = new Set<string>();

  for (const [label] of normalizeRelayEntriesFromAsset(asset)) {
    if (label.trim()) labels.add(label);
  }

  if (labels.size === 0 && asset.iot?.panelType === 'relay') {
    ['REL1', 'REL2', 'REL3', 'REL4'].forEach((label) => labels.add(label));
  }

  return Array.from(labels);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseOptionalNumber(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalX10Number(value: string) {
  const parsed = parseOptionalNumber(value);
  return parsed == null ? null : Math.round(parsed * 10);
}

function formatDisplayNumber(value: unknown) {
  const parsed = asNumber(value);
  if (parsed == null) return '';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1).replace(/\.0$/, '');
}

function formatDisplayX10(value: unknown) {
  const parsed = asNumber(value);
  if (parsed == null) return '';
  const scaled = parsed / 10;
  return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1).replace(/\.0$/, '');
}

function firstDefinedIotValue(values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return null;
}

function readIotFieldValue(asset: Asset, key: string, rawKeys: string[] = []) {
  const desired = isPlainObject(asset.iot?.desiredState) ? asset.iot?.desiredState as Record<string, unknown> : null;
  const reported = isPlainObject(asset.iot?.reportedState) ? asset.iot?.reportedState as Record<string, unknown> : null;
  const last = isPlainObject(asset.iot?.lastReading) ? asset.iot?.lastReading as Record<string, unknown> : null;

  const readingCandidates = [reported, last].flatMap((reading) => {
    if (!reading) return [];
    const raw = isPlainObject(reading.raw) ? reading.raw as Record<string, unknown> : null;
    return [
      reading[key],
      ...rawKeys.map((rawKey) => raw?.[rawKey]),
    ];
  });

  return firstDefinedIotValue([
    desired?.[key],
    ...readingCandidates,
  ]);
}

function buildThermostatLogicState(asset: Asset): ThermostatLogicFormState {
  const stopRelay1 = asBoolean(readIotFieldValue(asset, 'stopRelay1OnDefrost')) ?? false;
  const stopRelay2 = asBoolean(readIotFieldValue(asset, 'stopRelay2OnDefrost')) ?? false;
  const relay2ModeValue = readIotFieldValue(asset, 'relay2Mode');
  const relay3ModeValue = readIotFieldValue(asset, 'relay3Mode');

  return {
    setpoint2: formatDisplayNumber(readIotFieldValue(asset, 'setpoint2', ['Set2'])),
    differentialX10: formatDisplayX10(readIotFieldValue(asset, 'differentialX10')),
    highAlarmX10: formatDisplayX10(readIotFieldValue(asset, 'highAlarmX10')),
    lowAlarmX10: formatDisplayX10(readIotFieldValue(asset, 'lowAlarmX10')),
    tempAlarmDelayMin: formatDisplayNumber(readIotFieldValue(asset, 'tempAlarmDelayMin')),
    controlPeriodMs: formatDisplayNumber(readIotFieldValue(asset, 'controlPeriodMs')),
    defrostIntervalMin: formatDisplayNumber(readIotFieldValue(asset, 'defrostIntervalMin')),
    defrostDurationMin: formatDisplayNumber(readIotFieldValue(asset, 'defrostDurationMin')),
    defrostStopX10: formatDisplayX10(readIotFieldValue(asset, 'defrostStopX10')),
    stopRelay1OnDefrost: stopRelay1,
    stopRelay2OnDefrost: stopRelay2,
    relay2Mode: relay2ModeValue == null ? '2' : String(relay2ModeValue),
    relay3Mode: relay3ModeValue == null ? '1' : String(relay3ModeValue),
  };
}

function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isPlainObject(value)) {
    if (typeof value.toDate === 'function') {
      const dateValue = value.toDate();
      return dateValue instanceof Date ? dateValue.toISOString() : dateValue;
    }

    if (typeof value.toMillis === 'function') {
      return new Date(value.toMillis()).toISOString();
    }
  }

  return value;
}

function buildIotDebugPayload(asset: Asset, reading: AssetIotReading | null) {
  return {
    assetId: asset.id,
    assetName: asset.name,
    assetCode: asset.code,
    panelType: asset.iot?.panelType ?? null,
    status: readingStatus(asset),
    lastSeenAt: asset.iot?.lastSeenAt ?? null,
    displayReading: reading,
    iot: asset.iot ?? null,
  };
}

function stringifyIotDebugPayload(asset: Asset, reading: AssetIotReading | null) {
  return JSON.stringify(buildIotDebugPayload(asset, reading), jsonReplacer, 2);
}

function IotPayloadDialog({ asset, reading }: { asset: Asset; reading: AssetIotReading | null }) {
  const payload = stringifyIotDebugPayload(asset, reading);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-sky-300/20 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20 hover:text-white">
          <FileJson className="h-4 w-4" />
          Ver payload IoT
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl border-white/10 bg-slate-950 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <FileJson className="h-5 w-5 text-sky-300" />
            Payload IoT enviado por el equipo
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Vista de asset.iot, la lectura efectiva mostrada en pantalla y metadatos de provision.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] rounded-2xl border border-white/10 bg-black/30">
          <pre className="p-4 text-xs leading-6 text-slate-200">{payload}</pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function IotTelemetryDialog({ asset, trigger }: { asset: Asset; trigger: ReactNode }) {
  const app = useFirebaseApp();
  const { organizationId } = useUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [telemetryPreset, setTelemetryPreset] = useState<TelemetryPreset>('24h');
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [exportingTelemetry, setExportingTelemetry] = useState(false);
  const [telemetryRows, setTelemetryRows] = useState<TelemetryRow[]>([]);

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{asset.name}</DialogTitle>
          <DialogDescription>
            Historico de telemetria del dispositivo IoT para analisis rapido desde el panel.
          </DialogDescription>
        </DialogHeader>

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

          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function IotDesiredStateDialog({ asset, trigger }: { asset: Asset; trigger: ReactNode }) {
  const app = useFirebaseApp();
  const { organizationId } = useUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [lockedAsset, setLockedAsset] = useState<Asset | null>(null);
  const [loadingDesiredState, setLoadingDesiredState] = useState(false);
  const [setpoint, setSetpoint] = useState(() => String(asset.iot?.desiredState?.setpoint ?? asset.iot?.lastReading?.setpoint ?? ''));
  const [mode, setMode] = useState(asset.iot?.desiredState?.mode ?? 'cool');
  const [fan, setFan] = useState(asset.iot?.desiredState?.fan ?? 'auto');
  const [power, setPower] = useState(asset.iot?.desiredState?.power ?? true);
  const [thermostatLogic, setThermostatLogic] = useState<ThermostatLogicFormState>(() => buildThermostatLogicState(asset));
  const [note, setNote] = useState('');
  const sourceAsset = open && lockedAsset ? lockedAsset : asset;
  const panelType = sourceAsset.iot?.panelType ?? 'sensor';
  const relayLabels = useMemo(() => resolveRelayLabels(sourceAsset), [sourceAsset]);
  const [relayStates, setRelayStates] = useState<Record<string, boolean>>(() => resolveRelayStateMap(asset));
  const capabilitySet = useMemo(() => new Set(normalizeCapabilities(sourceAsset.iot?.capabilities)), [sourceAsset.iot?.capabilities]);
  const supportsSetpoint = panelType === 'thermostat' || capabilitySet.has('setpoint');
  const supportsPower = panelType === 'thermostat' || capabilitySet.has('power');
  const supportsMode = panelType === 'thermostat' || capabilitySet.has('mode');
  const supportsFan = capabilitySet.has('fan')
    || typeof sourceAsset.iot?.lastReading?.fan === 'string'
    || typeof sourceAsset.iot?.reportedState?.fan === 'string'
    || typeof sourceAsset.iot?.desiredState?.fan === 'string';
  const supportsRelays = panelType === 'relay' || capabilitySet.has('relays') || relayLabels.length > 0;
  const supportsThermostatLogic = panelType === 'thermostat';

  const hydrateDraftFromAsset = (draftAsset: Asset) => {
    setSetpoint(String(draftAsset.iot?.desiredState?.setpoint ?? draftAsset.iot?.lastReading?.setpoint ?? ''));
    setMode(draftAsset.iot?.desiredState?.mode ?? 'cool');
    setFan(draftAsset.iot?.desiredState?.fan ?? 'auto');
    setPower(draftAsset.iot?.desiredState?.power ?? true);
    setThermostatLogic(buildThermostatLogicState(draftAsset));
    setRelayStates(resolveRelayStateMap(draftAsset));
    setNote('');
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setLockedAsset(asset);
      hydrateDraftFromAsset(asset);
      return;
    }
    setLockedAsset(null);
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

      if (supportsThermostatLogic) {
        const setpoint2 = parseOptionalNumber(thermostatLogic.setpoint2);
        if (setpoint2 != null) state.setpoint2 = setpoint2;

        const differentialX10 = parseOptionalX10Number(thermostatLogic.differentialX10);
        if (differentialX10 != null) state.differentialX10 = differentialX10;

        const highAlarmX10 = parseOptionalX10Number(thermostatLogic.highAlarmX10);
        if (highAlarmX10 != null) state.highAlarmX10 = highAlarmX10;

        const lowAlarmX10 = parseOptionalX10Number(thermostatLogic.lowAlarmX10);
        if (lowAlarmX10 != null) state.lowAlarmX10 = lowAlarmX10;

        const tempAlarmDelayMin = parseOptionalNumber(thermostatLogic.tempAlarmDelayMin);
        if (tempAlarmDelayMin != null) state.tempAlarmDelayMin = Math.round(tempAlarmDelayMin);

        const controlPeriodMs = parseOptionalNumber(thermostatLogic.controlPeriodMs);
        if (controlPeriodMs != null) state.controlPeriodMs = Math.round(controlPeriodMs);

        const defrostIntervalMin = parseOptionalNumber(thermostatLogic.defrostIntervalMin);
        if (defrostIntervalMin != null) state.defrostIntervalMin = Math.round(defrostIntervalMin);

        const defrostDurationMin = parseOptionalNumber(thermostatLogic.defrostDurationMin);
        if (defrostDurationMin != null) state.defrostDurationMin = Math.round(defrostDurationMin);

        const defrostStopX10 = parseOptionalX10Number(thermostatLogic.defrostStopX10);
        if (defrostStopX10 != null) state.defrostStopX10 = defrostStopX10;

        const relay2Mode = parseOptionalNumber(thermostatLogic.relay2Mode);
        if (relay2Mode != null) state.relay2Mode = Math.round(relay2Mode);

        const relay3Mode = parseOptionalNumber(thermostatLogic.relay3Mode);
        if (relay3Mode != null) state.relay3Mode = Math.round(relay3Mode);

        state.stopRelay1OnDefrost = thermostatLogic.stopRelay1OnDefrost;
        state.stopRelay2OnDefrost = thermostatLogic.stopRelay2OnDefrost;
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
      setOpen(false);
      setLockedAsset(null);
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
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{asset.name}</DialogTitle>
          <DialogDescription>
            Ajusta el desiredState que el ESP aplicara localmente y confirmara despues en reportedState.
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-2xl border p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Send className="h-4 w-4" />
            Desired state
          </div>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              {supportsSetpoint ? (
                <div>
                  <Label htmlFor={`panel-setpoint-${asset.id}`}>Setpoint</Label>
                  <Input id={`panel-setpoint-${asset.id}`} value={setpoint} onChange={(e) => setSetpoint(e.target.value)} placeholder="Ej: 5" />
                </div>
              ) : null}
              {supportsThermostatLogic ? (
                <div>
                  <Label htmlFor={`panel-setpoint2-${asset.id}`}>Setpoint 2</Label>
                  <Input
                    id={`panel-setpoint2-${asset.id}`}
                    value={thermostatLogic.setpoint2}
                    onChange={(e) => setThermostatLogic((current) => ({ ...current, setpoint2: e.target.value }))}
                    placeholder="Ej: 6"
                  />
                </div>
              ) : null}
              {supportsPower ? (
                <div>
                  <Label htmlFor={`panel-power-${asset.id}`}>Power</Label>
                  <select
                    id={`panel-power-${asset.id}`}
                    value={power ? 'on' : 'off'}
                    onChange={(e) => setPower(e.target.value === 'on')}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="on">ON</option>
                    <option value="off">OFF</option>
                  </select>
                </div>
              ) : null}
            </div>

            {supportsMode || supportsFan ? (
              <div className="grid grid-cols-3 gap-3">
                {supportsMode ? (
                  <div>
                    <Label htmlFor={`panel-mode-${asset.id}`}>Mode</Label>
                    <select
                      id={`panel-mode-${asset.id}`}
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
                    <Label htmlFor={`panel-fan-${asset.id}`}>Fan</Label>
                    <select
                      id={`panel-fan-${asset.id}`}
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
            ) : null}

            {supportsThermostatLogic ? (
              <>
                <div className="rounded-xl border bg-muted/20 p-2 text-xs text-muted-foreground">
                  Campos `X10`: se muestran en grados (valor / 10) y se envian internamente como enteros x10.
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor={`panel-differentialX10-${asset.id}`}>Differential</Label>
                    <Input
                      id={`panel-differentialX10-${asset.id}`}
                      value={thermostatLogic.differentialX10}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, differentialX10: e.target.value }))}
                      placeholder="Ej: 1.0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-highAlarmX10-${asset.id}`}>High Alarm</Label>
                    <Input
                      id={`panel-highAlarmX10-${asset.id}`}
                      value={thermostatLogic.highAlarmX10}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, highAlarmX10: e.target.value }))}
                      placeholder="Ej: 90.0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-lowAlarmX10-${asset.id}`}>Low Alarm</Label>
                    <Input
                      id={`panel-lowAlarmX10-${asset.id}`}
                      value={thermostatLogic.lowAlarmX10}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, lowAlarmX10: e.target.value }))}
                      placeholder="Ej: 30.0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-tempAlarmDelayMin-${asset.id}`}>Alarm Delay (min)</Label>
                    <Input
                      id={`panel-tempAlarmDelayMin-${asset.id}`}
                      value={thermostatLogic.tempAlarmDelayMin}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, tempAlarmDelayMin: e.target.value }))}
                      placeholder="Ej: 0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-controlPeriodMs-${asset.id}`}>Control Period ms</Label>
                    <Input
                      id={`panel-controlPeriodMs-${asset.id}`}
                      value={thermostatLogic.controlPeriodMs}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, controlPeriodMs: e.target.value }))}
                      placeholder="Ej: 250"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-defrostIntervalMin-${asset.id}`}>Defrost Interval min</Label>
                    <Input
                      id={`panel-defrostIntervalMin-${asset.id}`}
                      value={thermostatLogic.defrostIntervalMin}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, defrostIntervalMin: e.target.value }))}
                      placeholder="Ej: 360"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-defrostDurationMin-${asset.id}`}>Defrost Duration min</Label>
                    <Input
                      id={`panel-defrostDurationMin-${asset.id}`}
                      value={thermostatLogic.defrostDurationMin}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, defrostDurationMin: e.target.value }))}
                      placeholder="Ej: 20"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-defrostStopX10-${asset.id}`}>Defrost Stop</Label>
                    <Input
                      id={`panel-defrostStopX10-${asset.id}`}
                      value={thermostatLogic.defrostStopX10}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, defrostStopX10: e.target.value }))}
                      placeholder="Ej: 8.0"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`panel-stopRelay1OnDefrost-${asset.id}`}>Stop Relay1 on Defrost</Label>
                    <select
                      id={`panel-stopRelay1OnDefrost-${asset.id}`}
                      value={thermostatLogic.stopRelay1OnDefrost ? 'on' : 'off'}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, stopRelay1OnDefrost: e.target.value === 'on' }))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="on">ON</option>
                      <option value="off">OFF</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`panel-stopRelay2OnDefrost-${asset.id}`}>Stop Relay2 on Defrost</Label>
                    <select
                      id={`panel-stopRelay2OnDefrost-${asset.id}`}
                      value={thermostatLogic.stopRelay2OnDefrost ? 'on' : 'off'}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, stopRelay2OnDefrost: e.target.value === 'on' }))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="on">ON</option>
                      <option value="off">OFF</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`panel-relay2Mode-${asset.id}`}>Relay2 Mode</Label>
                    <select
                      id={`panel-relay2Mode-${asset.id}`}
                      value={thermostatLogic.relay2Mode}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, relay2Mode: e.target.value }))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {relay2ModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`panel-relay3Mode-${asset.id}`}>Relay3 Mode</Label>
                    <select
                      id={`panel-relay3Mode-${asset.id}`}
                      value={thermostatLogic.relay3Mode}
                      onChange={(e) => setThermostatLogic((current) => ({ ...current, relay3Mode: e.target.value }))}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {relay3ModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : null}

            {supportsRelays ? (
              <div className="grid gap-2">
                <Label>Reles</Label>
                <div className="grid grid-cols-3 gap-3">
                  {relayLabels.map((label) => (
                    <div key={label}>
                      <Label htmlFor={`panel-relay-${asset.id}-${label}`}>{label}</Label>
                      <select
                        id={`panel-relay-${asset.id}-${label}`}
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
              <Label htmlFor={`panel-note-${asset.id}`}>Nota opcional</Label>
              <Textarea id={`panel-note-${asset.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Ej: bajar consigna por carga nocturna" />
            </div>

            <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
              El dispositivo no se controla directamente desde la nube. El ESP lee este estado deseado, aplica el cambio localmente por Modbus o GPIO y luego confirma el resultado en reportedState.
            </div>

            <Button onClick={handleSendDesiredState} disabled={loadingDesiredState} className="w-full">
              {loadingDesiredState ? 'Enviando...' : 'Enviar orden al dispositivo'}
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
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

function isLegacyPanelSkin(value: string | null | undefined): value is LegacyPanelSkinId {
  return legacyPanelSkins.some((skin) => skin.id === value);
}

function nextLegacyPanelSkin(current: LegacyPanelSkinId) {
  const currentIndex = legacyPanelSkins.findIndex((skin) => skin.id === current);
  if (currentIndex < 0) return legacyPanelSkins[0]?.id ?? 'lh1t';
  return legacyPanelSkins[(currentIndex + 1) % legacyPanelSkins.length]?.id ?? 'lh1t';
}

function relayPanelSlots(relays: AssetIotRelay[]) {
  const normalizedRelays = relayDisplayItems(relays);
  const relayByLabel = new Map(normalizedRelays.map((relay) => [relay.label, relay] as const));

  return [1, 2, 3].map((slotIndex) => {
    const expectedLabel = `REL${slotIndex}`;
    return relayByLabel.get(expectedLabel) ?? normalizedRelays[slotIndex - 1] ?? { label: expectedLabel, active: false };
  });
}

function LegacyThermostatPanel({
  asset,
  reading,
  status,
  relays,
  alarms,
}: {
  asset: Asset;
  reading: AssetIotReading | null;
  status: string;
  relays: AssetIotRelay[];
  alarms: string[];
}) {
  const [activeProbe, setActiveProbe] = useState<number>(1);
  const [activeSkin, setActiveSkin] = useState<LegacyPanelSkinId>('lh1t');
  const [selectedPhotoId, setSelectedPhotoId] = useState<string>(legacyPanelPhotoOptions[0]?.id ?? 'compresor');
  const [photoGalleryOpen, setPhotoGalleryOpen] = useState(false);
  const displayContainerRef = useRef<HTMLDivElement | null>(null);
  const [displayWidth, setDisplayWidth] = useState<number>(557);
  const skinStorageKey = `iot:legacy-skin:${asset.id}`;
  const photoStorageKey = `iot:legacy-photo:${asset.id}`;
  const powerOn = readingBoolean(reading, 'power', 'RUN') ?? status !== 'offline';
  const relay1On = getRelayState(relays, 'REL1');
  const relay2On = getRelayState(relays, 'REL2');
  const relay3On = getRelayState(relays, 'REL3');
  const alarmOn = alarms.length > 0;
  const timestamp = formatReadingDate(readingTimestamp(asset, reading));
  const legacyMode = thermostatMode(reading);
  const temperature = probeTemperature(reading, activeProbe);
  const humidity = probeHumidity(reading, activeProbe);
  const setpoint = probeSetpoint(reading, activeProbe) ?? probeSetpoint(reading, 1);
  const primaryValue = powerOn ? formatLedValue(temperature, 1) : 'OFF';
  const panelFotoPrimaryValue = powerOn ? formatLedValue(temperature, 1) : 'OFF';
  const humidityValue = humidity != null ? formatLedValue(humidity, 0) : '--';
  const relayDisplayStates = relayDisplayItems(relays);
  const relaySlots = useMemo(() => relayPanelSlots(relays), [relays]);
  const selectedPhoto = useMemo<LegacyPanelPhotoOption>(
    () =>
      legacyPanelPhotoOptions.find((option) => option.id === selectedPhotoId) ??
      legacyPanelPhotoOptions[0] ?? {
        id: 'default',
        label: 'Imagen',
        imageSrc: '/iot/PANEL_FOTO/options/compresor.png',
      },
    [selectedPhotoId],
  );
  const activeSkinLabel = useMemo(
    () => legacyPanelSkins.find((skin) => skin.id === activeSkin)?.label ?? 'LH1T',
    [activeSkin],
  );
  const telemetryIconSrc = useMemo(() => {
    if (activeSkin === 'rele') return '/iot/PANEL_RELE/graf.png';
    if (activeSkin === 'foto') return '/iot/PANEL_FOTO/graf.png';
    return '/iot/lh1t/images/graf.png';
  }, [activeSkin]);
  const powerIconSrc = useMemo(() => {
    if (activeSkin === 'rele') return powerOn ? '/iot/PANEL_RELE/power_on.png' : '/iot/PANEL_RELE/power_off.png';
    if (activeSkin === 'foto') return powerOn ? '/iot/PANEL_FOTO/power_on.png' : '/iot/PANEL_FOTO/power_off.png';
    return powerOn ? '/iot/lh1t/images/power_on.png' : '/iot/lh1t/images/power_off.png';
  }, [activeSkin, powerOn]);
  const displayBackgroundImage = useMemo(() => {
    if (activeSkin === 'rele') return '/iot/PANEL_RELE/DISPLAY_FONDO_RELE_1OFF.png';
    if (activeSkin === 'foto') return '/iot/PANEL_FOTO/DISPLAY_FOTO.png';
    return '/iot/lh1t/images/DISPLAY_FONDO_TEMP.png';
  }, [activeSkin]);
  const primaryDisplayFontSize = useMemo(() => {
    const scaled = displayWidth * 0.118;
    return `${Math.min(65, Math.max(34, scaled)).toFixed(1)}px`;
  }, [displayWidth]);
  const panelFotoPrimaryDisplayFontSize = useMemo(() => {
    const scaled = displayWidth * 0.104;
    return `${Math.min(62, Math.max(30, scaled)).toFixed(1)}px`;
  }, [displayWidth]);
  const primaryDisplayStyle = useMemo<CSSProperties>(
    () => ({
      ...primaryDigitalValueStyle,
      fontSize: primaryDisplayFontSize,
    }),
    [primaryDisplayFontSize],
  );
  const panelFotoPrimaryDisplayStyle = useMemo<CSSProperties>(
    () => ({
      ...primaryDigitalValueStyle,
      fontSize: panelFotoPrimaryDisplayFontSize,
    }),
    [panelFotoPrimaryDisplayFontSize],
  );

  useEffect(() => {
    const node = displayContainerRef.current;
    if (!node) return;

    const syncWidth = (nextWidth: number) => {
      if (nextWidth > 0) {
        setDisplayWidth((previousWidth) => (Math.abs(previousWidth - nextWidth) > 0.5 ? nextWidth : previousWidth));
      }
    };

    syncWidth(node.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? node.getBoundingClientRect().width;
      syncWidth(width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedSkin = window.localStorage.getItem(skinStorageKey);
    const savedPhoto = window.localStorage.getItem(photoStorageKey);

    setActiveSkin(isLegacyPanelSkin(savedSkin) ? savedSkin : 'lh1t');
    setSelectedPhotoId(
      legacyPanelPhotoOptions.some((option) => option.id === savedPhoto)
        ? String(savedPhoto)
        : (legacyPanelPhotoOptions[0]?.id ?? 'compresor'),
    );
  }, [photoStorageKey, skinStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(skinStorageKey, activeSkin);
  }, [activeSkin, skinStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(photoStorageKey, selectedPhotoId);
  }, [photoStorageKey, selectedPhotoId]);

  const cycleSkin = () => {
    setActiveSkin((currentSkin) => nextLegacyPanelSkin(currentSkin));
  };

  return (
    <div className="space-y-4">
      <div
        ref={displayContainerRef}
        className="relative mx-auto aspect-[557/300] w-full max-w-[557px] overflow-hidden rounded-[20px] bg-cover bg-center bg-no-repeat shadow-[0_18px_45px_rgba(0,0,0,0.45)] [container-type:inline-size]"
        style={{ backgroundImage: `url('${displayBackgroundImage}')` }}
      >
        {activeSkin === 'lh1t' ? (
          <>
            <div className="absolute left-1/2 top-[4.0%] -translate-x-1/2 text-center text-[10px] font-bold text-black sm:text-[14px]">
              Dato: {timestamp}
            </div>
            <div className="absolute left-1/2 top-[16.7%] -translate-x-1/2 whitespace-nowrap text-center text-[14px] font-bold text-red-600 sm:text-[18px]">
              {asset.name}
            </div>

            <div className="absolute left-[8.1%] top-[81.7%] flex gap-1.5 text-[7px] sm:text-[9px]">
              <div className="rounded border border-gray-500/80 bg-transparent px-2 py-1 text-white shadow-sm">
                MODE {legacyMode}
              </div>
              <button
                type="button"
                onClick={() => setActiveProbe((currentProbe) => (currentProbe % 4) + 1)}
                className="rounded border border-gray-500/80 bg-transparent px-2 py-1 text-white shadow-sm transition hover:border-sky-300/80 hover:text-sky-100"
              >
                PROBE {activeProbe}
              </button>
              <button
                type="button"
                onClick={cycleSkin}
                className="rounded border border-red-500/80 bg-transparent px-2 py-1 text-white shadow-sm transition hover:border-red-300 hover:text-red-100"
                title={`Cambiar skin (actual: ${activeSkinLabel})`}
              >
                SKIN
              </button>
            </div>

            <IotTelemetryDialog
              asset={asset}
              trigger={(
                <button
                  type="button"
                  className="absolute left-[83.8%] top-[34.0%] h-[11.7%] w-[6.3%] rounded-full bg-black/5 p-0.5 transition hover:bg-black/15"
                  aria-label="Abrir historico de telemetria"
                >
                  <img src={telemetryIconSrc} alt="Grafica" className="h-full w-full object-contain" />
                </button>
              )}
            />
            <div className="absolute left-[84%] top-[62.5%] h-[11.7%] w-[6.3%] rounded-full bg-black/5 p-0.5">
              <img src={powerIconSrc} alt={powerOn ? 'Encendido' : 'Apagado'} className="h-full w-full object-contain" />
            </div>

            <div className="absolute left-[6.3%] top-[18.3%] h-[8.3%] w-[4.5%]" style={{ opacity: alarmOn ? 1 : 0 }}>
              <img src="/iot/lh1t/images/alarma.png" alt="Alarma" className="h-full w-full object-contain" />
            </div>

            <div
              className="absolute top-[38.5%] right-[65.8%] w-[22%] min-w-[5ch] pr-[0.08em] text-right text-red-600 sm:right-[55.8%] sm:w-[20%] lg:right-[55.6%] lg:w-[21%]"
              style={primaryDisplayStyle}
            >
              {primaryValue}
            </div>
            {powerOn ? (
              <div className="absolute left-[45.5%] top-[50%] h-[8.3%] w-[4.5%]">
                <img src="/iot/lh1t/images/centigrados.png" alt="Grados" className="h-full w-full object-contain" />
              </div>
            ) : null}

            <div className="absolute left-[17.6%] top-[64.5%] text-[12px] text-red-600 sm:text-[14px]">Humidity =</div>
            <div className="absolute right-[50.5%] top-[64.9%] w-[7.5%] pr-[0.6%] text-right text-red-600" style={secondaryDigitalValueStyle}>
              {humidityValue}
            </div>
            <div className="absolute left-[49.0%] top-[68.0%] h-[6.5%] w-[4.2%]">
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
            {relay3On ? (
              <div className="absolute left-[56%] top-[62.2%] h-[10.7%] w-[5.7%]">
                <img src="/iot/lh1t/images/defross.png" alt="Defross" className="h-full w-full object-contain" />
              </div>
            ) : null}
            <IotDesiredStateDialog
              asset={asset}
              trigger={(
                <button
                  type="button"
                  className="absolute left-[68.8%] top-[34.3%] h-[15.5%] w-[8.5%] transition hover:opacity-90"
                  aria-label="Abrir desired state"
                >
                  <img src="/iot/lh1t/images/set.png" alt="Set" className="h-full w-full object-cover" />
                </button>
              )}
            />
            <div className="absolute left-[67.7%] top-[59%] h-[17.7%] w-[10.2%] overflow-hidden rounded-[12px] border border-white/10 bg-[#171717]">
              <div className="flex h-full w-full items-center justify-center">
                <Settings className="h-[58%] w-[58%] text-slate-200" strokeWidth={2.2} />
              </div>
            </div>
          </>
        ) : null}

        {activeSkin === 'rele' ? (
          <>
            <div className="absolute left-1/2 top-[4.0%] -translate-x-1/2 text-center text-[10px] font-bold text-black sm:text-[14px]">
              Dato: {timestamp}
            </div>
            <div className="absolute left-1/2 top-[16.7%] -translate-x-1/2 whitespace-nowrap text-center text-[14px] font-bold text-red-600 sm:text-[18px]">
              {asset.name}
            </div>

            <div className="absolute left-[7.9%] top-[31.8%] h-[9.3%] w-[17.1%] rounded-[8px] border border-white/45 bg-white/10 text-center text-[11px] font-semibold uppercase text-slate-200">
              R-1
            </div>
            <div className="absolute left-[34.1%] top-[31.8%] h-[9.3%] w-[17.1%] rounded-[8px] border border-white/45 bg-white/10 text-center text-[11px] font-semibold uppercase text-slate-200">
              R-2
            </div>
            <div className="absolute left-[60.3%] top-[31.8%] h-[9.3%] w-[17.1%] rounded-[8px] border border-white/45 bg-white/10 text-center text-[11px] font-semibold uppercase text-slate-200">
              R-3
            </div>

            {relaySlots.map((relay, index) => (
              <div
                key={`${relay.label}-${index}`}
                className={`absolute top-[49.3%] h-[25.3%] w-[15.4%] ${index === 0 ? 'left-[8.6%]' : index === 1 ? 'left-[34.8%]' : 'left-[61.0%]'}`}
              >
                <img
                  src={relay.active ? '/iot/PANEL_RELE/RELE_ON.png' : '/iot/PANEL_RELE/RELE_OFF.png'}
                  alt={`${relay.label} ${relay.active ? 'encendido' : 'apagado'}`}
                  className="h-full w-full object-contain"
                />
              </div>
            ))}

            <IotTelemetryDialog
              asset={asset}
              trigger={(
                <button
                  type="button"
                  className="absolute left-[81.5%] top-[31.7%] h-[18.3%] w-[10.4%] rounded-[14px] bg-black/10 p-2 transition hover:bg-black/20"
                  aria-label="Abrir historico de telemetria"
                >
                  <img src={telemetryIconSrc} alt="Grafica" className="h-full w-full object-contain" />
                </button>
              )}
            />
            <div className="absolute left-[81.5%] top-[58.7%] h-[18.3%] w-[10.4%] rounded-[14px] bg-black/10 p-2">
              <img src={powerIconSrc} alt={powerOn ? 'Encendido' : 'Apagado'} className="h-full w-full object-contain" />
            </div>

            <div className="absolute left-[8.1%] top-[81.7%] flex gap-1.5 text-[7px] sm:text-[9px]">
              <div className="rounded border border-gray-500/80 bg-transparent px-2 py-1 text-white shadow-sm">
                MODE {legacyMode}
              </div>
              <button
                type="button"
                onClick={() => setActiveProbe((currentProbe) => (currentProbe % 4) + 1)}
                className="rounded border border-gray-500/80 bg-transparent px-2 py-1 text-white shadow-sm transition hover:border-sky-300/80 hover:text-sky-100"
              >
                PROBE {activeProbe}
              </button>
              <button
                type="button"
                onClick={cycleSkin}
                className="rounded border border-red-500/80 bg-transparent px-2 py-1 text-white shadow-sm transition hover:border-red-300 hover:text-red-100"
                title={`Cambiar skin (actual: ${activeSkinLabel})`}
              >
                SKIN
              </button>
            </div>
          </>
        ) : null}

        {activeSkin === 'foto' ? (
          <>
            <div className="absolute left-1/2 top-[4.0%] -translate-x-1/2 text-center text-[10px] font-bold text-black sm:text-[14px]">
              Dato: {timestamp}
            </div>
            <div className="absolute left-1/2 top-[16.7%] -translate-x-1/2 whitespace-nowrap text-center text-[14px] font-bold text-red-600 sm:text-[18px]">
              {asset.name}
            </div>

            <div className="absolute top-[45.8%] right-[58.8%] w-[22%] min-w-[5ch] pr-[0.08em] text-right text-red-600 sm:right-[60.8%] sm:w-[20%] lg:right-[62.6%] lg:w-[21%]" style={panelFotoPrimaryDisplayStyle}>
              {panelFotoPrimaryValue}
            </div>
            {powerOn ? (
              <div className="absolute left-[37.5%] top-[50.0%] h-[8.3%] w-[4.5%]">
                <img src="/iot/lh1t/images/centigrados.png" alt="Grados" className="h-full w-full object-contain" />
              </div>
            ) : null}

            <div className="absolute left-[49.6%] top-[32.7%] h-[44.3%] w-[28.0%] overflow-hidden rounded-[12px] border border-white/20 bg-black/60 p-1.5">
              <img
                src={selectedPhoto.imageSrc}
                alt={`Imagen seleccionada: ${selectedPhoto.label}`}
                className="h-full w-full object-contain"
              />
              <button
                type="button"
                onClick={() => setPhotoGalleryOpen(true)}
                className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md border border-white/20 bg-black/55 text-slate-100 transition hover:border-sky-300/80 hover:text-sky-100"
                aria-label="Abrir galeria de imagenes"
                title="Seleccionar imagen del panel foto"
              >
                <Settings className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>

            <IotTelemetryDialog
              asset={asset}
              trigger={(
                <button
                  type="button"
                  className="absolute left-[81.5%] top-[31.7%] h-[18.3%] w-[10.4%] rounded-[14px] bg-black/10 p-2 transition hover:bg-black/20"
                  aria-label="Abrir historico de telemetria"
                >
                  <img src={telemetryIconSrc} alt="Grafica" className="h-full w-full object-contain" />
                </button>
              )}
            />
            <div className="absolute left-[81.5%] top-[58.7%] h-[18.3%] w-[10.4%] rounded-[14px] bg-black/10 p-2">
              <img src={powerIconSrc} alt={powerOn ? 'Encendido' : 'Apagado'} className="h-full w-full object-contain" />
            </div>
            <div className="absolute left-[8.1%] top-[81.7%] flex gap-1.5 text-[7px] sm:text-[9px]">
              <div className="rounded border border-gray-500/80 bg-transparent px-2 py-1 text-white shadow-sm">
                MODE {legacyMode}
              </div>
              <button
                type="button"
                onClick={() => setActiveProbe((currentProbe) => (currentProbe % 4) + 1)}
                className="rounded border border-gray-500/80 bg-transparent px-2 py-1 text-white shadow-sm transition hover:border-sky-300/80 hover:text-sky-100"
              >
                PROBE {activeProbe}
              </button>
              <button
                type="button"
                onClick={cycleSkin}
                className="rounded border border-red-500/80 bg-transparent px-2 py-1 text-white shadow-sm transition hover:border-red-300 hover:text-red-100"
                title={`Cambiar skin (actual: ${activeSkinLabel})`}
              >
                SKIN
              </button>
            </div>
          </>
        ) : null}
      </div>

      <Dialog open={photoGalleryOpen} onOpenChange={setPhotoGalleryOpen}>
        <DialogContent className="max-w-4xl border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Galeria de imagenes del panel foto</DialogTitle>
            <DialogDescription className="text-slate-300">
              Selecciona una imagen para mantener en el recuadro del panel.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[62vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
            {legacyPanelPhotoOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setSelectedPhotoId(option.id);
                  setPhotoGalleryOpen(false);
                }}
                className={`overflow-hidden rounded-xl border text-left transition ${
                  selectedPhotoId === option.id
                    ? 'border-sky-300 bg-sky-400/10'
                    : 'border-white/10 bg-white/5 hover:border-sky-300/60'
                }`}
                aria-label={`Seleccionar imagen ${option.label}`}
              >
                <div className="aspect-[4/3] w-full bg-black/40 p-1.5">
                  <img src={option.imageSrc} alt={option.label} className="h-full w-full object-contain" />
                </div>
                <div className="border-t border-white/10 px-2 py-1.5 text-xs font-medium text-slate-100">
                  {option.label}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-2 gap-2">
        <MetricTile
          label={`Sonda ${activeProbe}`}
          value={temperature != null ? formatLedValue(temperature, 0) : '--'}
          suffix="C"
          icon={<Thermometer className="h-3.5 w-3.5" />}
          centered
        />
        <MetricTile
          label="Consigna"
          value={setpoint != null ? formatLedValue(setpoint, 1) : '--'}
          suffix="C"
          icon={<Gauge className="h-3.5 w-3.5" />}
          centered
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-2 text-xs text-slate-300">
        <div className="mb-1 text-center text-[10px] uppercase tracking-[0.22em] text-slate-400">Salidas</div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {relayDisplayStates.map((relay) => (
            <div
              key={relay.label}
              className={
                relay.active
                  ? 'rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100'
                  : 'rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold text-slate-300'
              }
            >
              {relay.label}: {relay.active ? 'ON' : 'OFF'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IotPanelCard({ asset, siteName }: IotPanelCardProps) {
  const reading = resolveDisplayReading(asset);
  const panelType = asset.iot?.panelType ?? 'sensor';
  const status = readingStatus(asset);
  const temperature = readingMetric(reading, 'temperature', 'Temp1');
  const humidity = readingMetric(reading, 'humidity', 'Hum1');
  const setpoint = readingMetric(reading, 'setpoint', 'Set1');
  const relays = normalizeRelays(reading);
  const alarms = normalizeAlarms(reading);
  const canInspectPayload = Boolean(asset.iot?.deviceKey || asset.iot?.provisioning);

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
                {asset.iot?.locationLabel && asset.iot.locationLabel.trim().toLowerCase() !== asset.name.trim().toLowerCase() ? (
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
                relays={relays}
                alarms={alarms}
              />
            ) : null}

            {panelType === 'sensor' ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {(relays.length > 0
                  ? relays
                  : ['REL1', 'REL2', 'REL3', 'REL4'].map((label) => ({ label, active: false }))
                ).map((relay) => (
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
          {relays.length > 0 && panelType !== 'relay' && panelType !== 'thermostat' ? (
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
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Ultimo registro</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-200">
                <Activity className="h-4 w-4 text-sky-300" />
                {formatReadingDate(readingTimestamp(asset, reading))}
              </div>
            </div>
            <div className="flex items-center gap-2 justify-self-start md:justify-self-end">
              <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">
                Panel {panelType}
              </Badge>
              {canInspectPayload ? <IotPayloadDialog asset={asset} reading={reading} /> : null}
            </div>
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

        </CardContent>
      </div>
    </Card>
  );
}
