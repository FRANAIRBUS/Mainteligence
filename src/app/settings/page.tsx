'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser, useFirestore, useStorage, useDoc, useFirebaseApp } from '@/lib/firebase';
import type { User } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  type UploadTask,
  type UploadTaskSnapshot,
} from 'firebase/storage';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { DynamicClientLogo } from '@/components/dynamic-client-logo';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError, StoragePermissionError } from '@/lib/firebase/errors';
import { ClientLogo } from '@/components/client-logo';
import { Progress } from '@/components/ui/progress';
import { DEFAULT_ORGANIZATION_ID, orgDocPath, orgStoragePath } from '@/lib/organization';
import { normalizeRole } from '@/lib/rbac';


interface AppSettings {
  logoUrl?: string;
  updatedAt?: any;
}

export default function SettingsPage() {
  const { user, loading: userLoading, organizationId, profile } = useUser();
  const router = useRouter();
  const app = useFirebaseApp();
  const storage = useStorage();
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : null);
  const normalizedRole = normalizeRole(userProfile?.role);
  const isSuperAdmin = normalizedRole === 'super_admin';

  const { data: settings, loading: settingsLoading } = useDoc<AppSettings>(
    resolvedOrganizationId ? orgDocPath(resolvedOrganizationId, 'settings', 'app') : null
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [orgStatus, setOrgStatus] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [orgStatusLoading, setOrgStatusLoading] = useState(false);
  const [orgStatusActionLoading, setOrgStatusActionLoading] = useState(false);
  const uploadUnsubscribe = useRef<(() => void) | null>(null);
  const uploadTaskRef = useRef<UploadTask | null>(null);
  const uploadStallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedOrganizationId =
    organizationId ?? profile?.organizationId ?? DEFAULT_ORGANIZATION_ID;

  const clearStallTimer = () => {
    if (uploadStallTimer.current) {
      clearTimeout(uploadStallTimer.current);
      uploadStallTimer.current = null;
    }
  };

  const resetUploadState = () => {
    setIsPending(false);
    setUploadProgress(0);
    clearStallTimer();
    if (uploadUnsubscribe.current) {
      uploadUnsubscribe.current();
      uploadUnsubscribe.current = null;
    }
    if (uploadTaskRef.current) {
      uploadTaskRef.current.cancel();
      uploadTaskRef.current = null;
    }
  };


  const handleUploadError = (error: any, logoRefPath: string, settingsRefPath: string) => {
    if (error.code === 'storage/unauthorized') {
      const permissionError = new StoragePermissionError({
        path: logoRefPath,
        operation: 'write',
      });
      toast({
        variant: 'destructive',
        title: 'Permisos insuficientes en Storage',
        description:
          'No se pudo subir el logo porque tu usuario no tiene permisos de escritura en Firebase Storage. Verifica las reglas y tus credenciales.',
      });
      errorEmitter.emit('permission-error', permissionError);
    } else if (error.code === 'permission-denied') {
      const permissionError = new FirestorePermissionError({
        path: settingsRefPath,
        operation: 'update',
        requestResourceData: { logoUrl: '...' },
      });
      toast({
        variant: 'destructive',
        title: 'Permisos insuficientes en Firestore',
        description:
          'No se pudo actualizar el logo en la configuración. Asegúrate de que tu usuario tenga rol de administrador en Firestore.',
      });
      errorEmitter.emit('permission-error', permissionError);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error al subir el logo',
        description: error.message || 'Ocurrió un error inesperado.',
      });
    }
  };


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

  useEffect(() => {
    return () => {
      resetUploadState();
    };
  }, []);

  useEffect(() => {
    if (!firestore || !resolvedOrganizationId) return;
    let cancelled = false;

    setOrgStatusLoading(true);
    getDoc(doc(firestore, 'organizationsPublic', resolvedOrganizationId))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.data() as { status?: string; name?: string } | undefined;
        setOrgStatus(data?.status ?? null);
        setOrgName(data?.name ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setOrgStatus(null);
      })
      .finally(() => {
        if (cancelled) return;
        setOrgStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [firestore, resolvedOrganizationId]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !storage || !firestore || !isSuperAdmin || !resolvedOrganizationId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se puede subir el logo. Asegúrate de ser super administrador, tener organizationId y de haber seleccionado un archivo.',
      });
      return;
    }

    setIsPending(true);
    setUploadProgress(0);

    const logoRef = ref(storage, orgStoragePath(resolvedOrganizationId, 'branding', 'logo.png'));
    const settingsRef = doc(firestore, orgDocPath(resolvedOrganizationId, 'settings', 'app'));
    if (uploadUnsubscribe.current) {
      uploadUnsubscribe.current();
      uploadUnsubscribe.current = null;
    }
    clearStallTimer();

    try {
      const uploadTask = uploadBytesResumable(logoRef, selectedFile, { contentType: selectedFile.type });
      uploadTaskRef.current = uploadTask;

      const uploadPromise = new Promise<UploadTaskSnapshot>((resolve, reject) => {
        uploadStallTimer.current = setTimeout(() => {
          uploadTask.cancel();
          reject(new Error('upload-timeout'));
        }, 15000);

        uploadUnsubscribe.current = uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadProgress(progress);
            if (uploadStallTimer.current) {
              clearTimeout(uploadStallTimer.current);
            }
            uploadStallTimer.current = setTimeout(() => {
              uploadTask.cancel();
              reject(new Error('upload-timeout'));
            }, 15000);
          },
          (error) => reject(error),
          () => resolve(uploadTask.snapshot)
        );
      });

      const uploadSnapshot = await uploadPromise;
      clearStallTimer();

      const downloadURL = await getDownloadURL(uploadSnapshot.ref);

      const settingsData = {
        logoUrl: downloadURL,
        organizationId: resolvedOrganizationId,
        updatedAt: serverTimestamp(),
      };
      await setDoc(settingsRef, settingsData, { merge: true });

      toast({
        title: 'Éxito',
        description: 'El logo se ha actualizado correctamente. La página se recargará.',
      });

      setSelectedFile(null);
      setPreviewUrl(null);

      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      if (error?.message === 'upload-timeout') {
        toast({
          variant: 'destructive',
          title: 'La subida está tardando demasiado',
          description: 'No se detectó progreso en la carga. Revisa tu conexión o permisos en Firebase Storage.',
        });
      } else {
        handleUploadError(error, logoRef.fullPath, settingsRef.path);
      }
    } finally {
      resetUploadState();
    }
  };

  const handleOrgStatusChange = async (nextStatus: 'active' | 'suspended') => {
    if (!app || !resolvedOrganizationId) return;

    const actionLabel = nextStatus === 'active' ? 'reactivar' : 'suspender';
    const confirm = window.confirm(`¿Seguro que quieres ${actionLabel} la organización?`);
    if (!confirm) return;

    setOrgStatusActionLoading(true);
    try {
      const fn = httpsCallable(getFunctions(app), 'orgSetOrganizationStatus');
      const res = await fn({ organizationId: resolvedOrganizationId, status: nextStatus });
      const payload = res?.data as { status?: string } | undefined;
      setOrgStatus(payload?.status ?? nextStatus);
      toast({
        title: 'Estado actualizado',
        description: `La organización está ${nextStatus === 'active' ? 'activa' : 'suspendida'}.`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo actualizar el estado',
        description: error?.message || 'Intenta de nuevo más tarde.',
      });
    } finally {
      setOrgStatusActionLoading(false);
    }
  };


  const initialLoading = userLoading || profileLoading;

  if (initialLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <AppShell
      title="Ajustes"
      description="Actualiza el logo y las preferencias de la aplicación."
    >
      <div className="mx-auto max-w-2xl">
        {isSuperAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Ajustes de la Empresa</CardTitle>
              <CardDescription>
                Actualiza el logo y las preferencias de la aplicación.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-md border border-muted-foreground/20 bg-muted/30 p-4">
                <div className="space-y-2">
                  <Label>Estado de la organización</Label>
                  <div className="text-sm text-muted-foreground">
                    {orgStatusLoading ? 'Cargando estado…' : orgStatus ?? 'Sin estado registrado'}
                    {orgName ? ` · ${orgName}` : ''}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Suspender la organización bloquea el acceso de todos los miembros hasta reactivarla.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleOrgStatusChange('active')}
                      disabled={orgStatusActionLoading || orgStatus === 'active'}
                    >
                      Reactivar
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => handleOrgStatusChange('suspended')}
                      disabled={orgStatusActionLoading || orgStatus === 'suspended'}
                    >
                      Suspender
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Logo Actual</Label>
                <div className="flex items-center gap-4">
                  {settingsLoading ? <Icons.spinner className='animate-spin' /> : <DynamicClientLogo width={64} height={64} className="bg-muted p-1 rounded-md" />}
                  <p className="text-sm text-muted-foreground">Este es el logo que se muestra en toda la aplicación.</p>
                </div>
              </div>
               <div className="space-y-2">
                <Label>Previsualización</Label>
                 <div className="flex items-center gap-4">
                   {previewUrl ? (
                     <ClientLogo src={previewUrl} alt="Previsualización del logo" width={64} height={64} className="bg-muted p-1 rounded-md" />
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
              <Input id="logo-upload" type="file" onChange={handleFileChange} accept="image/png, image/jpeg, image/gif, image/webp" disabled={isPending} />
              {selectedFile && <p className="text-xs text-muted-foreground">Archivo seleccionado: {selectedFile.name}</p>}
              </div>
               {isPending && (
                  <div className="space-y-2">
                      <Label>Progreso de la subida</Label>
                      <Progress value={uploadProgress} className="w-full" />
                      <p className="text-sm text-muted-foreground">{Math.round(uploadProgress)}% completado</p>
                  </div>
               )}
            </CardContent>
            <CardFooter className="border-t px-6 py-4">
              <Button onClick={handleUpload} disabled={isPending || !selectedFile}>
              {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
               {isPending ? 'Subiendo...' : 'Guardar Cambios'}
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
                            Solo el super administrador puede modificar los ajustes de la empresa.
                      </CardDescription>
                  </div>
              </CardHeader>
            </Card>
        )}
      </div>
    </AppShell>
  );
}
