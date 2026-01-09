'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { EditUserForm } from '@/components/edit-user-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollection, useDoc, useUser } from '@/lib/firebase';
import type { Department, User } from '@/lib/firebase/models';

function normalizeParam(input: string | string[] | undefined): string {
  if (Array.isArray(input)) return input[0] ?? '';
  return input ?? '';
}

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams();
  const userId = normalizeParam(params?.userId);

  const { user, organizationId, isRoot, isSuperAdmin, loading: userLoading } = useUser();
  const canManage = Boolean(isRoot || isSuperAdmin);

  const { data: userProfile, loading: profileLoading } = useDoc<User>(userId ? `users/${userId}` : null);
  const { data: departments = [], loading: departmentsLoading } = useCollection<Department>(
    canManage ? 'departments' : null
  );

  const departmentName = useMemo(() => {
    if (!userProfile?.departmentId) return null;
    const department = departments.find((dept) => dept.id === userProfile.departmentId);
    return department?.name ?? null;
  }, [departments, userProfile]);

  useEffect(() => {
    if (!userLoading && user && !organizationId && !isRoot) {
      router.replace('/onboarding');
    }
  }, [userLoading, user, organizationId, isRoot, router]);

  if (userLoading || profileLoading || departmentsLoading) {
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
      title="Ficha de usuario"
      description="Edita rol, datos personales y departamento del miembro."
    >
      <div className="flex flex-1 flex-col gap-4 lg:gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={() => router.push('/users')}>
            Volver a usuarios
          </Button>
        </div>

        {!organizationId && !isRoot && (
          <Card className="border-white/60 bg-sky-400/15">
            <CardHeader>
              <CardTitle>Sin organización activa</CardTitle>
              <CardDescription>
                No tienes una organización activa seleccionada. Ve a onboarding o cambia de organización.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {organizationId && !canManage && (
          <Card className="border-white/60 bg-sky-400/15">
            <CardHeader>
              <CardTitle>Permisos insuficientes</CardTitle>
              <CardDescription>
                Solo super_admin (o root) puede editar miembros de la organización.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {organizationId && canManage && (
          <Card className="border-white/60 bg-sky-400/15">
            <CardHeader>
              <CardTitle>{userProfile?.displayName ?? 'Usuario'}</CardTitle>
              <CardDescription>
                {userProfile?.email ?? 'Sin correo'}{' '}
                {departmentName ? `· ${departmentName}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {userProfile ? (
                <EditUserForm user={userProfile} departments={departments} />
              ) : (
                <div className="text-sm text-muted-foreground">
                  No se encontró la ficha del usuario seleccionado.
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
