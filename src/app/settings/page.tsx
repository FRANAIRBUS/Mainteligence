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
import { useUser, useFirestore, useStorage, useDoc } from '@/lib/firebase';
import type { User } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { DynamicClientLogo } from '@/components/dynamic-client-logo';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError, StoragePermissionError } from '@/lib/firebase/errors';
import Image from 'next/image';

interface AppSettings {
  logoUrl?: string;
  updatedAt?: any;
}

export default function SettingsPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();
  const storage = useStorage();
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : null);
  const isAdmin = userProfile?.role === 'admin';

  const { data: settings, loading: settingsLoading } = useDoc<AppSettings>('settings/app');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);
  
  useEffect(() => {
    if (selectedFile) {
      const objectUrl = URL.createObjectURL(selectedFile);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setPreviewUrl(null);
    }
  }, [selectedFile]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !storage || !firestore || !isAdmin) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se puede subir el logo. Asegúrate de ser administrador y de haber seleccionado un archivo.',
      });
      return;
    }

    setIsPending(true);
    
    const logoRef = ref(storage, 'branding/logo.png');
    const settingsRef = doc(firestore, 'settings', 'app');
    
    try {
      // Step 1: Upload to Storage
      const uploadResult = await uploadBytes(logoRef, selectedFile);
      
      // Step 2: Get Download URL
      const downloadURL = await getDownloadURL(uploadResult.ref);

      // Step 3: Save to Firestore
      const settingsData = { 
        logoUrl: downloadURL,
        updatedAt: serverTimestamp(),
      };
      await setDoc(settingsRef, settingsData, { merge: true });

      toast({
        title: 'Éxito',
        description: 'El logo se ha actualizado correctamente.',
      });
      setSelectedFile(null);
      // Force reload to ensure all components see the change.
      window.location.reload();

    } catch (error: any) {
      // Enhanced Error Handling
      if (error.code === 'storage/unauthorized') {
        const permissionError = new StoragePermissionError({
          path: logoRef.fullPath,
          operation: 'write',
        });
        errorEmitter.emit('permission-error', permissionError);
      } else if (error.code === 'permission-denied') {
        const permissionError = new FirestorePermissionError({
          path: settingsRef.path,
          operation: 'update',
          requestResourceData: { logoUrl: '...' }, // Don't log the full URL
        });
        errorEmitter.emit('permission-error', permissionError);
      } else {
        toast({
            variant: 'destructive',
            title: 'Error al subir el logo',
            description: error.message || 'Ocurrió un error inesperado.',
        });
      }
    } finally {
      setIsPending(false);
    }
  }

  const initialLoading = userLoading || profileLoading;

  if (initialLoading) {
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
            <DynamicClientLogo />
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
            {isAdmin ? (
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
                        {settingsLoading ? <Icons.spinner className='animate-spin' /> : <DynamicClientLogo width={64} height={64} className="bg-muted p-1" />}
                        <p className="text-sm text-muted-foreground">Este es el logo que se muestra en toda la aplicación.</p>
                    </div>
                    </div>
                     <div className="space-y-2">
                      <Label>Previsualización</Label>
                       <div className="flex items-center gap-4">
                         {previewUrl ? (
                           <Image src={previewUrl} alt="Previsualización del logo" width={64} height={64} className="bg-muted p-1 rounded-md" />
                         ) : (
                           <div className="flex h-[64px] w-[64px] items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                             Sin previsualización
                           </div>
                         )}
                         <p className="text-sm text-muted-foreground">Previsualización del nuevo logo seleccionado.</p>
                       </div>
                     </div>
                    <div className="space-y-2">
                    <Label htmlFor="logo-upload">Subir Nuevo Logo</Label>
                    <Input id="logo-upload" type="file" onChange={handleFileChange} accept="image/png, image/jpeg, image/gif, image/webp" />
                    {selectedFile && <p className="text-xs text-muted-foreground">Archivo seleccionado: {selectedFile.name}</p>}
                    </div>
                </CardContent>
                <CardFooter className="border-t px-6 py-4">
                    <Button onClick={handleUpload} disabled={isPending || !selectedFile}>
                    {isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Guardar Cambios
                    </Button>
                </CardFooter>
                </Card>
            ) : (
                 <Card className="border-destructive/50">
                    <CardHeader className="flex flex-row items-center gap-4">
                         <AlertTriangle className="h-8 w-8 text-destructive" />
                         <div>
                            <CardTitle>Acceso Denegado</CardTitle>
                            <CardDescription>
                                Solo los administradores pueden modificar los ajustes de la empresa.
                            </CardDescription>
                        </div>
                    </CardHeader>
                </Card>
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
