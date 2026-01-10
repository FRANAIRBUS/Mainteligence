'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useAuth, useFirestore, useStorage, useUser } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { DEFAULT_ORGANIZATION_ID } from '@/lib/organization';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import { Icons } from '@/components/icons';
import { DynamicClientLogo } from '@/components/dynamic-client-logo';

const profileFormSchema = z.object({
  displayName: z
    .string()
    .min(2, { message: 'El nombre debe tener al menos 2 caracteres.' }),
  email: z.string().email({ message: 'Por favor, ingrese un correo válido.' }).optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export default function ProfilePage() {
  const { user, profile, loading: userLoading, organizationId } = useUser();
  const router = useRouter();
  
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);
  
  const firestore = useFirestore();
  const auth = useAuth();
  const storage = useStorage();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      displayName: '',
      email: '',
    },
  });

  useEffect(() => {
    if (user) {
      form.reset({
        displayName: user.displayName || '',
        email: user.email || '',
      });
    }
  }, [user, form]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(avatarPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);
  
  const resolvedOrganizationId =
    organizationId ?? profile?.organizationId ?? DEFAULT_ORGANIZATION_ID;

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (avatarPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(avatarPreviewUrl);
    }
    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
  };

  const onSubmit = async (data: ProfileFormValues) => {
    if (!user || !firestore || !auth?.currentUser) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No estás autenticado. Por favor, inicia sesión nuevamente.',
      });
      return;
    }

    setIsPending(true);
    toast({
      title: 'Guardando cambios...',
      description: 'Estamos actualizando tu perfil.',
    });
    try {
      // Use setDoc with merge to create or update the document.
      const userDocRef = doc(firestore, 'users', user.uid);
      await setDoc(userDocRef, {
        displayName: data.displayName,
        email: data.email || user.email || '',
        organizationId: resolvedOrganizationId,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      
      let uploadedAvatarUrl: string | null = null;
      if (avatarFile) {
        if (!storage) {
          throw new Error('Firebase Storage no está disponible.');
        }
        const avatarRef = ref(storage, `users/${user.uid}/avatar.jpg`);
        await uploadBytes(avatarRef, avatarFile, {
          contentType: avatarFile.type || 'image/jpeg',
        });
        uploadedAvatarUrl = await getDownloadURL(avatarRef);
        await setDoc(userDocRef, {
          avatarUrl: uploadedAvatarUrl,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        if (avatarPreviewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(avatarPreviewUrl);
        }
        setAvatarFile(null);
        setAvatarPreviewUrl(uploadedAvatarUrl);
      }

      const profileUpdate: { displayName?: string; photoURL?: string } = {
        displayName: data.displayName,
      };
      if (uploadedAvatarUrl) {
        profileUpdate.photoURL = uploadedAvatarUrl;
      }

      // Update Firebase Auth profile
      await updateProfile(auth.currentUser, profileUpdate);

      toast({
        title: '¡Éxito!',
        description: 'Tu perfil ha sido actualizado.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al actualizar',
        description: error.message || 'No se pudo actualizar tu perfil.',
      });
    } finally {
      setIsPending(false);
    }
  };
  
   if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const avatarUrl = avatarPreviewUrl ?? profile?.avatarUrl ?? user.photoURL ?? null;
  const initials = (user.displayName || user.email || 'Usuario').slice(0, 2).toUpperCase();

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
                    Mi Perfil
                </h1>
                <Card>
                    <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <CardHeader>
                        <CardTitle>Información de la Cuenta</CardTitle>
                        <CardDescription>
                            Actualiza tu nombre visible y correo electrónico.
                        </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                        <FormItem>
                          <FormLabel>Avatar</FormLabel>
                          <div className="flex items-center gap-4">
                            <Avatar className="h-16 w-16">
                              <AvatarImage src={avatarUrl ?? undefined} alt="Avatar de usuario" />
                              <AvatarFallback>{initials}</AvatarFallback>
                            </Avatar>
                            <FormControl>
                              <Input
                                type="file"
                                accept="image/*"
                                onChange={handleAvatarChange}
                              />
                            </FormControl>
                          </div>
                        </FormItem>
                        <FormField
                            control={form.control}
                            name="displayName"
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Nombre Completo</FormLabel>
                                <FormControl>
                                <Input placeholder="Tu nombre" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                            <FormItem>
                                <FormLabel>Correo Electrónico</FormLabel>
                                <FormControl>
                                <Input placeholder="tu@email.com" {...field} disabled />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                            )}
                        />
                        </CardContent>
                        <CardFooter className="border-t px-6 py-4">
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar Cambios
                        </Button>
                        </CardFooter>
                    </form>
                    </Form>
                </Card>
            </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
