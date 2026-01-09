'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { LineChart } from 'lucide-react';

export default function ReportsPage() {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <AppShell
      title="Informes"
      description="Genera y visualiza informes detallados del mantenimiento."
    >
      <Card>
        <CardHeader>
          <CardTitle>Informes</CardTitle>
          <CardDescription className="mt-2">
            Genera y visualiza informes detallados del mantenimiento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 p-12 text-center">
            <div className="mb-4 rounded-full border border-dashed bg-muted p-4">
              <LineChart className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Funcionalidad en Desarrollo
            </h3>
            <p className="mt-2 text-muted-foreground">
              La sección de informes está en construcción. ¡Pronto podrás generar análisis y exportar tus datos!
            </p>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
