'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { AppShell } from '@/components/app-shell';
import { AddUserDialog } from '@/components/add-user-dialog';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirebaseApp, useFirestore, useUser } from '@/lib/firebase';
import type { Department, User } from '@/lib/firebase/models';

type Role = 'super_admin' | 'admin' | 'maintenance' | 'operator';
type OrgMemberRow = {
  id: string; // uid
  role?: Role;
  status?: 'active' | 'pending' | 'revoked';
  email?: string | null;
  displayName?: string | null;
  updatedAt?: any;
  createdAt?: any;
};

type JoinRequestRow = {
  id: string; // uid
  email?: string | null;
  displayName?: string | null;
  requestedRole?: Role | null;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: any;
  updatedAt?: any;
};

function normalizeRole(input: unknown): Role {
  const v = String(input ?? '').trim();
  if (v === 'super_admin' || v === 'admin' || v === 'maintenance' || v === 'operator') return v;
  return 'operator';
}

function safeText(v: unknown): string {
  const s = String(v ?? '').trim();
  return s || '-';
}

function getInitials(name?: string | null): string {
  if (!name) return 'US';
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return 'US';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function UsersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const db = useFirestore();
  const app = useFirebaseApp();

  const { user, organizationId, isRoot, isSuperAdmin, loading: userLoading } = useUser();
  const canManage = Boolean(isRoot || isSuperAdmin);

  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersLoadingMore, setMembersLoadingMore] = useState(false);
  const [membersCursor, setMembersCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [membersHasMore, setMembersHasMore] = useState(false);

  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([]);
  const [joinLoading, setJoinLoading] = useState(true);
  const [joinLoadingMore, setJoinLoadingMore] = useState(false);
  const [joinCursor, setJoinCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [joinHasMore, setJoinHasMore] = useState(false);
  const { data: users = [], loading: usersLoading } = useCollection<User>(canManage ? 'users' : null);
  const { data: departments = [] } = useCollection<Department>(canManage ? 'departments' : null);

  const membersPageSize = 50;
  const joinRequestsPageSize = 50;

  const [addOpen, setAddOpen] = useState(false);
  // Per-request role selection (approve as role)
  const [approveRoleByUid, setApproveRoleByUid] = useState<Record<string, Role>>({});

  // Dialog state
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<JoinRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!userLoading && user && !organizationId && !isRoot) {
      router.replace('/onboarding');
    }
  }, [userLoading, user, organizationId, isRoot, router]);

  // Subscribe: members (organizations/{orgId}/members)
  useEffect(() => {
    if (userLoading) return;
    if (!user || !organizationId) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }
    if (!canManage) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }

    setMembersLoading(true);
    const colRef = collection(db, 'organizations', organizationId, 'members');
    const baseQuery = query(colRef, orderBy('displayName', 'asc'), orderBy('email', 'asc'), limit(membersPageSize));

    const unsub = onSnapshot(
      baseQuery,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as DocumentData;
          return {
            id: d.id,
            role: normalizeRole(data?.role),
            status: String(data?.status ?? 'active') as any,
            email: (data?.email ?? null) as any,
            displayName: (data?.displayName ?? null) as any,
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
          } satisfies OrgMemberRow;
        });

        setMembers(rows);
        setMembersLoading(false);
        setMembersCursor(snap.docs[snap.docs.length - 1] ?? null);
        setMembersHasMore(snap.size === membersPageSize);
      },
      (err) => {
        console.error('Error loading org members:', err);
        setMembers([]);
        setMembersLoading(false);
        setMembersCursor(null);
        setMembersHasMore(false);
      }
    );

    return () => unsub();
  }, [db, userLoading, user, organizationId, canManage]);

  const loadMoreMembers = async () => {
    if (!organizationId || !membersCursor || membersLoadingMore) return;
    setMembersLoadingMore(true);
    try {
      const colRef = collection(db, 'organizations', organizationId, 'members');
      const nextQuery = query(
        colRef,
        orderBy('displayName', 'asc'),
        orderBy('email', 'asc'),
        startAfter(membersCursor),
        limit(membersPageSize)
      );
      const snap = await getDocs(nextQuery);
      const nextRows = snap.docs.map((d) => {
        const data = d.data() as DocumentData;
        return {
          id: d.id,
          role: normalizeRole(data?.role),
          status: String(data?.status ?? 'active') as any,
          email: (data?.email ?? null) as any,
          displayName: (data?.displayName ?? null) as any,
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        } satisfies OrgMemberRow;
      });
      setMembers((prev) => {
        const existing = new Set(prev.map((row) => row.id));
        const merged = [...prev];
        for (const row of nextRows) {
          if (!existing.has(row.id)) merged.push(row);
        }
        return merged;
      });
      setMembersCursor(snap.docs[snap.docs.length - 1] ?? membersCursor);
      setMembersHasMore(snap.size === membersPageSize);
    } catch (err) {
      console.error('Error loading more members:', err);
      setMembersHasMore(false);
    } finally {
      setMembersLoadingMore(false);
    }
  };

  // Subscribe: joinRequests (organizations/{orgId}/joinRequests)
  useEffect(() => {
    if (userLoading) return;
    if (!user || !organizationId) {
      setJoinRequests([]);
      setJoinLoading(false);
      return;
    }
    if (!canManage) {
      setJoinRequests([]);
      setJoinLoading(false);
      return;
    }

    setJoinLoading(true);
    const colRef = collection(db, 'organizations', organizationId, 'joinRequests');
    const baseQuery = query(colRef, orderBy('createdAt', 'desc'), limit(joinRequestsPageSize));

    const unsub = onSnapshot(
      baseQuery,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as DocumentData;
          const row: JoinRequestRow = {
            id: d.id,
            email: (data?.email ?? null) as any,
            displayName: (data?.displayName ?? null) as any,
            requestedRole: data?.requestedRole ? normalizeRole(data?.requestedRole) : null,
            status: String(data?.status ?? 'pending') as any,
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
          };
          return row;
        });

        setJoinRequests(rows);
        setJoinCursor(snap.docs[snap.docs.length - 1] ?? null);
        setJoinHasMore(snap.size === joinRequestsPageSize);

        // Seed approveRoleByUid with requestedRole (or operator)
        setApproveRoleByUid((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            if (!next[r.id]) next[r.id] = r.requestedRole ?? 'operator';
          }
          return next;
        });

        setJoinLoading(false);
      },
      (err) => {
        console.error('Error loading join requests:', err);
        setJoinRequests([]);
        setJoinLoading(false);
        setJoinCursor(null);
        setJoinHasMore(false);
      }
    );

    return () => unsub();
  }, [db, userLoading, user, organizationId, canManage]);

  const loadMoreJoinRequests = async () => {
    if (!organizationId || !joinCursor || joinLoadingMore) return;
    setJoinLoadingMore(true);
    try {
      const colRef = collection(db, 'organizations', organizationId, 'joinRequests');
      const nextQuery = query(
        colRef,
        orderBy('createdAt', 'desc'),
        startAfter(joinCursor),
        limit(joinRequestsPageSize)
      );
      const snap = await getDocs(nextQuery);
      const nextRows = snap.docs.map((d) => {
        const data = d.data() as DocumentData;
        const row: JoinRequestRow = {
          id: d.id,
          email: (data?.email ?? null) as any,
          displayName: (data?.displayName ?? null) as any,
          requestedRole: data?.requestedRole ? normalizeRole(data?.requestedRole) : null,
          status: String(data?.status ?? 'pending') as any,
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        };
        return row;
      });
      setJoinRequests((prev) => {
        const existing = new Set(prev.map((row) => row.id));
        const merged = [...prev];
        for (const row of nextRows) {
          if (!existing.has(row.id)) merged.push(row);
        }
        return merged;
      });
      setApproveRoleByUid((prev) => {
        const next = { ...prev };
        for (const r of nextRows) {
          if (!next[r.id]) next[r.id] = r.requestedRole ?? 'operator';
        }
        return next;
      });
      setJoinCursor(snap.docs[snap.docs.length - 1] ?? joinCursor);
      setJoinHasMore(snap.size === joinRequestsPageSize);
    } catch (err) {
      console.error('Error loading more join requests:', err);
      setJoinHasMore(false);
    } finally {
      setJoinLoadingMore(false);
    }
  };

  const pendingRequests = useMemo(
    () => joinRequests.filter((r) => (r.status ?? 'pending') === 'pending'),
    [joinRequests]
  );

  const activeMembers = useMemo(
    () => members.filter((m) => (m.status ?? 'active') === 'active'),
    [members]
  );
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const departmentsById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  const openApprove = (req: JoinRequestRow) => {
    setSelectedRequest(req);
    setApproveOpen(true);
  };

  const openReject = (req: JoinRequestRow) => {
    setSelectedRequest(req);
    setRejectReason('');
    setRejectOpen(true);
  };

  const doApprove = async () => {
    if (!organizationId || !selectedRequest) return;

    const role = approveRoleByUid[selectedRequest.id] ?? (selectedRequest.requestedRole ?? 'operator');

    try {
      const fn = httpsCallable(getFunctions(app), 'orgApproveJoinRequest');
      await fn({ organizationId, uid: selectedRequest.id, role });

      toast({
        title: 'Solicitud aprobada',
        description: `${safeText(selectedRequest.email)} añadido como ${role}.`,
      });

      setApproveOpen(false);
      setSelectedRequest(null);
    } catch (err: any) {
      console.error('Approve failed:', err);
      toast({
        title: 'Error aprobando solicitud',
        description: err?.message ?? 'No se pudo aprobar la solicitud.',
        variant: 'destructive',
      });
    }
  };

  const doReject = async () => {
    if (!organizationId || !selectedRequest) return;

    try {
      const fn = httpsCallable(getFunctions(app), 'orgRejectJoinRequest');
      await fn({
        organizationId,
        uid: selectedRequest.id,
        reason: rejectReason.trim() || null,
      });

      toast({
        title: 'Solicitud rechazada',
        description: `${safeText(selectedRequest.email)} ha sido rechazada.`,
      });

      setRejectOpen(false);
      setSelectedRequest(null);
      setRejectReason('');
    } catch (err: any) {
      console.error('Reject failed:', err);
      toast({
        title: 'Error rechazando solicitud',
        description: err?.message ?? 'No se pudo rechazar la solicitud.',
        variant: 'destructive',
      });
    }
  };

  if (userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Cargando…</div>
      </div>
    );
  }

  if (!user) {
    router.replace('/login');
    return null;
  }

  return (
    <AppShell
      title="Usuarios y roles"
      description="Gestiona miembros y solicitudes de acceso de la organización activa."
    >
      <div className="flex flex-1 flex-col gap-4 lg:gap-6">
        {!organizationId && !isRoot && (
          <Card className="border-white/60 bg-sky-400/15">
            <CardHeader>
              <CardTitle>Sin organización activa</CardTitle>
              <CardDescription>
                No tienes una organización activa seleccionada. Ve a onboarding o cambia de organización.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => router.push('/onboarding')}>Ir a onboarding</Button>
            </CardContent>
          </Card>
        )}

        {organizationId && !canManage && (
          <Card className="border-white/60 bg-sky-400/15">
            <CardHeader>
              <CardTitle>Permisos insuficientes</CardTitle>
              <CardDescription>
                Esta sección está reservada a super_admin (o root). Si has solicitado acceso, espera a que lo aprueben.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {organizationId && canManage && (
          <Tabs defaultValue="requests" className="w-full">
            <TabsList>
              <TabsTrigger value="requests">
                Solicitudes <span className="ml-2 text-xs text-muted-foreground">({pendingRequests.length})</span>
              </TabsTrigger>
              <TabsTrigger value="members">
                Miembros <span className="ml-2 text-xs text-muted-foreground">({activeMembers.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="requests" className="mt-4">
              <Card className="border-white/60 bg-sky-400/15">
                <CardHeader>
                  <CardTitle>Solicitudes pendientes</CardTitle>
                  <CardDescription>
                    Aprueba o rechaza peticiones para unirse a esta organización. La aprobación crea/activa la membresía.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {joinLoading ? (
                    <div className="text-sm text-muted-foreground">Cargando solicitudes…</div>
                  ) : pendingRequests.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No hay solicitudes pendientes.</div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {pendingRequests.map((r) => (
                        <div key={r.id} className="rounded-lg border border-white/20 bg-background p-4 shadow-sm">
                          <div className="space-y-3">
                            <div>
                              <p className="text-base font-semibold">{safeText(r.displayName)}</p>
                              <p className="text-sm text-muted-foreground">{safeText(r.email)}</p>
                            </div>
                            <div className="space-y-2">
                              <Select
                                value={approveRoleByUid[r.id] ?? (r.requestedRole ?? 'operator')}
                                onValueChange={(v) =>
                                  setApproveRoleByUid((prev) => ({ ...prev, [r.id]: normalizeRole(v) }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Rol" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="operator">operator</SelectItem>
                                  <SelectItem value="maintenance">maintenance</SelectItem>
                                  <SelectItem value="admin">admin</SelectItem>
                                  <SelectItem value="super_admin">super_admin</SelectItem>
                                </SelectContent>
                              </Select>
                              {r.requestedRole && (
                                <div className="text-xs text-muted-foreground">
                                  Solicitado: {r.requestedRole}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => openApprove(r)}>
                                Aprobar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openReject(r)}>
                                Rechazar
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!joinLoading && joinHasMore && (
                    <div className="mt-4 flex justify-center">
                      <Button size="sm" variant="outline" onClick={loadMoreJoinRequests} disabled={joinLoadingMore}>
                        {joinLoadingMore ? 'Cargando…' : 'Cargar más'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="members" className="mt-4">
              <Card className="border-white/60 bg-sky-400/15">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Miembros de la organización</CardTitle>
                    <CardDescription>
                      Pulsa un miembro para editar su rol, datos y departamento. La gestión de roles se aplica con Cloud Function.
                    </CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    Invitar usuario
                  </Button>
                </CardHeader>
                <CardContent>
                  {membersLoading ? (
                    <div className="text-sm text-muted-foreground">Cargando miembros…</div>
                  ) : activeMembers.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No hay miembros activos.</div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {activeMembers.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="rounded-lg border border-white/20 bg-background p-4 text-left shadow-sm transition hover:border-white/40"
                          onClick={() => router.push(`/users/${m.id}`)}
                          disabled={usersLoading && !usersById.get(m.id)}
                        >
                          <div className="space-y-3">
                            <div className="flex items-start gap-3">
                              <Avatar className="h-10 w-10">
                                <AvatarImage
                                  src={usersById.get(m.id)?.avatarUrl ?? undefined}
                                  alt="Avatar de usuario"
                                />
                                <AvatarFallback>
                                  {getInitials(usersById.get(m.id)?.displayName ?? m.displayName)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-base font-semibold">
                                  {safeText(usersById.get(m.id)?.displayName ?? m.displayName)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {safeText(usersById.get(m.id)?.email ?? m.email)}
                                </p>
                                {usersById.get(m.id)?.departmentId ? (
                                  <p className="text-xs text-muted-foreground">
                                    Departamento:{' '}
                                    {safeText(departmentsById.get(usersById.get(m.id)?.departmentId ?? '')?.name)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline">{usersById.get(m.id)?.role ?? (m.role ?? 'operator')}</Badge>
                              <Badge variant={(m.status ?? 'active') === 'active' ? 'default' : 'secondary'}>
                                {m.status ?? 'active'}
                              </Badge>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {!membersLoading && membersHasMore && (
                    <div className="mt-4 flex justify-center">
                      <Button size="sm" variant="outline" onClick={loadMoreMembers} disabled={membersLoadingMore}>
                        {membersLoadingMore ? 'Cargando…' : 'Cargar más'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprobar solicitud</AlertDialogTitle>
            <AlertDialogDescription>
              Esto activará la membresía del usuario en la organización y le dará acceso según el rol seleccionado.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-3 py-2">
            <div className="text-sm">
              <span className="font-medium">Usuario:</span>{' '}
              {safeText(selectedRequest?.displayName)} ({safeText(selectedRequest?.email)})
            </div>

            <div className="grid gap-2">
              <Label>Rol a asignar</Label>
              <Select
                value={
                  selectedRequest
                    ? approveRoleByUid[selectedRequest.id] ?? (selectedRequest.requestedRole ?? 'operator')
                    : 'operator'
                }
                onValueChange={(v) => {
                  if (!selectedRequest) return;
                  setApproveRoleByUid((prev) => ({ ...prev, [selectedRequest.id]: normalizeRole(v) }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">operator</SelectItem>
                  <SelectItem value="maintenance">maintenance</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="super_admin">super_admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doApprove}>Aprobar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rechazar solicitud</AlertDialogTitle>
            <AlertDialogDescription>
              La solicitud se marcará como rechazada. Puedes indicar un motivo opcional.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-3 py-2">
            <div className="text-sm">
              <span className="font-medium">Usuario:</span>{' '}
              {safeText(selectedRequest?.displayName)} ({safeText(selectedRequest?.email)})
            </div>

            <div className="grid gap-2">
              <Label htmlFor="rejectReason">Motivo (opcional)</Label>
              <Input
                id="rejectReason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Ej.: dominio no autorizado"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doReject}>Rechazar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} departments={departments} />
    </AppShell>
  );
}
