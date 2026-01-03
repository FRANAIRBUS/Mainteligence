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

type OrgRow = { id: string; name?: string | null; createdAt?: any; isActive?: boolean };
type UserRow = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  role?: string | null;
  active?: boolean;
  departmentId?: string | null;
};

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

  // --- Orgs table state
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [qOrg, setQOrg] = useState('');
  const [includeDefault, setIncludeDefault] = useState(true); // IMPORTANTE: default debe aparecer
  const [includeInactive, setIncludeInactive] = useState(true);
  const [orgCursor, setOrgCursor] = useState<string | null>(null);
  const [orgNextCursor, setOrgNextCursor] = useState<string | null>(null);

  const [selectedOrg, setSelectedOrg] = useState<string>('');

  // --- Summary
  const [summary, setSummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // --- Users table
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [qUser, setQUser] = useState('');
  const [userCursor, setUserCursor] = useState<{ cursorEmail: string; cursorUid: string } | null>(null);
  const [userNextCursor, setUserNextCursor] = useState<{ cursorEmail: string; cursorUid: string } | null>(null);

  // --- Move user
  const [moveEmail, setMoveEmail] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('default');
  const [targetRole, setTargetRole] = useState<'root' | 'super_admin' | 'admin' | 'maintenance' | 'operator'>('admin');
  const [moving, setMoving] = useState(false);

  // --- Danger zone
  const [confirmOrgId, setConfirmOrgId] = useState('');
  const [dangerBusy, setDangerBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isRoot) router.replace('/');
  }, [loading, user, isRoot, router]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } finally {
      router.replace('/login');
      router.refresh();
    }
  };

  const loadOrgs = async (opts?: { reset?: boolean }) => {
    if (!fn) return;
    setError(null);
    setOrgsLoading(true);
    try {
      const call = httpsCallable(fn, 'rootListOrganizations');
      const cursor = opts?.reset ? '' : orgCursor ?? '';
      const res = await call({
        limit: 25,
        cursor,
        q: qOrg,
        includeDefault,
        includeInactive,
      });

      const rows = ((res.data as any)?.organizations ?? []) as OrgRow[];
      const next = ((res.data as any)?.nextCursor ?? null) as string | null;

      setOrgs(Array.isArray(rows) ? rows : []);
      setOrgNextCursor(next);
      if (opts?.reset) setOrgCursor(null);

      // auto select: si no hay selected, usa default si existe
      if (!selectedOrg) {
        const ids = new Set((rows || []).map((r) => r.id));
        if (ids.has('default')) setSelectedOrg('default');
        else if (rows?.[0]?.id) setSelectedOrg(rows[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando organizaciones');
    } finally {
      setOrgsLoading(false);
    }
  };

  const nextOrgsPage = async () => {
    if (!orgNextCursor) return;
    setOrgCursor(orgNextCursor);
    await loadOrgs();
  };

  const loadSummary = async () => {
    if (!fn || !selectedOrg) return;
    setError(null);
    setSummaryLoading(true);
    try {
      const call = httpsCallable(fn, 'rootOrgSummary');
      const res = await call({ organizationId: selectedOrg });
      setSummary((res.data as any) ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando resumen');
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadUsers = async (opts?: { reset?: boolean }) => {
    if (!fn || !selectedOrg) return;
    setError(null);
    setUsersLoading(true);
    try {
      const call = httpsCallable(fn, 'rootListUsersByOrg');
      const cursor = opts?.reset ? null : userCursor;
      const res = await call({
        organizationId: selectedOrg,
        limit: 25,
        cursorEmail: cursor?.cursorEmail ?? '',
        cursorUid: cursor?.cursorUid ?? '',
        q: qUser,
      });

      const rows = ((res.data as any)?.users ?? []) as UserRow[];
      const next = ((res.data as any)?.nextCursor ?? null) as { cursorEmail: string; cursorUid: string } | null;

      setUsers(Array.isArray(rows) ? rows : []);
      setUserNextCursor(next);
      if (opts?.reset) setUserCursor(null);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando usuarios');
    } finally {
      setUsersLoading(false);
    }
  };

  const nextUsersPage = async () => {
    if (!userNextCursor) return;
    setUserCursor(userNextCursor);
    await loadUsers();
  };

  const moveUser = async () => {
    if (!fn) return;
    setError(null);
    setMoving(true);
    try {
      const call = httpsCallable(fn, 'rootUpsertUserToOrganization');
      const roleToSend = targetRole === 'root' ? 'admin' : targetRole; // root es claim, no role org
      const res = await call({
        email: moveEmail.trim(),
        organizationId: targetOrgId.trim(),
        role: roleToSend,
      });
      const ok = (res.data as any)?.ok;
      if (!ok) throw new Error('No se pudo aplicar el cambio');
      setMoveEmail('');
      await loadOrgs({ reset: true });
      setSelectedOrg(targetOrgId.trim());
      await loadUsers({ reset: true });
      await loadSummary();
    } catch (e: any) {
      setError(e?.message ?? 'Error actualizando usuario');
    } finally {
      setMoving(false);
    }
  };

  const dangerAllowed = confirmOrgId.trim() === selectedOrg && !!selectedOrg;

  const deactivateOrg = async (isActive: boolean) => {
    if (!fn || !dangerAllowed) return;
    setDangerBusy(true);
    setError(null);
    try {
      const call = httpsCallable(fn, 'rootDeactivateOrganization');
      await call({ organizationId: selectedOrg, isActive });
      await loadOrgs({ reset: true });
      await loadSummary();
    } catch (e: any) {
      setError(e?.message ?? 'Error desactivando organización');
    } finally {
      setDangerBusy(false);
    }
  };

  const purgeCollection = async (collection: string) => {
    if (!fn || !dangerAllowed) return;
    setDangerBusy(true);
    setError(null);
    try {
      const call = httpsCallable(fn, 'rootPurgeOrganizationCollection');
      await call({ organizationId: selectedOrg, collection, batchSize: 200 });
      await loadSummary();
    } catch (e: any) {
      setError(e?.message ?? 'Error purgando colección');
    } finally {
      setDangerBusy(false);
    }
  };

  const scaffoldDelete = async () => {
    if (!fn || !dangerAllowed) return;
    setDangerBusy(true);
    setError(null);
    try {
      const call = httpsCallable(fn, 'rootDeleteOrganizationScaffold');
      await call({ organizationId: selectedOrg });
      setSelectedOrg('');
      setSummary(null);
      setUsers([]);
      await loadOrgs({ reset: true });
    } catch (e: any) {
      setError(e?.message ?? 'Error borrando scaffold');
    } finally {
      setDangerBusy(false);
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
          <div className="pt-2 flex gap-2 flex-wrap">
            <Button variant="outline" onClick={handleSignOut}>
              Cerrar sesión
            </Button>
            <Button onClick={() => loadOrgs({ reset: true })} disabled={orgsLoading || !fn}>
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
        <CardContent className="space-y-3">
          <div className="grid gap-2 max-w-xl">
            <Label>Búsqueda</Label>
            <Input value={qOrg} onChange={(e) => setQOrg(e.target.value)} placeholder="default, YerayReyes, ..." />
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <Button
              variant={includeDefault ? 'default' : 'outline'}
              onClick={() => setIncludeDefault((v) => !v)}
              type="button"
            >
              incluir default
            </Button>
            <Button
              variant={includeInactive ? 'default' : 'outline'}
              onClick={() => setIncludeInactive((v) => !v)}
              type="button"
            >
              incluir inactivas
            </Button>
            <Button onClick={() => loadOrgs({ reset: true })} disabled={orgsLoading || !fn}>
              Aplicar filtro
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            {orgs.length === 0 ? 'Sin datos (aún).' : `Mostrando ${orgs.length} organizaciones.`}
          </div>

          {orgs.length > 0 ? (
            <div className="border rounded-md overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40">
                <div className="col-span-4">organizationId</div>
                <div className="col-span-5">nombre</div>
                <div className="col-span-3 text-right">estado</div>
              </div>
              {orgs.map((o) => (
                <button
                  key={o.id}
                  className={`grid grid-cols-12 gap-2 px-3 py-2 text-sm text-left hover:bg-muted/30 ${
                    selectedOrg === o.id ? 'bg-muted/50' : ''
                  }`}
                  onClick={() => setSelectedOrg(o.id)}
                  type="button"
                >
                  <div className="col-span-4 font-medium">{o.id}</div>
                  <div className="col-span-5 text-muted-foreground">{o.name ?? ''}</div>
                  <div className="col-span-3 text-right text-muted-foreground">{o.isActive === false ? 'INACTIVA' : 'OK'}</div>
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2 flex-wrap">
            <Button onClick={loadSummary} disabled={!selectedOrg || summaryLoading || !fn}>
              {summaryLoading ? 'Cargando…' : 'Ver resumen'}
            </Button>
            <Button onClick={() => loadUsers({ reset: true })} disabled={!selectedOrg || usersLoading || !fn}>
              {usersLoading ? 'Cargando…' : 'Ver usuarios'}
            </Button>
            <Button onClick={nextOrgsPage} disabled={!orgNextCursor || orgsLoading || !fn} variant="outline">
              Siguiente página
            </Button>
          </div>

          {summary ? (
            <div className="text-sm space-y-1">
              <div className="font-medium">Resumen:</div>
              <pre className="text-xs p-3 rounded-md bg-muted/40 overflow-auto">
                {JSON.stringify(summary?.counts ?? summary, null, 2)}
              </pre>
            </div>
          ) : null}

          {users.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-end gap-2 flex-wrap">
                <div className="grid gap-2 max-w-xl flex-1">
                  <Label>Buscar usuarios</Label>
                  <Input value={qUser} onChange={(e) => setQUser(e.target.value)} placeholder="email, nombre, uid..." />
                </div>
                <Button onClick={() => loadUsers({ reset: true })} disabled={!selectedOrg || usersLoading || !fn}>
                  Buscar
                </Button>
                <Button onClick={nextUsersPage} disabled={!userNextCursor || usersLoading || !fn} variant="outline">
                  Siguiente página
                </Button>
              </div>

              <div className="border rounded-md overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40">
                  <div className="col-span-4">email</div>
                  <div className="col-span-3">displayName</div>
                  <div className="col-span-2">role</div>
                  <div className="col-span-3">uid</div>
                </div>
                {users.map((u) => (
                  <div key={u.uid} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
                    <div className="col-span-4">{u.email ?? '-'}</div>
                    <div className="col-span-3 text-muted-foreground">{u.displayName ?? '-'}</div>
                    <div className="col-span-2">{u.role ?? '-'}</div>
                    <div className="col-span-3 text-xs text-muted-foreground break-all">{u.uid}</div>
                  </div>
                ))}
              </div>
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
            <Input value={moveEmail} onChange={(e) => setMoveEmail(e.target.value)} placeholder="usuario@empresa.com" />
          </div>
          <div className="grid gap-2">
            <Label>organizationId destino</Label>
            <Input value={targetOrgId} onChange={(e) => setTargetOrgId(e.target.value)} placeholder="default" />
          </div>
          <div className="grid gap-2">
            <Label>Rol (en esa organización)</Label>
            <div className="flex gap-2 flex-wrap">
              {(['root', 'super_admin', 'admin', 'maintenance', 'operator'] as const).map((r) => (
                <Button
                  key={r}
                  variant={targetRole === r ? 'default' : 'outline'}
                  onClick={() => setTargetRole(r)}
                  type="button"
                >
                  {r === 'root' ? 'root (claim)' : r}
                </Button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Nota: <b>root</b> es un custom claim y no se asigna como role en org. Usa super_admin/admin/etc.
            </div>
          </div>
          <Button onClick={moveUser} disabled={!moveEmail.trim() || !targetOrgId.trim() || moving || !fn}>
            {moving ? 'Aplicando…' : 'Aplicar'}
          </Button>
          <div className="text-xs text-muted-foreground">
            Esto crea/actualiza: users/{'{uid}'} (organizationId), memberships (userId_orgId) y organizations/{'{orgId}'}/members/{'{uid}'}.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zona peligrosa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Para acciones destructivas, escribe exactamente el organizationId: <b>{selectedOrg || '(selecciona una org)'}</b>
          </div>
          <Input value={confirmOrgId} onChange={(e) => setConfirmOrgId(e.target.value)} placeholder={selectedOrg || 'organizationId'} />
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" disabled={!dangerAllowed || dangerBusy || !fn} onClick={() => deactivateOrg(false)}>
              Desactivar organización
            </Button>
            <Button variant="outline" disabled={!dangerAllowed || dangerBusy || !fn} onClick={() => purgeCollection('tickets')}>
              Purgar tickets (solo org)
            </Button>
            <Button variant="outline" disabled={!dangerAllowed || dangerBusy || !fn} onClick={() => purgeCollection('tasks')}>
              Purgar tasks (solo org)
            </Button>
            <Button variant="destructive" disabled={!dangerAllowed || dangerBusy || !fn} onClick={scaffoldDelete}>
              Scaffold delete org
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Recomendación: usa “Desactivar” antes de borrar. “Purgar” elimina documentos asociados a esa org. “Scaffold delete” elimina estructura base.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
