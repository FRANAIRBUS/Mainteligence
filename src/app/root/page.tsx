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
import { Textarea } from '@/components/ui/textarea';

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

type BetaRequestRow = {
  id: string;
  status: string;
  fullName?: string | null;
  companyName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  sector?: string | null;
  sitesCount?: number | null;
  currentTools?: string | null;
  mainPain?: string | null;
  canUseReal2to4Weeks?: boolean;
  wantsDemo?: boolean;
  reviewedBy?: string | null;
  reviewedAtMs?: number | null;
  notes?: string | null;
  createdAccount?: boolean;
  createdOrgId?: string | null;
  createdUserId?: string | null;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
};

const ROLE_OPTIONS = [
  'super_admin',
  'admin',
  'mantenimiento',
  'jefe_departamento',
  'jefe_ubicacion',
  'operario',
  'auditor',
] as const;

const PLAN_OPTIONS = ['free', 'basic', 'starter', 'pro', 'enterprise'] as const;
const ENTITLEMENT_STATUS_OPTIONS = ['trialing', 'active', 'past_due', 'canceled'] as const;
const ORG_STATUS_OPTIONS = ['active', 'suspended', 'deleted'] as const;

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

  const api = useMemo(() => {
    if (!fn) return null;
    return {
      getPublicAppConfig: httpsCallable(fn, 'getPublicAppConfig'),
      rootSetPublicAppConfig: httpsCallable(fn, 'rootSetPublicAppConfig'),
      rootListBetaRequests: httpsCallable(fn, 'rootListBetaRequests'),
      rootUpdateBetaRequest: httpsCallable(fn, 'rootUpdateBetaRequest'),
      rootCreateAccountFromBetaRequest: httpsCallable(fn, 'rootCreateAccountFromBetaRequest'),
      rootListOrganizations: httpsCallable(fn, 'rootListOrganizations'),
      rootOrgSummary: httpsCallable(fn, 'rootOrgSummary'),
      rootListUsersByOrg: httpsCallable(fn, 'rootListUsersByOrg'),
      rootUpsertUserToOrganization: httpsCallable(fn, 'rootUpsertUserToOrganization'),
      rootDeactivateOrganization: httpsCallable(fn, 'rootDeactivateOrganization'),
      rootSetOrganizationPlan: httpsCallable(fn, 'rootSetOrganizationPlan'),
      rootPurgeOrganizationCollection: httpsCallable(fn, 'rootPurgeOrganizationCollection'),
      rootDeleteOrganizationScaffold: httpsCallable(fn, 'rootDeleteOrganizationScaffold'),
    };
  }, [fn]);



  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // CLOSED BETA
  const [betaClosed, setBetaClosed] = useState(false);
  const [betaConfigLoading, setBetaConfigLoading] = useState(false);

  // BETA REQUESTS
  const [betaRequests, setBetaRequests] = useState<BetaRequestRow[]>([]);
  const [betaRequestsLoading, setBetaRequestsLoading] = useState(false);
  const [betaLimit, setBetaLimit] = useState(50);
  const [betaCursorCreatedAtMs, setBetaCursorCreatedAtMs] = useState<number | null>(null);
  const [betaCursorId, setBetaCursorId] = useState<string | null>(null);
  const [betaHasMore, setBetaHasMore] = useState(false);
  const [betaStatusFilter, setBetaStatusFilter] = useState<string>('all');
  const [betaSearch, setBetaSearch] = useState('');
  const [selectedBeta, setSelectedBeta] = useState<BetaRequestRow | null>(null);
  const [betaEditStatus, setBetaEditStatus] = useState<string>('reviewing');
  const [betaEditNotes, setBetaEditNotes] = useState('');
  const [betaSaving, setBetaSaving] = useState(false);

  const [createOrgId, setCreateOrgId] = useState('');
  const [createOrgName, setCreateOrgName] = useState('');
  const [createRole, setCreateRole] = useState('admin');
  const [createSendInvite, setCreateSendInvite] = useState(true);
  const [creatingAccount, setCreatingAccount] = useState(false);

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

  // PLAN / STATUS
  const [planId, setPlanId] = useState<(typeof PLAN_OPTIONS)[number]>('free');
  const [entitlementStatus, setEntitlementStatus] = useState<(typeof ENTITLEMENT_STATUS_OPTIONS)[number]>('active');
  const [organizationStatus, setOrganizationStatus] = useState<(typeof ORG_STATUS_OPTIONS)[number]>('active');
  const [planReason, setPlanReason] = useState('');
  const [planApplying, setPlanApplying] = useState(false);

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

  useEffect(() => {
    if (!api || loading || !user || !isRoot) return;
    void loadPublicConfig();
  }, [api, isRoot, loading, user]);

  const handleSignOut = async () => {
    try {
      if (auth) await signOut(auth);
    } finally {
      router.replace('/login');
      router.refresh();
    }
  };

  const loadPublicConfig = async () => {
    if (!api) return;
    setBetaConfigLoading(true);
    try {
      const res = await api.getPublicAppConfig({});
      const data = res?.data as any;
      setBetaClosed(Boolean(data?.betaClosed ?? false));
    } catch {
      // non-blocking
    } finally {
      setBetaConfigLoading(false);
    }
  };

  const setBetaMode = async (closed: boolean) => {
    if (!api) return;
    setBetaConfigLoading(true);
    setError(null);
    try {
      const res = await api.rootSetPublicAppConfig({ betaClosed: closed });
      const data = res?.data as any;
      setBetaClosed(Boolean(data?.betaClosed ?? closed));
      setSuccess('Configuración de beta actualizada.');
    } catch (e: any) {
      setSuccess(null);
      setError(e?.message ?? 'Error actualizando beta.');
    } finally {
      setBetaConfigLoading(false);
    }
  };

  const loadBetaRequests = async (mode: 'reset' | 'next' = 'reset') => {
    if (!api) return;
    setBetaRequestsLoading(true);
    setError(null);
    try {
      const payload: any = { limit: betaLimit };
      if (mode === 'next' && betaCursorCreatedAtMs && betaCursorId) {
        payload.cursorCreatedAtMs = betaCursorCreatedAtMs;
        payload.cursorId = betaCursorId;
      }
      const res = await api.rootListBetaRequests(payload);
      const data = res?.data as any;
      const rows = (data?.requests ?? []) as BetaRequestRow[];

      if (mode === 'reset') {
        setBetaRequests(rows);
      } else {
        setBetaRequests((prev) => [...prev, ...rows]);
      }

      const nextMs = (data?.nextCursorCreatedAtMs ?? null) as number | null;
      const nextId = (data?.nextCursorId ?? null) as string | null;
      setBetaCursorCreatedAtMs(nextMs);
      setBetaCursorId(nextId);
      setBetaHasMore(Boolean(nextMs && nextId));
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando solicitudes beta');
    } finally {
      setBetaRequestsLoading(false);
    }
  };

  const selectBeta = (row: BetaRequestRow) => {
    setSelectedBeta(row);
    setBetaEditStatus(String(row.status ?? 'reviewing'));
    setBetaEditNotes(String(row.notes ?? ''));

    const guess = String(row.companyName ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '');
    setCreateOrgId(guess);
    setCreateOrgName(String(row.companyName ?? '').trim());
    setCreateRole('admin');
    setCreateSendInvite(true);
  };

  const saveBetaStatus = async () => {
    if (!api || !selectedBeta) return;
    setBetaSaving(true);
    setError(null);
    try {
      await api.rootUpdateBetaRequest({
        requestId: selectedBeta.id,
        status: betaEditStatus,
        notes: betaEditNotes,
      });

      setBetaRequests((prev) =>
        prev.map((r) => (r.id === selectedBeta.id ? { ...r, status: betaEditStatus, notes: betaEditNotes } : r)),
      );
      setSelectedBeta((prev) => (prev ? { ...prev, status: betaEditStatus, notes: betaEditNotes } : prev));
      setSuccess('Solicitud actualizada.');
    } catch (e: any) {
      setSuccess(null);
      setError(e?.message ?? 'Error actualizando solicitud');
    } finally {
      setBetaSaving(false);
    }
  };

  const createAccountFromBeta = async () => {
    if (!api || !selectedBeta) return;
    setCreatingAccount(true);
    setError(null);
    try {
      const res = await api.rootCreateAccountFromBetaRequest({
        requestId: selectedBeta.id,
        organizationId: createOrgId,
        organizationName: createOrgName,
        role: createRole,
        sendInvite: createSendInvite,
      });
      const data = res?.data as any;
      setSuccess(`Organización creada: ${data?.organizationId ?? createOrgId}. Invitación enviada.`);

      setBetaRequests((prev) =>
        prev.map((r) =>
          r.id === selectedBeta.id
            ? { ...r, status: 'accepted', createdAccount: true, createdOrgId: data?.organizationId ?? createOrgId }
            : r,
        ),
      );
      setSelectedBeta((prev) =>
        prev ? { ...prev, status: 'accepted', createdAccount: true, createdOrgId: data?.organizationId ?? createOrgId } : prev,
      );
    } catch (e: any) {
      setSuccess(null);
      setError(e?.message ?? 'Error creando cuenta desde solicitud');
    } finally {
      setCreatingAccount(false);
    }
  };

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

  const applyPlanAndStatus = async () => {
    if (!api || !selectedOrgId) return;
    if (!planReason.trim()) {
      setError('reason es requerido para aplicar plan/estado.');
      return;
    }

    setError(null);
    setSuccess(null);
    setPlanApplying(true);
    try {
      await api.rootSetOrganizationPlan({
        organizationId: selectedOrgId,
        planId,
        entitlementStatus,
        organizationStatus,
        provider: 'manual',
        reason: planReason.trim(),
      });
      await loadOrgs('reset');
      await loadSummary();
      setPlanReason('');
      setSuccess('Plan y estado aplicados correctamente.');
    } catch (e: any) {
      setSuccess(null);
      setError(e?.message ?? 'Error aplicando plan/estado');
    } finally {
      setPlanApplying(false);
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
          {success ? <div className="text-sm text-emerald-700 pt-1">{success}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Modo beta cerrada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm text-muted-foreground">
              Estado:{' '}
              <span className="font-medium text-foreground">{betaClosed ? 'CERRADA' : 'ABIERTA'}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="betaClosed"
                type="checkbox"
                checked={betaClosed}
                onChange={(e) => setBetaMode(e.target.checked)}
                disabled={!api || betaConfigLoading}
              />
              <Label htmlFor="betaClosed">Activar beta cerrada</Label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadPublicConfig} disabled={!api || betaConfigLoading}>
              {betaConfigLoading ? 'Cargando…' : 'Refrescar'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Solicitudes de beta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <Label>Búsqueda (empresa/email/contacto)</Label>
              <Input value={betaSearch} onChange={(e) => setBetaSearch(e.target.value)} placeholder="fran, montes..." />
            </div>
            <div>
              <Label>Estado</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={betaStatusFilter}
                onChange={(e) => setBetaStatusFilter(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="new">new</option>
                <option value="reviewing">reviewing</option>
                <option value="waitlist">waitlist</option>
                <option value="accepted">accepted</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
            <div>
              <Label>Límite</Label>
              <Input
                type="number"
                value={betaLimit}
                onChange={(e) => setBetaLimit(Math.max(10, Math.min(200, Number(e.target.value || 50))))}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => loadBetaRequests('reset')} disabled={!api || betaRequestsLoading}>
                {betaRequestsLoading ? 'Cargando…' : 'Cargar'}
              </Button>
              <Button onClick={() => loadBetaRequests('next')} disabled={!api || betaRequestsLoading || !betaHasMore}>
                Más
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            {betaRequests.length === 0 ? 'Sin solicitudes.' : `Mostrando ${betaRequests.length} solicitudes.`}
          </div>

          {betaRequests.length > 0 ? (
            <div className="overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="p-2">fecha</th>
                    <th className="p-2">empresa</th>
                    <th className="p-2">contacto</th>
                    <th className="p-2">email</th>
                    <th className="p-2">sector</th>
                    <th className="p-2">estado</th>
                    <th className="p-2">acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {betaRequests
                    .filter((r) => {
                      if (betaStatusFilter !== 'all' && String(r.status) !== betaStatusFilter) return false;
                      const q = betaSearch.trim().toLowerCase();
                      if (!q) return true;
                      const hay = `${r.companyName ?? ''} ${r.fullName ?? ''} ${r.email ?? ''}`.toLowerCase();
                      return hay.includes(q);
                    })
                    .map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 text-muted-foreground">
                          {r.createdAtMs ? new Date(r.createdAtMs).toLocaleString('es-ES') : '—'}
                        </td>
                        <td className="p-2 font-medium">{r.companyName ?? '—'}</td>
                        <td className="p-2">{r.fullName ?? '—'}</td>
                        <td className="p-2 text-muted-foreground">{r.email ?? '—'}</td>
                        <td className="p-2 text-muted-foreground">{r.sector ?? '—'}</td>
                        <td className="p-2">
                          {String(r.status)}{r.createdAccount ? ' (creada)' : ''}
                        </td>
                        <td className="p-2">
                          <Button size="sm" variant={selectedBeta?.id === r.id ? 'default' : 'outline'} onClick={() => selectBeta(r)}>
                            Detalle
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {selectedBeta ? (
            <div className="border rounded-md p-4 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm text-muted-foreground">Solicitud</div>
                  <div className="font-medium">{selectedBeta.companyName ?? '—'}</div>
                  <div className="text-sm text-muted-foreground">{selectedBeta.fullName ?? '—'} · {selectedBeta.email ?? '—'}</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {selectedBeta.createdAtMs ? new Date(selectedBeta.createdAtMs).toLocaleString('es-ES') : '—'}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Estado</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={betaEditStatus}
                    onChange={(e) => setBetaEditStatus(e.target.value)}
                  >
                    <option value="new">new</option>
                    <option value="reviewing">reviewing</option>
                    <option value="waitlist">waitlist</option>
                    <option value="accepted">accepted</option>
                    <option value="rejected">rejected</option>
                  </select>
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <Input value={String(selectedBeta.phone ?? '')} disabled />
                </div>
                <div className="md:col-span-2">
                  <Label>Notas internas</Label>
                  <Textarea value={betaEditNotes} onChange={(e) => setBetaEditNotes(e.target.value)} rows={3} />
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <Button onClick={saveBetaStatus} disabled={!api || betaSaving}>
                    {betaSaving ? 'Guardando…' : 'Guardar'}
                  </Button>
                  <Button variant="outline" onClick={() => setSelectedBeta(null)}>
                    Cerrar
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="font-medium">Crear cuenta desde solicitud</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <Label>orgId</Label>
                    <Input value={createOrgId} onChange={(e) => setCreateOrgId(e.target.value)} placeholder="empresa" />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Nombre organización</Label>
                    <Input value={createOrgName} onChange={(e) => setCreateOrgName(e.target.value)} placeholder="Empresa S.L." />
                  </div>
                  <div>
                    <Label>Rol invitación</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={createRole}
                      onChange={(e) => setCreateRole(e.target.value)}
                    >
                      <option value="admin">admin</option>
                      <option value="super_admin">super_admin</option>
                      <option value="mantenimiento">mantenimiento</option>
                      <option value="operario">operario</option>
                      <option value="auditor">auditor</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2 md:col-span-2">
                    <input
                      id="sendInvite"
                      type="checkbox"
                      checked={createSendInvite}
                      onChange={(e) => setCreateSendInvite(e.target.checked)}
                    />
                    <Label htmlFor="sendInvite">Enviar email de invitación</Label>
                  </div>
                </div>

                <Button
                  onClick={createAccountFromBeta}
                  disabled={!api || creatingAccount || Boolean(selectedBeta.createdAccount) || betaEditStatus === 'rejected'}
                >
                  {selectedBeta.createdAccount
                    ? 'Ya creada'
                    : creatingAccount
                      ? 'Creando…'
                      : 'Crear organización + invitar'}
                </Button>
                {selectedBeta.createdOrgId ? (
                  <div className="text-sm text-muted-foreground">Org creada: {selectedBeta.createdOrgId}</div>
                ) : null}
              </div>
            </div>
          ) : null}
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
                            setSuccess(null);
                            setPlanReason('');
                            setPlanId('free');
                            setEntitlementStatus('active');
                            setOrganizationStatus('active');
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

              <div className="grid gap-3 rounded-md border p-3">
                <div className="text-sm font-medium">Plan y estado (ROOT)</div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="grid gap-2">
                    <Label>Plan (entitlement.planId)</Label>
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={planId}
                      onChange={(e) => setPlanId(e.target.value as (typeof PLAN_OPTIONS)[number])}
                    >
                      {PLAN_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-2">
                    <Label>Estado entitlement</Label>
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={entitlementStatus}
                      onChange={(e) => setEntitlementStatus(e.target.value as (typeof ENTITLEMENT_STATUS_OPTIONS)[number])}
                    >
                      {ENTITLEMENT_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-2">
                    <Label>Estado organización</Label>
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={organizationStatus}
                      onChange={(e) => setOrganizationStatus(e.target.value as (typeof ORG_STATUS_OPTIONS)[number])}
                    >
                      {ORG_STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Reason (auditoría obligatoria)</Label>
                  <Input
                    value={planReason}
                    onChange={(e) => setPlanReason(e.target.value)}
                    placeholder="Ej: upgrade comercial aprobado por soporte L2"
                  />
                </div>

                <div>
                  <Button
                    onClick={applyPlanAndStatus}
                    disabled={!canDanger || !planReason.trim() || planApplying}
                  >
                    {planApplying ? 'Aplicando plan/estado…' : 'Aplicar plan/estado'}
                  </Button>
                </div>
              </div>

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
