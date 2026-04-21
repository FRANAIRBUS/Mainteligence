'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Bot, KeyRound, SlidersHorizontal } from 'lucide-react';

import type { Asset } from '@/lib/firebase/models';
import { useFirebaseApp, useUser } from '@/lib/firebase';
import { toQrDataUrl } from '@/lib/vendor/qrcode';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const SHORT_BOOTSTRAP_URL = 'https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap';
const SHORT_SYNC_URL = 'https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync';

type ProvisioningResult = {
  organizationId: string;
  assetId: string;
  deviceKey: string;
  bootstrapToken: string;
  bootstrapExpiresAt: string;
  bootstrapUrl: string;
  syncUrl: string;
  bootstrapUrlPreferred?: string;
  syncUrlPreferred?: string;
  bootstrapUrlReal?: string;
  syncUrlReal?: string;
  pollIntervalMs: number;
};

type ProvisioningSnippet = {
  organizationId: string;
  assetId: string;
  deviceKey: string;
  bootstrapToken: string;
  bootstrapUrl: string;
  syncUrl: string;
  bootstrapUrlReal: string;
  syncUrlReal: string;
  pollIntervalMs: number;
};

type ProvisioningCompactSnippet = {
  organizationId: string;
  assetId: string;
  deviceKey: string;
  bootstrapToken: string;
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

function normalizeUrl(input: unknown, fallback: string) {
  const value = String(input ?? '').trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function encodePart(value: string | number) {
  return encodeURIComponent(String(value ?? '').trim());
}

function stripProtocol(url: string) {
  return String(url ?? '').trim().replace(/^https?:\/\//i, '');
}

export function IotDeviceAdminDialog({
  asset,
  trigger,
  buttonLabel = 'Provision y control',
}: {
  asset: Asset;
  trigger?: ReactNode;
  buttonLabel?: string;
}) {
  const app = useFirebaseApp();
  const { toast } = useToast();
  const { organizationId } = useUser();
  const [open, setOpen] = useState(false);
  const [loadingProvision, setLoadingProvision] = useState(false);
  const [provisioning, setProvisioning] = useState<ProvisioningResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const provisioningSnippet = useMemo<ProvisioningSnippet | null>(() => {
    if (!provisioning) return null;
    const bootstrapUrl = normalizeUrl(
      provisioning.bootstrapUrlPreferred ?? provisioning.bootstrapUrl,
      SHORT_BOOTSTRAP_URL
    );
    const syncUrl = normalizeUrl(
      provisioning.syncUrlPreferred ?? provisioning.syncUrl,
      SHORT_SYNC_URL
    );
    return {
      organizationId: provisioning.organizationId,
      assetId: provisioning.assetId,
      deviceKey: provisioning.deviceKey,
      bootstrapToken: provisioning.bootstrapToken,
      bootstrapUrl,
      syncUrl,
      bootstrapUrlReal: normalizeUrl(provisioning.bootstrapUrlReal, provisioning.bootstrapUrl || SHORT_BOOTSTRAP_URL),
      syncUrlReal: normalizeUrl(provisioning.syncUrlReal, provisioning.syncUrl || SHORT_SYNC_URL),
      pollIntervalMs: provisioning.pollIntervalMs,
    };
  }, [provisioning]);

  const deviceSnippet = useMemo(() => {
    if (!provisioningSnippet) return '';
    return JSON.stringify(provisioningSnippet, null, 2);
  }, [provisioningSnippet]);

  const provisioningCompactSnippet = useMemo<ProvisioningCompactSnippet | null>(() => {
    if (!provisioningSnippet) return null;
    return {
      organizationId: provisioningSnippet.organizationId,
      assetId: provisioningSnippet.assetId,
      deviceKey: provisioningSnippet.deviceKey,
      bootstrapToken: provisioningSnippet.bootstrapToken,
      bootstrapUrl: provisioningSnippet.bootstrapUrl,
      syncUrl: provisioningSnippet.syncUrl,
      pollIntervalMs: provisioningSnippet.pollIntervalMs,
    };
  }, [provisioningSnippet]);

  const concatenatedCode = useMemo(() => {
    if (!provisioningCompactSnippet) return '';
    const parts = [
      `organizationId=${encodePart(provisioningCompactSnippet.organizationId)}`,
      `assetId=${encodePart(provisioningCompactSnippet.assetId)}`,
      `deviceKey=${encodePart(provisioningCompactSnippet.deviceKey)}`,
      `bootstrapToken=${encodePart(provisioningCompactSnippet.bootstrapToken)}`,
      `bootstrapUrl=${encodePart(stripProtocol(provisioningCompactSnippet.bootstrapUrl))}`,
      `syncUrl=${encodePart(stripProtocol(provisioningCompactSnippet.syncUrl))}`,
      `pollIntervalMs=${encodePart(provisioningCompactSnippet.pollIntervalMs)}`,
    ];
    return parts.join('|');
  }, [provisioningCompactSnippet]);

  const bootstrapExpiresLabel = useMemo(() => {
    if (!provisioning?.bootstrapExpiresAt) return '';
    return new Date(provisioning.bootstrapExpiresAt).toLocaleString('es-ES');
  }, [provisioning?.bootstrapExpiresAt]);

  useEffect(() => {
    let cancelled = false;

    const generateQr = async () => {
      if (!concatenatedCode) {
        setQrDataUrl('');
        return;
      }
      try {
        const nextQrDataUrl = await toQrDataUrl(concatenatedCode, {
          errorCorrectionLevel: 'L',
          margin: 4,
          width: 360,
        });
        if (!cancelled) setQrDataUrl(nextQrDataUrl);
      } catch {
        if (!cancelled) setQrDataUrl('');
      }
    };

    void generateQr();
    return () => {
      cancelled = true;
    };
  }, [concatenatedCode]);

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

  const handleCopy = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: `${label} copiado`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: `No se pudo copiar ${label.toLowerCase()}`,
      });
    }
  };

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
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full">
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            {buttonLabel}
          </Button>
        </DialogTrigger>
      )}
      
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
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label>assetId</Label>
                <Input value={asset.id} readOnly />
              </div>
              <div>
                <Label>deviceKey (estable)</Label>
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
            {provisioningSnippet ? (
              <>
                <div>
                  <Label>Token expira</Label>
                  <Input value={bootstrapExpiresLabel} readOnly />
                </div>
                <div>
                  <Label>QR de provision</Label>
                  <div className="mt-2 flex justify-center rounded-xl border p-3">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="QR provisioning code"
                        className="h-[360px] w-[360px] max-w-full rounded-md"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">No se pudo generar el QR en este navegador.</p>
                    )}
                  </div>
                </div>
                <div>
                  <Label>Codigo completo</Label>
                  <Textarea value={concatenatedCode} readOnly rows={6} />
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => void handleCopy(concatenatedCode, 'Codigo concatenado')}
                  >
                    Copiar codigo completo
                  </Button>
                </div>
                <div>
                  <Label>Campos separados</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label>organizationId</Label>
                      <Input value={provisioningSnippet.organizationId} readOnly />
                    </div>
                    <div>
                      <Label>assetId</Label>
                      <Input value={provisioningSnippet.assetId} readOnly />
                    </div>
                    <div>
                      <Label>deviceKey</Label>
                      <Input value={provisioningSnippet.deviceKey} readOnly />
                    </div>
                    <div>
                      <Label>bootstrapToken</Label>
                      <Input value={provisioningSnippet.bootstrapToken} readOnly />
                    </div>
                    <div>
                      <Label>bootstrapUrl (corta)</Label>
                      <Input value={provisioningSnippet.bootstrapUrl} readOnly />
                    </div>
                    <div>
                      <Label>syncUrl (corta)</Label>
                      <Input value={provisioningSnippet.syncUrl} readOnly />
                    </div>
                    <div>
                      <Label>bootstrapUrl real</Label>
                      <Input value={provisioningSnippet.bootstrapUrlReal} readOnly />
                    </div>
                    <div>
                      <Label>syncUrl real</Label>
                      <Input value={provisioningSnippet.syncUrlReal} readOnly />
                    </div>
                  </div>
                </div>
                <div>
                  <Label>JSON de compatibilidad</Label>
                  <Textarea value={deviceSnippet} readOnly rows={12} />
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => void handleCopy(deviceSnippet, 'JSON')}
                  >
                    Copiar JSON
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
