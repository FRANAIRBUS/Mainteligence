'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser } from '@/lib/firebase/auth/use-user';
import { signOut } from 'firebase/auth';
import { useAuth, useFirebaseApp } from '@/lib/firebase/provider';
import { getFunctions, httpsCallable } from 'firebase/functions';

export default function OnboardingPage() {
  const router = useRouter();
  const auth = useAuth();
  const app = useFirebaseApp();
  const { user, profile, memberships, organizationId, activeMembership, loading, isRoot } = useUser();
  const [finalizeAttempted, setFinalizeAttempted] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizeLoading, setFinalizeLoading] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/login');
    if (isRoot) router.push('/root');
  }, [user, loading, router, isRoot]);

  const attemptFinalize = async () => {
    if (!app || !auth?.currentUser) return;
    setFinalizeError(null);
    setFinalizeLoading(true);
    try {
      await auth.currentUser.reload();
      if (!auth.currentUser.emailVerified) {
        setFinalizeError('El correo todavía no está verificado.');
        return;
      }
      const fn = httpsCallable(getFunctions(app, 'us-central1'), 'finalizeOrganizationSignup');
      await fn({});
      router.refresh();
    } catch (err: any) {
      setFinalizeError(err?.message || 'No se pudo completar el alta. Intenta de nuevo.');
    } finally {
      setFinalizeLoading(false);
    }
  };

  useEffect(() => {
    if (!app || !auth || !user || profile || finalizeAttempted) return;

    setFinalizeAttempted(true);
    void attemptFinalize();
  }, [app, auth, user, profile, finalizeAttempted]);

  const pending = activeMembership && activeMembership.status !== 'active';

  const doLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.push('/login');
  };

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Acceso a la organización</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!user && <p>Redirigiendo a login…</p>}

            {user && !profile && (
              <>
                <p className="text-muted-foreground">
                  Tu cuenta está autenticada, pero todavía no has completado el alta de organización.
                </p>
                {finalizeError && <p className="text-sm text-destructive">{finalizeError}</p>}
                <div className="flex gap-3">
                  <Button onClick={() => router.push('/login')}>Volver a registro</Button>
                  <Button onClick={attemptFinalize} disabled={finalizeLoading}>
                    {finalizeLoading ? 'Validando…' : 'Reintentar validación'}
                  </Button>
                  <Button variant="outline" onClick={doLogout}>
                    Cerrar sesión
                  </Button>
                </div>
              </>
            )}

            {user && profile && pending && (
              <>
                <p className="text-muted-foreground">
                  Tu solicitud para unirte a la organización <b>{organizationId}</b> está pendiente de aprobación por un
                  administrador.
                </p>
                <p className="text-sm text-muted-foreground">
                  En cuanto un super administrador apruebe la solicitud, podrás acceder al sistema automáticamente.
                </p>
                <div className="flex gap-3">
                  <Button onClick={() => router.refresh()}>Actualizar</Button>
                  <Button variant="outline" onClick={doLogout}>
                    Cerrar sesión
                  </Button>
                </div>
              </>
            )}

            {user && profile && !pending && (!memberships || memberships.length === 0) && (
              <>
                <p className="text-muted-foreground">
                  No se ha encontrado ninguna membresía asociada a tu usuario. Regístrate con un ID de organización
                  válido o solicita acceso.
                </p>
                <div className="flex gap-3">
                  <Button onClick={() => router.push('/login')}>Ir a registro</Button>
                  <Button variant="outline" onClick={doLogout}>
                    Cerrar sesión
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
