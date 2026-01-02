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
  isActive?: boolean;
  updatedAt?: any;
};

type CursorOrg = { lastUpdatedAtMillis: number | null; lastId: string };

type UserRow = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  active?: boolean;
  role?: string;
};

const ROLE_BUTTONS = ['root (claim)', 'super_admin', 'admin', 'maintenance', 'operator'] as const;

export default function RootPage() {
  const router = useRouter();
  const auth = useAuth();
  const { user, loading, isRoot } = useUser();

  const fn = useMemo(() => {
    try {
      const app = getClientFirebaseApp();
      return getFunctions(app, 'us-central1');
    } catch {
      return null;
    }
  }, []);

  const [error, setError] = useState<string | null>(null);

  // Orgs table state
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgSearch, setOrgSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [orgLimit, setOrgLimit] = useState(25);
  const [orgCursor, setOrgCursor] = useState<CursorOrg | null>(null);
  const [orgNextCursor, setOrgNextCursor] = useState<CursorOrg | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('');

  // Summary/users state
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<any | null>(null);

  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userSearch, setUserSearch] = useState('');

  // Move user
  const [email, setEmail] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('default');
  const [targetRole, setTargetRole] = useState<(typeof ROLE_BUTTONS)[number]>('admin');
  const [moving, setMoving] = useState(false);

  // Danger
  const [dangerTyped, setDangerTyped] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isRoot) {
      router.replace('/');
      return;
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

  const loadOrgs = async (opts?: { reset?: boolean }) => {
    if (!fn) return;
    setError(null);
    setOrgLoading(true);

    try {
      const call = httpsCallable(fn, 'rootListOrganizations');

      const res = await call({
        limit: orgLimit,
        includeInactive,
        search: orgSearch.trim(),
        cursor: opts?.reset ? null : orgCursor,
      });

      const rows = (res.data as any)?.organizations as OrgRow[];
      const next = (res.data as any)?.nextCursor as CursorOrg | null;

      setOrgs(Array.isArray(rows) ? rows : []);
      setOrgNextCursor(next || null);

      // if reset, also reset cursor
      if (opts?.reset) setOrgCursor(null);

      // Auto-select default if nothing selected and exists
      if (!selectedOrgId) {
        const hasDefault = (rows || []).some((o) => o.id === 'default');
        if (hasDefault) setSelectedOrgId('default');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando organizaciones');
    } finally {
      setOrgLoading(false);
    }
  };

  const nextPageOrgs = async () => {
    if (!orgNextCursor) return;
    setOrgCursor(orgNextCursor);
    await loadOrgs();
  };

  const refreshOrgs = async () => {
    await loadOrgs({ reset: true });
  };

  const viewSummary = async () => {
    if (!fn || !selectedOrgId) return;
    setError(null);
    setSummaryLoading(true);
    try {
      const call = httpsCallable(fn, 'rootOrgSummary');
      const res = await call({ organizationId: selectedOrgId });
      setSummary((res.data as any) || null);
    } catch (e: any) {
      setError(e?.message ?? 'Error obteniendo resumen');
    } finally {
      setSummaryLoading(false);
    }
  };

  const viewUsers = async () => {
    if (!fn || !selectedOrgId) return;
    setError(null);
    setUsersLoading(true);
    try {
      const call = httpsCallable(fn, 'rootListUsersByOrg');
      const res = await call({ organizationId: selectedOrgId, limit: 100, search: userSearch.trim() });
      const rows = (res.data as any)?.users as UserRow[];
      setUsers(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando usuarios');
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
      const roleToSend = targetRole === 'root (claim)' ? 'operator' : targetRole; // root is claim, not org role

      const res = await call({
        email: email.trim(),
        organizationId: targetOrgId.trim(),
        role: roleToSend,
      });

      const ok = (res.data as any)?.ok;
      if (!ok) throw new Error('No se pudo aplicar el cambio');

      setEmail('');
      await refreshOrgs();
      if (selectedOrgId === targetOrgId.trim()) {
        await viewUsers();
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error actualizando usuario');
    } finally {
      setMoving(false);
    }
  };

  const deactivateOrg = async () => {
    if (!fn || !selectedOrgId) return;
    if (dangerTyped.trim() !== selectedOrgId) {
      setError('Confirmación peligrosa incorrecta (debe coincidir exactamente con organizationId).');
      return;
    }
    setError(null);
    try {
      const call = httpsCallable(fn, 'rootDeactivateOrganization');
      await call({ organizationId: selectedOrgId });
      await refreshOrgs();
    } catch (e: any) {
      setError(e?.message ?? 'Error desactivando organización');
    }
  };

  const purgeCollection = async (collectionName: string) => {
    if (!fn || !selectedOrgId) return;
    if (dangerTyped.trim() !== selectedOrgId) {
      setError('Confirmación peligrosa incorrecta (debe coincidir exactamente con organizationId).');
      return;
    }
    setError(null);
    try {
      const call = httpsCallable(fn, 'rootPurgeOrganizationCollection');
      await call({ organizationId: selectedOrgId, collectionName, maxDocs: 20000 });
      await viewSummary();
      await viewUsers();
    } catch (e: any) {
      setError(e?.message ?? `Error purgando ${collectionName}`);
    }
  };

  const scaffoldDelete = async () => {
    if (!fn || !selectedOrgId) return;
    if (dangerTyped.trim() !== selectedOrgId) {
      setError('Confirmación peligrosa incorrecta (debe coincidir exactamente con organizationId).');
      return;
    }
    setError(null);
    try {
      const call = httpsCallable(fn, 'rootDeleteOrganizationScaffold');
      await call({ organizationId: selectedOrgId });
      setSelectedOrgId('');
      await refreshOrgs();
      setSummary(null);
      setUsers([]);
    } catch (e: any) {
      setError(e?.message ?? 'Error en scaffold delete');
    }
  };

  useEffect(() => {
    // initial load
    if (!loading && user && isRoot) {
      loadOrgs({ reset: true }).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, isRoot]);

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
            <Button onClick={refreshOrgs} disabled={orgLoading || !fn}>
              {orgLoading ? 'Cargando…' : 'Refrescar organizaciones'}
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
          <div className="grid gap-2 md:grid-cols-4">
            <div className="grid gap-2">
              <Label>Búsqueda</Label>
              <Input
                value={orgSearch}
                onChange={(e) => setOrgSearch(e.target.value)}
                placeholder="default, Yeray, Montesdeoca…"
              />
            </div>

            <div className="grid gap-2">
              <Label>Límite</Label>
              <Input
                value={String(orgLimit)}
                onChange={(e) => setOrgLimit(parseInt(e.target.value || '25', 10) || 25)}
                placeholder="25"
              />
            </div>

            <div className="grid gap-2">
              <Label>Incluir inactivas</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={includeInactive ? 'default' : 'outline'}
                  onClick={() => setIncludeInactive((v) => !v)}
                >
                  {includeInactive ? 'Sí' : 'No'}
                </Button>
                <Button type="button" variant="outline" onClick={() => loadOrgs({ reset: true })} disabled={orgLoading}>
                  Aplicar filtros
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Selecciona organización</Label>
              <select
                className="border rounded-md px-3 py-2 text-sm"
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
              >
                <option value="">(ninguna)</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {orgs.length === 0 ? 'Sin datos (aún).' : `Mostrando ${orgs.length} organizaciones.`}
          </div>

          {orgs.length > 0 ? (
            <div className="overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">organizationId</th>
                    <th className="text-left p-2">name</th>
                    <th className="text-left p-2">active</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr
                      key={o.id}
                      className={`border-t hover:bg-muted/30 cursor-pointer ${
                        selectedOrgId === o.id ? 'bg-muted/30' : ''
                      }`}
                      onClick={() => setSelectedOrgId(o.id)}
                    >
                      <td className="p-2 font-medium">{o.id}</td>
                      <td className="p-2 text-muted-foreground">{o.name ?? ''}</td>
                      <td className="p-2">{o.isActive === false ? 'false' : 'true'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex gap-2 flex-wrap">
            <Button onClick={nextPageOrgs} disabled={!orgNextCursor || orgLoading}>
              Siguiente página
            </Button>
            <Button variant="outline" onClick={() => setOrgCursor(null)} disabled={!orgCursor || orgLoading}>
              Reset cursor
            </Button>
          </div>

          <div className="flex gap-2 flex-wrap pt-2">
            <Button onClick={viewSummary} disabled={!selectedOrgId || summaryLoading || !fn}>
              {summaryLoading ? 'Cargando…' : 'Ver resumen'}
            </Button>
            <Button onClick={viewUsers} disabled={!selectedOrgId || usersLoading || !fn}>
              {usersLoading ? 'Cargando…' : 'Ver usuarios'}
            </Button>
          </div>

          {summary ? (
            <div className="border rounded-md p-3 text-sm">
              <div className="font-medium mb-2">Resumen:</div>
              <pre className="text-xs overflow-auto">{JSON.stringify(summary.counts ?? summary, null, 2)}</pre>
            </div>
          ) : null}

          {selectedOrgId ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Usuarios en organización</div>
              <div className="text-xs text-muted-foreground">Org seleccionada: {selectedOrgId}</div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Buscar usuario</Label>
                  <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="email, nombre…" />
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline" onClick={viewUsers} disabled={!fn || usersLoading}>
                    {usersLoading ? 'Cargando…' : 'Aplicar búsqueda'}
                  </Button>
                </div>
              </div>

              {users.length === 0 ? (
                <div className="text-sm text-muted-foreground">Sin usuarios (o filtro sin resultados).</div>
              ) : (
                <div className="overflow-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left p-2">email</th>
                        <th className="text-left p-2">uid</th>
                        <th className="text-left p-2">displayName</th>
                        <th className="text-left p-2">active</th>
                        <th className="text-left p-2">role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.uid} className="border-t">
                          <td className="p-2">{u.email ?? '-'}</td>
                          <td className="p-2 text-muted-foreground">{u.uid}</td>
                          <td className="p-2">{u.displayName ?? '-'}</td>
                          <td className="p-2">{u.active ? 'true' : 'false'}</td>
                          <td className="p-2">{u.role ?? 'operator'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
              {ROLE_BUTTONS.map((r) => (
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
            <div className="text-xs text-muted-foreground">
              Nota: <b>root</b> es un custom claim y <b>no</b> se asigna como role en org. Usa super_admin/admin/etc.
            </div>
          </div>

          <Button onClick={moveUser} disabled={!email.trim() || !targetOrgId.trim() || moving || !fn}>
            {moving ? 'Aplicando…' : 'Aplicar'}
          </Button>

          <div className="text-xs text-muted-foreground">
            Esto crea/actualiza: users/{'{uid}'} (organizationId), memberships (userId_orgId) y organizations/{'{orgId}'}/members/
            {'{uid}'}.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zona peligrosa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Para acciones destructivas, escribe exactamente el <b>organizationId</b> seleccionado:
          </div>

          <div className="grid gap-2">
            <Label>organizationId seleccionado</Label>
            <Input value={selectedOrgId || ''} readOnly />
          </div>

          <div className="grid gap-2">
            <Label>Confirmación (escribe exactamente el organizationId)</Label>
            <Input value={dangerTyped} onChange={(e) => setDangerTyped(e.target.value)} placeholder="Ej: YerayReyes" />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={deactivateOrg} disabled={!selectedOrgId || !fn}>
              Desactivar organización
            </Button>
            <Button variant="outline" onClick={() => purgeCollection('tickets')} disabled={!selectedOrgId || !fn}>
              Purgar tickets (solo org)
            </Button>
            <Button variant="outline" onClick={() => purgeCollection('tasks')} disabled={!selectedOrgId || !fn}>
              Purgar tasks (solo org)
            </Button>
            <Button variant="destructive" onClick={scaffoldDelete} disabled={!selectedOrgId || !fn}>
              Scaffold delete org
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Recomendación: usa “Desactivar” antes de borrar. “Purgar” elimina documentos asociados a esa org (según la función).
            “Scaffold delete” elimina estructura base.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
