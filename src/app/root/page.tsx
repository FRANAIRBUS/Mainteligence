'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { getClientFirebaseApp } from '@/lib/firebase/config';
import { useUser } from '@/lib/firebase/auth/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type OrgRow = { id: string; name?: string; createdAt?: any; isActive?: boolean };

export default function RootPage() {
  const router = useRouter();
  const { user, loading, isRoot } = useUser();

  const fn = useMemo(() => {
    try {
      const app = getClientFirebaseApp();
      return getFunctions(app, 'us-central1');
    } catch {
      return null;
    }
  }, []);

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('default');
  const [targetRole, setTargetRole] = useState<'admin' | 'operario' | 'mantenimiento'>('admin');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isRoot) {
      router.replace('/');
    }
  }, [loading, user, isRoot, router]);

  const loadOrgs = async () => {
    if (!fn) return;
    setError(null);
    setOrgsLoading(true);
    try {
      const call = httpsCallable(fn, 'rootListOrganizations');
      const res = await call({ limit: 50 });
      const rows = (res.data as any)?.organizations as OrgRow[];
      setOrgs(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando organizaciones');
    } finally {
      setOrgsLoading(false);
    }
  };

  const moveUser = async () => {
    if (!fn) return;
    setError(null);
    setMoving(true);
    try {
      const call = httpsCallable(fn, 'rootUpsertUserToOrganization');
      const res = await call({ email: email.trim(), organizationId: targetOrgId.trim(), role: targetRole });
      const ok = (res.data as any)?.ok;
      if (!ok) throw new Error('No se pudo aplicar el cambio');
      setEmail('');
      await loadOrgs();
    } catch (e: any) {
      setError(e?.message ?? 'Error actualizando usuario');
    } finally {
      setMoving(false);
    }
  };

  if (loading || !user || !isRoot) {
    return (
      <div className="p-6">
        <div className="text-sm text-muted-foreground">Cargando…</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Root Console</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Sesión: <span className="font-medium text-foreground">{user.email}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Root es un modo oculto (custom claim) que no pertenece a ninguna organización.
          </div>
          {error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organizaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={loadOrgs} disabled={orgsLoading || !fn}>
            {orgsLoading ? 'Cargando…' : 'Cargar organizaciones'}
          </Button>
          <div className="text-sm text-muted-foreground">
            {orgs.length === 0 ? 'Sin datos (aún).' : `Mostrando ${orgs.length} organizaciones.`}
          </div>
          {orgs.length > 0 ? (
            <div className="space-y-1">
              {orgs.map((o) => (
                <div key={o.id} className="text-sm flex items-center justify-between border rounded-md px-3 py-2">
                  <div className="font-medium">{o.id}</div>
                  <div className="text-muted-foreground">{o.name ?? ''}</div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reubicar usuario a organización</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Email del usuario</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" />
          </div>
          <div className="grid gap-2">
            <Label>organizationId destino</Label>
            <Input value={targetOrgId} onChange={(e) => setTargetOrgId(e.target.value)} placeholder="default" />
          </div>
          <div className="grid gap-2">
            <Label>Rol (en esa organización)</Label>
            <div className="flex gap-2 flex-wrap">
              {(['admin', 'operario', 'mantenimiento'] as const).map((r) => (
                <Button
                  key={r}
                  variant={targetRole === r ? 'default' : 'outline'}
                  onClick={() => setTargetRole(r)}
                  type="button"
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
          <Button onClick={moveUser} disabled={!email.trim() || !targetOrgId.trim() || moving || !fn}>
            {moving ? 'Aplicando…' : 'Aplicar'}
          </Button>
          <div className="text-xs text-muted-foreground">
            Esto crea/actualiza: users/{'{uid}'} (organizationId), memberships (userId_orgId) y organizations/{'{orgId}'}/members/{'{uid}'}.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
