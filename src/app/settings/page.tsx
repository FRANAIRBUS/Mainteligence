'use client';

import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
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
  CardFooter,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';

export default function SettingsPage() {
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
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
              <Image src="/client-logo.png" alt="Logo del Cliente" width={80} height={80} className="rounded-md" />
            </div>
            <a href="/" className="flex flex-col items-center gap-2">
                <span className="text-xl font-headline font-semibold text-sidebar-foreground">
                Maintelligence
                </span>
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
        <main className="flex-1 p-4 sm:p-6 md:p-8">
           <div className="mx-auto max-w-2xl">
              <h1 className="font-headline text-3xl font-bold tracking-tight md:text-4xl mb-8">
                  Ajustes
              </h1>
              <Card>
                  <CardHeader>
                  <CardTitle>Ajustes de la Empresa</CardTitle>
                  <CardDescription>
                      Actualiza el logo y las preferencias de la aplicación.
                  </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                      <div className="space-y-2">
                        <Label>Logo Actual</Label>
                        <div className="flex items-center gap-4">
                           <Image src="/client-logo.png" alt="Logo actual" width={64} height={64} className="rounded-md bg-muted p-1"/>
                           <p className="text-sm text-muted-foreground">Este es el logo que se muestra en toda la aplicación.</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="logo-upload">Subir Nuevo Logo</Label>
                        <Input id="logo-upload" type="file" disabled />
                        <p className="text-xs text-muted-foreground">
                            Funcionalidad de subida no implementada todavía.
                        </p>
                      </div>
                  </CardContent>
                  <CardFooter className="border-t px-6 py-4">
                  <Button type="submit" disabled>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Guardar Cambios (No implementado)
                  </Button>
                  </CardFooter>
              </Card>
           </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
