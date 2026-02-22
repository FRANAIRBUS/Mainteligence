'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useFirebaseApp } from '@/lib/firebase/provider';

export default function BetaClosedPage() {
  const router = useRouter();
  const app = useFirebaseApp();

  const [betaClosed, setBetaClosed] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sector, setSector] = useState('');
  const [sitesCount, setSitesCount] = useState('');
  const [currentTools, setCurrentTools] = useState('');
  const [mainPain, setMainPain] = useState('');
  const [canUseReal2to4Weeks, setCanUseReal2to4Weeks] = useState(false);
  const [wantsDemo, setWantsDemo] = useState(false);

  const api = useMemo(() => {
    if (!app) return null;
    const fn = getFunctions(app, 'us-central1');
    return {
      getPublicAppConfig: httpsCallable(fn, 'getPublicAppConfig'),
      submitBetaRequest: httpsCallable(fn, 'submitBetaRequest'),
    };
  }, [app]);

  useEffect(() => {
    if (!api) return;
    api
      .getPublicAppConfig({})
      .then((res) => {
        const data = res?.data as any;
        setBetaClosed(Boolean(data?.betaClosed ?? false));
      })
      .catch(() => {
        // non-blocking
      });
  }, [api]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!api) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const res = await api.submitBetaRequest({
        fullName,
        companyName,
        role,
        email,
        phone,
        sector,
        sitesCount,
        currentTools,
        mainPain,
        canUseReal2to4Weeks,
        wantsDemo,
        // Honeypot field (must remain empty)
        companyWebsite: '',
      });
      const data = res?.data as any;
      if (data?.ignored) {
        setNotice('Solicitud enviada. Te contactaremos si encajas en la beta.');
        return;
      }
      setNotice('Solicitud enviada. Te contactaremos por correo.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar la solicitud.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell className="bg-muted/30">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl flex-col justify-center gap-6 px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Beta cerrada</CardTitle>
            <CardDescription>
              {betaClosed
                ? 'El registro público está deshabilitado. Envía tu solicitud para acceder.'
                : 'El registro está abierto. Puedes crear tu cuenta directamente.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-900">
                {notice}
              </div>
            )}

            {!betaClosed ? (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  No necesitas solicitud. Ve al login y crea tu cuenta.
                </div>
                <Button className="w-full" onClick={() => router.push('/login')}>
                  Ir a login
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Nombre y apellidos</Label>
                    <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Empresa</Label>
                    <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Cargo</Label>
                    <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="CTO, Mantenimiento, ..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Teléfono</Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Sector</Label>
                    <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Industria, alimentación, ..." />
                  </div>
                  <div className="space-y-2">
                    <Label>Nº de sedes</Label>
                    <Input
                      type="number"
                      value={sitesCount}
                      onChange={(e) => setSitesCount(e.target.value)}
                      placeholder="1"
                      min={0}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Herramientas actuales</Label>
                    <Input value={currentTools} onChange={(e) => setCurrentTools(e.target.value)} placeholder="Excel, ERP, ..." />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Dolor principal</Label>
                  <Textarea value={mainPain} onChange={(e) => setMainPain(e.target.value)} rows={3} />
                </div>

                <div className="flex flex-col gap-3">
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={canUseReal2to4Weeks} onCheckedChange={(v) => setCanUseReal2to4Weeks(Boolean(v))} />
                    <span>Puedo usar la app con datos reales 2–4 semanas.</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={wantsDemo} onCheckedChange={(v) => setWantsDemo(Boolean(v))} />
                    <span>Quiero una demo guiada.</span>
                  </label>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={loading}>
                    {loading ? 'Enviando…' : 'Enviar solicitud'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => router.push('/login')} disabled={loading}>
                    Volver
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
