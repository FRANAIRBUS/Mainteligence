"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SmartTaggingForm from '@/components/smart-tagging-form';
import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser } from '@/lib/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export default function SmartTaggingPage() {
  const { user, loading, isSuperAdmin } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <AppShell
      title="Asistente de Etiquetado Inteligente"
      description="Categoriza automáticamente tus tareas de mantenimiento. Ingresa una descripción para obtener etiquetas sugeridas por IA."
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        {isSuperAdmin ? (
          <div className="w-full">
            <SmartTaggingForm />
          </div>
        ) : (
          <Card className="border-destructive/50">
            <CardHeader className="flex flex-row items-center gap-4">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <div>
                <CardTitle>Acceso Denegado</CardTitle>
                <CardDescription>
                  Solo el super administrador puede acceder al asistente de etiquetado inteligente.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Contacta con un super administrador si necesitas acceder a esta sección.
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
