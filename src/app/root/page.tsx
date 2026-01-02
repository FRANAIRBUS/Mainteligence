'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';

import { getClientFirebaseApp } from '@/lib/firebase/config';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useAuth } from '@/lib/firebase/provider';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type OrgRow = {
  id: string;
  name?: string;
  organizationId?: string;
  isActive?: boolean;
  createdAt?: any;
  updatedAt?: any;
  source?: string;
};

type OrgSummary = {
  ok: boolean;
  orgId: string;
  counts: {
    members: number;
    users: number;
    tickets: number;
    tasks: number;
    sites: number;
    assets: number;
    departments: number;
  };
  meta?: any;
};

type RootUserRow = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  active?: boolean;
  role?: string | null; // role en esa org (members/memberships)
  departmentId?: string | null;
  organizationId?: string | null; // del doc users/{uid}
};

const ROLE_OPTIONS = [
  { key: 'root', label: 'root (claim)', disabled: true },
  { key: 'super_admin', label: 'super_admin' },
  { key: 'admin', label: 'admin' },
  { key: 'maintenance', label: 'maintenance' },
  { key: 'operator', label: 'operator' },
] as const;

export default function RootPage() {
  const router = useRouter();
  const { user, loading, isRoot } = useUser();
  const auth = useAuth();

  const fn = useMemo(() => {
    try {
      const app = getClientFirebaseApp();
      return getFunctions(app, 'us-central1');
    } catch {
      return null;
    }
  }, []);

  const [error, setError] = useState<string | null>(null);

  // Orgs
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);

  // Selected org tools
  const [selectedOrgId, setSelectedOrgId] = useState<string>('default');
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [users, setUsers] = useState<RootUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Move / upsert
  const [email, setEmail] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('default');
  const [targetRole, setTargetRole] = useState<string>('admin');
  const [moving, setMoving] = useState(false);

  // Dangerous actions
  const [dangerConfirm, setDangerConfirm] = useState('');
  const [dangerBusy, setDangerBusy] = useState(false);

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

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } finally {
      router.replace('/login');
      router.refresh();
    }
  };

  const loadOrgs = async () => {
    if (!fn) return;
    setError(null);
    setOrgsLoading(true);
    try {
      const call = httpsCallable(fn, 'rootListOrganizations');
      const res = await call({ limit: 200 });
      const rows = (res.data as any)?.organizations as OrgRow[];
      const normalized = Array.isArray(rows) ? rows : [];
      setOrgs(normalized);

      // Ajusta selección si no existe
      if (normalized.length > 0) {
        const exists = normalized.some((o) => (o.id ?? o.organizationId) === selectedOrgId);
        if (!exists) setSelectedOrgId((normalized[0].id ?? normalized[0].organizationId) as string);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando organizaciones');
    } finally {
      setOrgsLoading(false);
    }
  };

  const loadSummary = async (orgId: string) => {
    if (!fn) return;
    setError(null);
    setSummaryLoading(true);
    try {
      const call = httpsCallable(fn, 'rootOrgSummary');
      const res = await call({ organizationId: orgId });
      setSummary((res.data as any) as OrgSummary);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando resumen');
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadUsersByOrg = async (orgId: string) => {
    if (!fn) return;
    setError(null);
    setUsersLoading(true);
    try {
      const call = httpsCallable(fn, 'rootListUsersByOrg');
      const res = await call({ organizationId: orgId, limit: 300 });
      const rows = (res.data as any)?.users as RootUserRow[];
      setUsers(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando usuarios');
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  const moveUser = async () => {
    if (!fn) return;
    setError(null);
    setMoving(true);
    try {
      const call = httpsCallable(fn, 'rootUpsertUserToOrganization');
      const res = await call({
        email: email.trim(),
        organizationId: targetOrgId.trim(),
        role: targetRole,
      });
      const ok = (res.data as any)?.ok;
      if (!ok) throw new Error('No se pudo aplicar el cambio');

      setEmail('');
      // refresca vistas
      await loadOrgs();
      await loadUsersByOrg(targetOrgId.trim());
      await loadSummary(targetOrgId.trim());
    } catch (e: any) {
      setError(e?.message ?? 'Error actualizando usuario');
    } finally {
      setMoving(false);
    }
  };

  const deactivateOrg = async () => {
    if (!fn) return;
    setError(null);
    setDangerBusy(true);
    try {
      const call = httpsCallable(fn, 'rootDeactivateOrganization');
      const res = await call({ organizationId: selectedOrgId, isActive: false });
      if (!(res.data as any)?.ok) throw new Error('No se pudo desactivar');
      await loadOrgs();
      await loadSummary(selectedOrgId);
    } catch (e: any) {
      setError(e?.message ?? 'Error desactivando organización');
    } finally {
      setDangerBusy(false);
    }
  };

  const scaffoldDeleteOrg = async () => {
    if (!fn) return;
    setError(null);
    setDangerBusy(true);
    try {
      const call = httpsCallable(fn, 'rootDeleteOrganizationScaffold');
      const res = await call({ organizationId: selectedOrgId });
      if (!(res.data as any)?.ok) throw new Error('No se pudo ejecutar scaffold');
      await loadOrgs();
      setSummary(null);
      setUsers([]);
    } catch (e: any) {
      setError(e?.message ?? 'Error en scaffold delete');
    } finally {
      setDangerBusy(false);
    }
  };

  const purgeCollection = async (collection: string) => {
    if (!fn) return;
    setError(null);
    setDangerBusy(true);
    try {
      const call = httpsCallable(fn, 'rootPurgeOrganizationCollection');
      const res = await call({
        organizationId: selectedOrgId,
        collection,
        batchSize: 300,
        maxBatches: 50,
      });
      if (!(res.data as any)?.ok) throw new Error('No se pudo purgar colección');
      await loadSummary(selectedOrgId);
      await loadUsersByOrg(selectedOrgId);
    } catch (e: any) {
      setError(e?.message ?? 'Error purgando colección');
    } finally {
      setDangerBusy(false);
    }
  };

  const dangerOk = dangerConfirm.trim() === selectedOrgId.trim();

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

          <div className="pt-2 flex gap-2 flex-wrap">
            <Button variant="outline" onClick={handleSignOut}>
              Cerrar sesión
            </Button>
            <Button onClick={loadOrgs} disabled={orgsLoading || !fn}>
              {orgsLoading ? 'Cargando…' : 'Cargar organizaciones'}
            </Button>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organizaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {orgs.length === 0 ? 'Sin datos (aún).' : `Mostrando ${orgs.length} organizaciones.`}
          </div>

          {orgs.length > 0 ? (
            <div className="grid gap-2">
              <Label>Selecciona organización</Label>
              <div className="flex gap-2 flex-wrap">
                {orgs.map((o) => {
                  const id = (o.id ?? o.organizationId ?? '') as string;
                  const active = o.isActive !== false;
                  return (
                    <Button
                      key={id}
                      variant={selectedOrgId === id ? 'default' : 'outline'}
                      onClick={() => setSelectedOrgId(id)}
                      type="button"
                    >
                      {id}
                      {!active ? ' (inactiva)' : ''}
                    </Button>
                  );
                })}
              </div>

              <div className="flex gap-2 flex-wrap pt-2">
                <Button
                  variant="secondary"
                  onClick={() => loadSummary(selectedOrgId)}
                  disabled={!selectedOrgId || summaryLoading || !fn}
                >
                  {summaryLoading ? 'Cargando…' : 'Ver resumen'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => loadUsersByOrg(selectedOrgId)}
                  disabled={!selectedOrgId || usersLoading || !fn}
                >
                  {usersLoading ? 'Cargando…' : 'Ver usuarios'}
                </Button>
              </div>
            </div>
          ) : null}

          {summary ? (
            <div className="border rounded-md p-3 text-sm space-y-1">
              <div className="font-medium">Resumen: {summary.orgId}</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground">
                <div>members: {summary.counts.members}</div>
                <div>users: {summary.counts.users}</div>
                <div>tickets: {summary.counts.tickets}</div>
                <div>tasks: {summary.counts.tasks}</div>
                <div>sites: {summary.counts.sites}</div>
                <div>assets: {summary.counts.assets}</div>
                <div>departments: {summary.counts.departments}</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios en organización</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Org seleccionada: <span className="font-medium text-foreground">{selectedOrgId}</span>
          </div>

          {users.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sin usuarios cargados.</div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.uid} className="border rounded-md px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-medium">{u.email ?? '(sin email)'}</div>
                    <div className="text-muted-foreground">uid: {u.uid}</div>
                  </div>
                  <div className="text-muted-foreground">
                    displayName: {u.displayName ?? '-'} · active: {String(u.active ?? true)} · role(org):{' '}
                    <span className="font-medium text-foreground">{u.role ?? '-'}</span>
                    {u.organizationId && u.organizationId !== selectedOrgId ? (
                      <span className="ml-2 text-red-600">
                        (user.organizationId = {u.organizationId} ≠ {selectedOrgId})
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
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
              {ROLE_OPTIONS.map((r) => (
                <Button
                  key={r.key}
                  variant={targetRole === r.key ? 'default' : 'outline'}
                  onClick={() => !r.disabled && setTargetRole(r.key)}
                  type="button"
                  disabled={r.disabled}
                  title={r.disabled ? 'Root es claim y no se asigna como rol de org' : ''}
                >
                  {r.label}
                </Button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Nota: root es un <b>custom claim</b> y no se asigna como role en org. Usa super_admin/admin/etc.
            </div>
          </div>
          <Button onClick={moveUser} disabled={!email.trim() || !targetOrgId.trim() || moving || !fn}>
            {moving ? 'Aplicando…' : 'Aplicar'}
          </Button>
          <div className="text-xs text-muted-foreground">
            Esto crea/actualiza: users/{'{uid}'} (organizationId), memberships (userId_orgId) y organizations/{'{orgId}'}
            /members/{'{uid}'}.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">Zona peligrosa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Para acciones destructivas, escribe exactamente el organizationId:
            <span className="font-medium text-foreground"> {selectedOrgId}</span>
          </div>
          <Input value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)} placeholder={selectedOrgId} />

          <div className="flex gap-2 flex-wrap">
            <Button variant="destructive" disabled={!dangerOk || dangerBusy || !fn} onClick={deactivateOrg}>
              {dangerBusy ? 'Procesando…' : 'Desactivar organización'}
            </Button>

            <Button
              variant="destructive"
              disabled={!dangerOk || dangerBusy || !fn}
              onClick={() => purgeCollection('tickets')}
            >
              Purgar tickets (solo org)
            </Button>

            <Button variant="destructive" disabled={!dangerOk || dangerBusy || !fn} onClick={() => purgeCollection('tasks')}>
              Purgar tasks (solo org)
            </Button>

            <Button
              variant="destructive"
              disabled={!dangerOk || dangerBusy || !fn}
              onClick={scaffoldDeleteOrg}
              title="Elimina el doc organizations/{orgId} y estructuras base (según tu implementación)."
            >
              Scaffold delete org
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Recomendación: usa “Desactivar” antes de borrar. “Purgar” elimina documentos asociados a esa org (según la
            función). “Scaffold delete” elimina estructura base.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
