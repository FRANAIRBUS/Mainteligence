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
  createdAt?: any;
  updatedAt?: any;
};

type OrgCounts = {
  members: number;
  users: number;
  tickets: number;
  tasks: number;
  sites: number;
  assets: number;
  departments: number;
};

type OrgSummary = { organizationId: string; counts: OrgCounts };

type OrgMemberRow = {
  uid: string;
  email: string | null;
  displayName: string | null;
  active: boolean;
  role: string;
  departmentId: string | null;
};

type UsersCursor = { email: string; uid: string };

const ROLE_OPTIONS = [
  { value: 'root', label: 'root (claim)' },
  { value: 'super_admin', label: 'super_admin' },
  { value: 'admin', label: 'admin' },
  { value: 'maintenance', label: 'maintenance' },
  { value: 'operator', label: 'operator' }
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

  // ORGS
  const [orgSearch, setOrgSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [orgLimit, setOrgLimit] = useState(25);

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgNextCursor, setOrgNextCursor] = useState<string | null>(null);
  const [orgCursor, setOrgCursor] = useState<string | null>(null);
  const [orgCursorStack, setOrgCursorStack] = useState<(string | null)[]>([]);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('');

  // SUMMARY
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // USERS
  const [users, setUsers] = useState<OrgMemberRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSearchEmail, setUsersSearchEmail] = useState('');
  const [usersLimit, setUsersLimit] = useState(25);
  const [usersNextCursor, setUsersNextCursor] = useState<UsersCursor | null>(null);
  const [usersCursor, setUsersCursor] = useState<UsersCursor | null>(null);
  const [usersCursorStack, setUsersCursorStack] = useState<(UsersCursor | null)[]>([]);

  // MOVE / CLAIM
  const [email, setEmail] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('default');
  const [targetRole, setTargetRole] = useState<(typeof ROLE_OPTIONS)[number]['value']>('admin');
  const [moving, setMoving] = useState(false);

  // DANGER
  const [confirmOrgId, setConfirmOrgId] = useState('');
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

  const loadOrgs = async (mode: 'reset' | 'next' | 'prev' = 'reset') => {
    if (!fn) return;

    setError(null);
    setOrgsLoading(true);
    try {
      let cursorToUse: string | null = orgCursor;

      if (mode === 'reset') {
        cursorToUse = null;
        setOrgCursor(null);
        setOrgCursorStack([]);
      } else if (mode === 'prev') {
        const stack = [...orgCursorStack];
        stack.pop();
        cursorToUse = stack.length ? stack[stack.length - 1] : null;
        setOrgCursorStack(stack);
        setOrgCursor(cursorToUse);
      } else if (mode === 'next') {
        if (orgNextCursor) {
          setOrgCursorStack((s) => [...s, orgNextCursor]);
          cursorToUse = orgNextCursor;
          setOrgCursor(orgNextCursor);
        }
      }

      const call = httpsCallable(fn, 'rootListOrganizations');
      const res = await call({
        limit: orgLimit,
        cursor: cursorToUse,
        search: orgSearch.trim(),
        includeInactive
      });

      const rows = ((res.data as any)?.organizations ?? []) as OrgRow[];
      const nextCursor = ((res.data as any)?.nextCursor ?? null) as string | null;

      setOrgs(Array.isArray(rows) ? rows : []);
      setOrgNextCursor(nextCursor);
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
      const counts = (res.data as any)?.counts as OrgCounts;
      setSummary({ organizationId: orgId, counts });
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando resumen');
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadUsers = async (orgId: string, mode: 'reset' | 'next' | 'prev' = 'reset') => {
    if (!fn) return;

    setError(null);
    setUsersLoading(true);
    try {
      let cursorToUse: UsersCursor | null = usersCursor;

      if (mode === 'reset') {
        cursorToUse = null;
        setUsersCursor(null);
        setUsersCursorStack([]);
      } else if (mode === 'prev') {
        const stack = [...usersCursorStack];
        stack.pop();
        cursorToUse = stack.length ? stack[stack.length - 1] : null;
        setUsersCursorStack(stack);
        setUsersCursor(cursorToUse);
      } else if (mode === 'next') {
        if (usersNextCursor) {
          setUsersCursorStack((s) => [...s, usersNextCursor]);
          cursorToUse = usersNextCursor;
          setUsersCursor(usersNextCursor);
        }
      }

      const call = httpsCallable(fn, 'rootListUsersByOrg');
      const res = await call({
        organizationId: orgId,
        limit: usersLimit,
        cursor: cursorToUse,
        searchEmail: usersSearchEmail.trim()
      });

      const rows = ((res.data as any)?.users ?? []) as OrgMemberRow[];
      const nextCursor = ((res.data as any)?.nextCursor ?? null) as UsersCursor | null;

      setUsers(Array.isArray(rows) ? rows : []);
      setUsersNextCursor(nextCursor);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando usuarios');
    } finally {
      setUsersLoading(false);
    }
  };

  const selectOrg = async (orgId: string) => {
    setSelectedOrgId(orgId);
    setTargetOrgId(orgId);
    setConfirmOrgId(orgId);
    setSummary(null);
    setUsers([]);
    await Promise.all([loadSummary(orgId), loadUsers(orgId, 'reset')]);
  };

  const moveUser = async () => {
    if (!fn) return;
    setError(null);
    setMoving(true);

    try {
      const mail = email.trim();
      const orgId = targetOrgId.trim();
      if (!mail) throw new Error('Email requerido');

      if (targetRole === 'root') {
        const call = httpsCallable(fn, 'rootSetUserRootClaim');
        const res = await call({ email: mail, root: true, detach: true });
        if (!(res.data as any)?.ok) throw new Error('No se pudo asignar root claim');
      } else {
        if (!orgId) throw new Error('organizationId requerido');
        const call = httpsCallable(fn, 'rootUpsertUserToOrganization');
        const res = await call({ email: mail, organizationId: orgId, role: targetRole });
        if (!(res.data as any)?.ok) throw new Error('No se pudo aplicar el cambio');
      }

      setEmail('');
      await loadOrgs('reset');
      if (selectedOrgId) await Promise.all([loadSummary(selectedOrgId), loadUsers(selectedOrgId, 'reset')]);
    } catch (e: any) {
      setError(e?.message ?? 'Error actualizando usuario');
    } finally {
      setMoving(false);
    }
  };

  const toggleOrgActive = async (orgId: string, isActive: boolean) => {
    if (!fn) return;
    setError(null);
    setDangerBusy(true);
    try {
      const call = httpsCallable(fn, 'rootDeactivateOrganization');
      await call({ organizationId: orgId, isActive });
      await loadOrgs('reset');
      if (selectedOrgId === orgId) await loadSummary(orgId);
    } catch (e: any) {
      setError(e?.message ?? 'Error actualizando organización');
    } finally {
      setDangerBusy(false);
    }
  };

  const purge = async (collection: 'tickets' | 'tasks' | 'members') => {
    if (!fn) return;
    if (!selectedOrgId) return;

    setError(null);
    setDangerBusy(true);
    try {
      const call = httpsCallable(fn, 'rootPurgeOrganizationCollection');
      await call({
        organizationId: selectedOrgId,
        collection,
        confirm: confirmOrgId.trim(),
        batchSize: 250,
        maxDocs: 1500
      });
      await Promise.all([loadSummary(selectedOrgId), loadUsers(selectedOrgId, 'reset')]);
    } catch (e: any) {
      setError(e?.message ?? 'Error purgando colección');
    } finally {
      setDangerBusy(false);
    }
  };

  const deleteScaffold = async (hardDelete: boolean) => {
    if (!fn) return;
    if (!selectedOrgId) return;

    setError(null);
    setDangerBusy(true);
    try {
      const call = httpsCallable(fn, 'rootDeleteOrganizationScaffold');
      await call({ organizationId: selectedOrgId, confirm: confirmOrgId.trim(), hardDelete });
      setSelectedOrgId('');
      setSummary(null);
      setUsers([]);
      await loadOrgs('reset');
    } catch (e: any) {
      setError(e?.message ?? 'Error borrando organización');
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Root Console</CardTitle>
          <Button variant="outline" onClick={handleSignOut}>
            Cerrar sesión
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Sesión: <span className="font-medium text-foreground">{user.email}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Root es un modo oculto (custom claim) que no pertenece a ninguna organización.
          </div>
          {error ? <div className="text-sm text-red-600 pt-2">{error}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organizaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="grid gap-2 md:col-span-2">
              <Label>Búsqueda (prefijo por organizationId)</Label>
              <Input value={orgSearch} onChange={(e) => setOrgSearch(e.target.value)} placeholder="default / YerayReyes / ..." />
            </div>
            <div className="grid gap-2">
              <Label>Límite por página</Label>
              <Input type="number" value={orgLimit} onChange={(e) => setOrgLimit(Number(e.target.value))} min={1} max={200} />
            </div>
            <div className="grid gap-2">
              <Label>Incluir desactivadas</Label>
              <div className="flex gap-2">
                <Button variant={includeInactive ? 'default' : 'outline'} type="button" onClick={() => setIncludeInactive(true)}>
                  Sí
                </Button>
                <Button variant={!includeInactive ? 'default' : 'outline'} type="button" onClick={() => setIncludeInactive(false)}>
                  No
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => loadOrgs('reset')} disabled={orgsLoading || !fn}>
              {orgsLoading ? 'Cargando…' : 'Cargar'}
            </Button>
            <Button variant="outline" onClick={() => loadOrgs('prev')} disabled={orgsLoading || orgCursorStack.length === 0 || !fn}>
              ◀ Anterior
            </Button>
            <Button variant="outline" onClick={() => loadOrgs('next')} disabled={orgsLoading || !orgNextCursor || !fn}>
              Siguiente ▶
            </Button>
            <div className="text-sm text-muted-foreground self-center">
              {orgs.length === 0 ? 'Sin datos (aún).' : `Mostrando ${orgs.length} organizaciones.`}
            </div>
          </div>

          {orgs.length > 0 ? (
            <div className="overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Org ID</th>
                    <th className="text-left p-2">Nombre</th>
                    <th className="text-left p-2">Activa</th>
                    <th className="text-left p-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => {
                    const active = o.isActive !== false;
                    const isSelected = selectedOrgId === o.id;
                    return (
                      <tr key={o.id} className={isSelected ? 'bg-muted' : ''}>
                        <td className="p-2 font-medium">{o.id}</td>
                        <td className="p-2 text-muted-foreground">{o.name ?? ''}</td>
                        <td className="p-2">{active ? 'Sí' : 'No'}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => selectOrg(o.id)}>
                              Ver
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => toggleOrgActive(o.id, !active)} disabled={dangerBusy}>
                              {active ? 'Desactivar' : 'Activar'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="text-xs text-muted-foreground">
            Nota: la búsqueda es por prefijo del <b>documentId</b> (organizationId).
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vista de organización</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm">
            Org seleccionada: <span className="font-medium">{selectedOrgId || '—'}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => selectedOrgId && loadSummary(selectedOrgId)} disabled={!selectedOrgId || summaryLoading || !fn}>
              {summaryLoading ? 'Cargando…' : 'Ver resumen'}
            </Button>
            <Button onClick={() => selectedOrgId && loadUsers(selectedOrgId, 'reset')} disabled={!selectedOrgId || usersLoading || !fn}>
              {usersLoading ? 'Cargando…' : 'Ver usuarios'}
            </Button>
          </div>

          <div className="border rounded-lg p-3">
            <div className="font-medium mb-2">Resumen</div>
            {summary && summary.organizationId === selectedOrgId ? (
              <div className="text-sm space-y-1">
                <div>members: {summary.counts.members}</div>
                <div>users: {summary.counts.users}</div>
                <div>tickets: {summary.counts.tickets}</div>
                <div>tasks: {summary.counts.tasks}</div>
                <div>sites: {summary.counts.sites}</div>
                <div>assets: {summary.counts.assets}</div>
                <div>departments: {summary.counts.departments}</div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin datos.</div>
            )}
          </div>

          <div className="border rounded-lg p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-2">
                <Label>Buscar email (prefijo)</Label>
                <Input value={usersSearchEmail} onChange={(e) => setUsersSearchEmail(e.target.value)} placeholder="usuario@" />
              </div>
              <div className="grid gap-2 w-36">
                <Label>Límite</Label>
                <Input type="number" value={usersLimit} onChange={(e) => setUsersLimit(Number(e.target.value))} min={1} max={200} />
              </div>

              <Button variant="outline" onClick={() => selectedOrgId && loadUsers(selectedOrgId, 'reset')} disabled={!selectedOrgId || usersLoading || !fn}>
                Buscar
              </Button>

              <Button variant="outline" onClick={() => selectedOrgId && loadUsers(selectedOrgId, 'prev')} disabled={!selectedOrgId || usersLoading || usersCursorStack.length === 0 || !fn}>
                ◀ Anterior
              </Button>

              <Button variant="outline" onClick={() => selectedOrgId && loadUsers(selectedOrgId, 'next')} disabled={!selectedOrgId || usersLoading || !usersNextCursor || !fn}>
                Siguiente ▶
              </Button>
            </div>

            <div className="font-medium">Usuarios en organización</div>

            {users.length > 0 ? (
              <div className="overflow-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Email</th>
                      <th className="text-left p-2">Nombre</th>
                      <th className="text-left p-2">Activo</th>
                      <th className="text-left p-2">Rol</th>
                      <th className="text-left p-2">UID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.uid}>
                        <td className="p-2">{u.email ?? '—'}</td>
                        <td className="p-2 text-muted-foreground">{u.displayName ?? '—'}</td>
                        <td className="p-2">{u.active ? 'Sí' : 'No'}</td>
                        <td className="p-2">{u.role}</td>
                        <td className="p-2 font-mono text-xs">{u.uid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Sin usuarios (o sin búsqueda aplicada).</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reubicar usuario / asignar claim</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>Email del usuario</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" />
            </div>
            <div className="grid gap-2">
              <Label>organizationId destino</Label>
              <Input value={targetOrgId} onChange={(e) => setTargetOrgId(e.target.value)} placeholder="default" />
            </div>
            <div className="grid gap-2">
              <Label>Rol</Label>
              <div className="flex gap-2 flex-wrap">
                {ROLE_OPTIONS.map((r) => (
                  <Button key={r.value} variant={targetRole === r.value ? 'default' : 'outline'} onClick={() => setTargetRole(r.value)} type="button">
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <Button onClick={moveUser} disabled={!email.trim() || moving || !fn}>
            {moving ? 'Aplicando…' : 'Aplicar'}
          </Button>

          <div className="text-xs text-muted-foreground">
            Nota: <b>root</b> es un custom claim (modo oculto) y no se asigna como role en organizaciones. Roles de org recomendados: super_admin/admin/maintenance/operator.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zona peligrosa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Para acciones destructivas, escribe exactamente el <b>organizationId</b> seleccionado.
          </div>

          <div className="grid gap-2 max-w-md">
            <Label>Confirmación</Label>
            <Input value={confirmOrgId} onChange={(e) => setConfirmOrgId(e.target.value)} placeholder={selectedOrgId || 'organizationId'} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!selectedOrgId || dangerBusy || confirmOrgId.trim() !== selectedOrgId} onClick={() => purge('members')}>
              Purgar members (solo org)
            </Button>

            <Button variant="outline" disabled={!selectedOrgId || dangerBusy || confirmOrgId.trim() !== selectedOrgId} onClick={() => purge('tickets')}>
              Purgar tickets (solo org)
            </Button>

            <Button variant="outline" disabled={!selectedOrgId || dangerBusy || confirmOrgId.trim() !== selectedOrgId} onClick={() => purge('tasks')}>
              Purgar tasks (solo org)
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" disabled={!selectedOrgId || dangerBusy || confirmOrgId.trim() !== selectedOrgId} onClick={() => deleteScaffold(false)}>
              Scaffold delete org (soft)
            </Button>

            <Button variant="destructive" disabled={!selectedOrgId || dangerBusy || confirmOrgId.trim() !== selectedOrgId} onClick={() => deleteScaffold(true)}>
              Hard delete org doc (NO subcollections)
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Recomendación: usa “Desactivar” antes de borrar. “Purgar” elimina documentos asociados a esa org (según la función). “Hard delete” solo borra el documento raíz de organizations/{'{orgId}'}, NO subcolecciones.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
