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
  name?: string | null;
  isActive?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

type OrgSummary = {
  members?: number;
  users?: number;
  tickets?: number;
  tasks?: number;
  sites?: number;
  assets?: number;
  departments?: number;
};

type MemberRow = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  active?: boolean;
  role?: string | null;
  departmentId?: string | null;
};

const ROLE_OPTIONS = ['super_admin', 'admin', 'maintenance', 'operator'] as const;

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

  // ORGS
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgQ, setOrgQ] = useState('');
  const [orgCursor, setOrgCursor] = useState<string | null>(null);
  const [orgHasMore, setOrgHasMore] = useState(false);
  const [orgLimit, setOrgLimit] = useState(25);
  const [includeInactive, setIncludeInactive] = useState(true);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('');

  // SUMMARY
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // USERS
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberQ, setMemberQ] = useState('');
  const [memberCursorEmail, setMemberCursorEmail] = useState<string | null>(null);
  const [memberCursorUid, setMemberCursorUid] = useState<string | null>(null);
  const [memberHasMore, setMemberHasMore] = useState(false);
  const [memberLimit, setMemberLimit] = useState(25);

  // MOVE USER
  const [emailToMove, setEmailToMove] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('default');
  const [targetRole, setTargetRole] = useState<(typeof ROLE_OPTIONS)[number]>('admin');
  const [moving, setMoving] = useState(false);

  // DANGER
  const [dangerConfirm, setDangerConfirm] = useState('');
  const canDanger = dangerConfirm.trim() === selectedOrgId && Boolean(selectedOrgId);

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

  const api = useMemo(() => {
    if (!fn) return null;
    return {
      rootListOrganizations: httpsCallable(fn, 'rootListOrganizations'),
      rootOrgSummary: httpsCallable(fn, 'rootOrgSummary'),
      rootListUsersByOrg: httpsCallable(fn, 'rootListUsersByOrg'),
      rootUpsertUserToOrganization: httpsCallable(fn, 'rootUpsertUserToOrganization'),
      rootDeactivateOrganization: httpsCallable(fn, 'rootDeactivateOrganization'),
      rootPurgeOrganizationCollection: httpsCallable(fn, 'rootPurgeOrganizationCollection'),
      rootDeleteOrganizationScaffold: httpsCallable(fn, 'rootDeleteOrganizationScaffold'),
    };
  }, [fn]);

  const loadOrgs = async (mode: 'reset' | 'next' = 'reset') => {
    if (!api) return;
    setError(null);
    setOrgsLoading(true);
    try {
      const res = await api.rootListOrganizations({
        limit: orgLimit,
        q: orgQ.trim() || null,
        cursor: mode === 'next' ? orgCursor : null,
        includeInactive,
        includeDefault: true,
      });
      const data = res.data as any;
      const rows = (data?.organizations ?? []) as OrgRow[];
      const nextCursor = (data?.nextCursor ?? null) as string | null;

      if (mode === 'reset') setOrgs(rows);
      else setOrgs((prev) => [...prev, ...rows]);

      setOrgCursor(nextCursor);
      setOrgHasMore(Boolean(nextCursor));
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando organizaciones');
    } finally {
      setOrgsLoading(false);
    }
  };

  const loadSummary = async () => {
    if (!api || !selectedOrgId) return;
    setError(null);
    setSummaryLoading(true);
    try {
      const res = await api.rootOrgSummary({ organizationId: selectedOrgId });
      const data = res.data as any;
      setSummary((data?.summary ?? null) as OrgSummary);
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando resumen');
    } finally {
      setSummaryLoading(false);
    }
  };

  const loadMembers = async (mode: 'reset' | 'next' = 'reset') => {
    if (!api || !selectedOrgId) return;
    setError(null);
    setMembersLoading(true);
    try {
      const payload: any = { organizationId: selectedOrgId, limit: memberLimit };
      if (memberQ.trim()) payload.q = memberQ.trim();
      if (mode === 'next') {
        payload.cursorEmail = memberCursorEmail;
        payload.cursorUid = memberCursorUid;
      }

      const res = await api.rootListUsersByOrg(payload);
      const data = res.data as any;

      const rows = (data?.users ?? []) as MemberRow[];
      const nextEmail = (data?.nextCursorEmail ?? null) as string | null;
      const nextUid = (data?.nextCursorUid ?? null) as string | null;

      if (mode === 'reset') setMembers(rows);
      else setMembers((prev) => [...prev, ...rows]);

      setMemberCursorEmail(nextEmail);
      setMemberCursorUid(nextUid);
      setMemberHasMore(Boolean(nextEmail && nextUid));
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando usuarios');
    } finally {
      setMembersLoading(false);
    }
  };

  const moveUser = async () => {
    if (!api) return;
    setError(null);
    setMoving(true);
    try {
      const res = await api.rootUpsertUserToOrganization({
        email: emailToMove.trim(),
        organizationId: targetOrgId.trim(),
        role: targetRole,
      });
      const ok = (res.data as any)?.ok;
      if (!ok) throw new Error('No se pudo aplicar el cambio');

      setEmailToMove('');
      // refresca orgs + users
      await loadOrgs('reset');
      if (selectedOrgId) {
        await loadSummary();
        await loadMembers('reset');
      }
    } catch (e: any) {
      setError(e?.message ?? 'Error reubicando usuario');
    } finally {
      setMoving(false);
    }
  };

  const deactivateOrg = async (isActive: boolean) => {
    if (!api || !selectedOrgId) return;
    setError(null);
    try {
      await api.rootDeactivateOrganization({ organizationId: selectedOrgId, isActive });
      await loadOrgs('reset');
      await loadSummary();
    } catch (e: any) {
      setError(e?.message ?? 'Error actualizando organización');
    }
  };

  const purge = async (collection: string) => {
    if (!api || !selectedOrgId) return;
    setError(null);
    try {
      await api.rootPurgeOrganizationCollection({ organizationId: selectedOrgId, collection, batchSize: 200 });
      await loadSummary();
      if (collection === 'users') await loadMembers('reset');
    } catch (e: any) {
      setError(e?.message ?? 'Error purgando colección');
    }
  };

  const deleteScaffold = async () => {
    if (!api || !selectedOrgId) return;
    setError(null);
    try {
      await api.rootDeleteOrganizationScaffold({ organizationId: selectedOrgId });
      setSelectedOrgId('');
      setSummary(null);
      setMembers([]);
      setDangerConfirm('');
      await loadOrgs('reset');
    } catch (e: any) {
      setError(e?.message ?? 'Error borrando scaffold');
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
          </div>

          {error ? <div className="text-sm text-red-600 pt-2">{error}</div> : null}
        </CardContent>
      </Card>

      {/* ORGS TABLE */}
      <Card>
        <CardHeader>
          <CardTitle>Organizaciones (PRO)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label>Búsqueda (prefijo orgId)</Label>
              <Input value={orgQ} onChange={(e) => setOrgQ(e.target.value)} placeholder="default, Yeray..." />
            </div>

            <div>
              <Label>Límite</Label>
              <Input
                type="number"
                value={orgLimit}
                onChange={(e) => setOrgLimit(Math.max(5, Math.min(200, Number(e.target.value || 25))))}
              />
            </div>

            <div className="flex items-end gap-2">
              <Button onClick={() => loadOrgs('reset')} disabled={!api || orgsLoading}>
                {orgsLoading ? 'Cargando…' : 'Cargar'}
              </Button>
              <Button onClick={() => loadOrgs('next')} disabled={!api || orgsLoading || !orgHasMore}>
                Más
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="inactive"
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            <Label htmlFor="inactive">Incluir inactivas</Label>
          </div>

          <div className="text-sm text-muted-foreground">
            {orgs.length === 0 ? 'Sin datos.' : `Mostrando ${orgs.length} organizaciones.`}
          </div>

          {orgs.length > 0 ? (
            <div className="overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="p-2">orgId</th>
                    <th className="p-2">name</th>
                    <th className="p-2">active</th>
                    <th className="p-2">acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id} className="border-t">
                      <td className="p-2 font-medium">{o.id}</td>
                      <td className="p-2 text-muted-foreground">{o.name ?? ''}</td>
                      <td className="p-2">{o.isActive === false ? 'false' : 'true'}</td>
                      <td className="p-2">
                        <Button
                          size="sm"
                          variant={selectedOrgId === o.id ? 'default' : 'outline'}
                          onClick={() => {
                            setSelectedOrgId(o.id);
                            setTargetOrgId(o.id);
                            setSummary(null);
                            setMembers([]);
                            setMemberQ('');
                            setMemberCursorEmail(null);
                            setMemberCursorUid(null);
                            setMemberHasMore(false);
                            setDangerConfirm('');
                          }}
                        >
                          Seleccionar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ORG DETAIL */}
      {selectedOrgId ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Organización seleccionada: {selectedOrgId}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Button onClick={loadSummary} disabled={!api || summaryLoading}>
                  {summaryLoading ? 'Cargando…' : 'Ver resumen'}
                </Button>
                <Button onClick={() => loadMembers('reset')} disabled={!api || membersLoading}>
                  {membersLoading ? 'Cargando…' : 'Ver usuarios'}
                </Button>
              </div>

              {summary ? (
                <div className="text-sm">
                  <div className="font-medium">Resumen</div>
                  <div className="grid gap-1 mt-2">
                    {Object.entries(summary).map(([k, v]) => (
                      <div key={k} className="flex justify-between border rounded px-3 py-2">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-medium">{String(v ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Sin resumen (aún).</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usuarios en organización</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Label>Búsqueda (prefijo email)</Label>
                  <Input value={memberQ} onChange={(e) => setMemberQ(e.target.value)} placeholder="a, fran, ..." />
                </div>
                <div>
                  <Label>Límite</Label>
                  <Input
                    type="number"
                    value={memberLimit}
                    onChange={(e) => setMemberLimit(Math.max(5, Math.min(200, Number(e.target.value || 25))))}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={() => loadMembers('reset')} disabled={!api || membersLoading}>
                    Buscar
                  </Button>
                  <Button onClick={() => loadMembers('next')} disabled={!api || membersLoading || !memberHasMore}>
                    Más
                  </Button>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">Org: {selectedOrgId}</div>

              {members.length > 0 ? (
                <div className="overflow-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left">
                        <th className="p-2">email</th>
                        <th className="p-2">uid</th>
                        <th className="p-2">displayName</th>
                        <th className="p-2">active</th>
                        <th className="p-2">role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.uid} className="border-t">
                          <td className="p-2">{m.email ?? ''}</td>
                          <td className="p-2 font-mono text-xs">{m.uid}</td>
                          <td className="p-2">{m.displayName ?? ''}</td>
                          <td className="p-2">{m.active === false ? 'false' : 'true'}</td>
                          <td className="p-2">{m.role ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Sin usuarios (o aún no cargados).</div>
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
                <Input value={emailToMove} onChange={(e) => setEmailToMove(e.target.value)} placeholder="usuario@empresa.com" />
              </div>

              <div className="grid gap-2">
                <Label>organizationId destino</Label>
                <Input value={targetOrgId} onChange={(e) => setTargetOrgId(e.target.value)} placeholder="default" />
              </div>

              <div className="grid gap-2">
                <Label>Rol (en esa organización)</Label>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" type="button" disabled>
                    root (claim)
                  </Button>
                  {ROLE_OPTIONS.map((r) => (
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
                  Nota: <b>root</b> es un custom claim y no se asigna como role en org.
                </div>
              </div>

              <Button onClick={moveUser} disabled={!emailToMove.trim() || !targetOrgId.trim() || moving || !api}>
                {moving ? 'Aplicando…' : 'Aplicar'}
              </Button>

              <div className="text-xs text-muted-foreground">
                Esto crea/actualiza: users/{'{uid}'} (organizationId, role), memberships (uid_orgId) y organizations/{'{orgId}'}/members/{'{uid}'}.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zona peligrosa</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Para acciones destructivas, escribe exactamente el <b>organizationId</b>: {selectedOrgId}
              </div>
              <Input value={dangerConfirm} onChange={(e) => setDangerConfirm(e.target.value)} placeholder={selectedOrgId} />

              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" disabled={!canDanger} onClick={() => deactivateOrg(false)}>
                  Desactivar organización
                </Button>
                <Button variant="outline" disabled={!canDanger} onClick={() => deactivateOrg(true)}>
                  Activar organización
                </Button>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" disabled={!canDanger} onClick={() => purge('tickets')}>
                  Purgar tickets
                </Button>
                <Button variant="outline" disabled={!canDanger} onClick={() => purge('tasks')}>
                  Purgar tasks
                </Button>
                <Button variant="outline" disabled={!canDanger} onClick={() => purge('sites')}>
                  Purgar sites
                </Button>
                <Button variant="outline" disabled={!canDanger} onClick={() => purge('assets')}>
                  Purgar assets
                </Button>
                <Button variant="outline" disabled={!canDanger} onClick={() => purge('departments')}>
                  Purgar departments
                </Button>
              </div>

              <div className="pt-2">
                <Button variant="destructive" disabled={!canDanger} onClick={deleteScaffold}>
                  Scaffold delete org
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                Recomendación: desactiva antes de borrar. “Purgar” elimina docs con organizationId = org. “Scaffold delete”
                elimina organizations/{'{orgId}'} y organizationsPublic/{'{orgId}'}.
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
