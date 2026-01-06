'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, type DocumentData } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import { DynamicClientLogo } from '@/components/dynamic-client-logo';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { useFirebaseApp, useFirestore, useUser } from '@/lib/firebase';

type Role = 'super_admin' | 'admin' | 'maintenance' | 'operator';
type JoinStatus = 'pending' | 'active' | 'revoked' | 'rejected' | 'approved';

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

export default function UsersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const db = useFirestore();
  const app = useFirebaseApp();

  const { user, organizationId, isRoot, isSuperAdmin, loading: userLoading } = useUser();

  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([]);
  const [joinLoading, setJoinLoading] = useState(true);

  // Per-request role selection (approve as role)
  const [approveRoleByUid, setApproveRoleByUid] = useState<Record<string, Role>>({});

  // Dialog state
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<JoinRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const canManage = Boolean(isRoot || isSuperAdmin);

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

    const unsub = onSnapshot(
      colRef,
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

        rows.sort((a, b) => safeText(a.displayName || a.email).localeCompare(safeText(b.displayName || b.email)));
        setMembers(rows);
        setMembersLoading(false);
      },
      (err) => {
        console.error('Error loading org members:', err);
        setMembers([]);
        setMembersLoading(false);
      }
    );

    return () => unsub();
  }, [db, userLoading, user, organizationId, canManage]);

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

    const unsub = onSnapshot(
      colRef,
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

        // Sort newest first if createdAt exists, otherwise by email
        rows.sort((a, b) => {
          const at = (a.createdAt?.toMillis?.() ?? 0) as number;
          const bt = (b.createdAt?.toMillis?.() ?? 0) as number;
          if (bt !== at) return bt - at;
          return safeText(a.email).localeCompare(safeText(b.email));
        });

        setJoinRequests(rows);

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
      }
    );

    return () => unsub();
  }, [db, userLoading, user, organizationId, canManage]);

  const pendingRequests = useMemo(
    () => joinRequests.filter((r) => (r.status ?? 'pending') === 'pending'),
    [joinRequests]
  );

  const activeMembers = useMemo(
    () => members.filter((m) => (m.status ?? 'active') === 'active'),
    [members]
  );

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
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
            <DynamicClientLogo />
          </div>
          <a href="/" className="flex flex-col items-center gap-2">
            <span className="text-xl font-headline font-semibold text-sidebar-foreground">Maintelligence</span>
          </a>
        </SidebarHeader>
        <SidebarContent>
          <MainNav />
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm lg:px-6">
          <SidebarTrigger className="md:hidden" />
          <div className="flex w-full items-center justify-end">
            <UserNav />
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
            <p className="text-sm text-muted-foreground">
              Gestiona miembros y solicitudes de acceso de la organización activa.
            </p>
          </div>

          {!organizationId && !isRoot && (
            <Card>
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
            <Card>
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
                <Card>
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
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Usuario</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Rol</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pendingRequests.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-medium">
                                {safeText(r.displayName)}
                                <div className="text-xs text-muted-foreground">uid: {r.id}</div>
                              </TableCell>
                              <TableCell>{safeText(r.email)}</TableCell>
                              <TableCell className="w-[220px]">
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
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    Solicitado: {r.requestedRole}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" onClick={() => openApprove(r)}>
                                    Aprobar
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => openReject(r)}>
                                    Rechazar
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="members" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Miembros de la organización</CardTitle>
                    <CardDescription>
                      Listado de miembros activos. La gestión avanzada (cambios de rol / bajas) se realiza por Cloud Function.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {membersLoading ? (
                      <div className="text-sm text-muted-foreground">Cargando miembros…</div>
                    ) : activeMembers.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No hay miembros activos.</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Usuario</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Rol</TableHead>
                            <TableHead>Estado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeMembers.map((m) => (
                            <TableRow key={m.id}>
                              <TableCell className="font-medium">
                                {safeText(m.displayName)}
                                <div className="text-xs text-muted-foreground">uid: {m.id}</div>
                              </TableCell>
                              <TableCell>{safeText(m.email)}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{m.role ?? 'operator'}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={(m.status ?? 'active') === 'active' ? 'default' : 'secondary'}>
                                  {m.status ?? 'active'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </main>

        {/* Approve dialog */}
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

        {/* Reject dialog */}
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
      </SidebarInset>
    </SidebarProvider>
  );
}
