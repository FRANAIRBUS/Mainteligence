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
import { useUser, useCollection, useDoc, useFirestore } from '@/lib/firebase';
import type { User, Department } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { doc, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { MoreHorizontal, AlertTriangle, Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { AddUserDialog } from '@/components/add-user-dialog';
import { EditUserDialog } from '@/components/edit-user-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DynamicClientLogo } from '@/components/dynamic-client-logo';

function UserTable({
  users,
  loading,
  onEditUser,
  onDeleteUser,
}: {
  users: User[];
  loading: boolean;
  onEditUser: (user: User) => void;
  onDeleteUser: (userId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Correo electrónico</TableHead>
          <TableHead>Rol</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.length > 0 ? (
          users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">
                {user.displayName}
              </TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{user.role}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={user.active ? 'default' : 'secondary'}>
                  {user.active ? 'Activo' : 'Inactivo'}
                </Badge>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-haspopup="true"
                      size="icon"
                      variant="ghost"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Menú de acciones</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onEditUser(user)}>Editar</DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-red-600"
                      onClick={() => onDeleteUser(user.id)}
                    >
                        Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={5} className="h-24 text-center">
              No se encontraron usuarios.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function CreateAdminProfile() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateAdmin = async () => {
    if (!user || !firestore) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Usuario o base de datos no disponibles.',
      });
      return;
    }
    setIsCreating(true);
    try {
      const userRef = doc(firestore, 'users', user.uid);
      await setDoc(userRef, {
        displayName: user.displayName || user.email,
        email: user.email,
        role: 'admin',
        active: true,
        isMaintenanceLead: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast({
        title: '¡Éxito!',
        description: 'Tu perfil de administrador ha sido creado.',
      });
      // Consider a page reload or state update to refresh the view
      window.location.reload();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error de Permiso',
        description:
          'No se pudo crear el perfil de administrador. Revisa las reglas de seguridad de Firestore.',
      });
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card className="mb-8 border-amber-500/50 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="text-amber-500" />
          Completar Configuración de Administrador
        </CardTitle>
        <CardDescription>
          Tu cuenta de usuario autenticada no tiene un perfil en la base de datos de la aplicación.
          Crea un perfil de administrador ahora para obtener permisos de gestión y que otros
          administradores puedan encontrarte en el panel de Usuarios.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleCreateAdmin} disabled={isCreating}>
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Crear Mi Perfil de Administrador
        </Button>
      </CardContent>
    </Card>
  );
}

export default function UsersPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  // Phase 1: Wait for user authentication
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const firestore = useFirestore();
  const { toast } = useToast();
  
  // Phase 2: Load user profile, but only if user is authenticated
  const { data: userProfile, loading: profileLoading } = useDoc<User>(
    user ? `users/${user.uid}` : null
  );

  const isAdmin = userProfile?.role === 'admin';
  
  // Phase 3: Load app data, but only if the current user is an admin
  const { data: users, loading: usersLoading } = useCollection<User>(
    isAdmin ? 'users' : null
  );
  
  const { data: departments, loading: deptsLoading } = useCollection<Department>(
    isAdmin ? 'departments' : null
  );

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const handleEditUser = (userToEdit: User) => {
    setEditingUser(userToEdit);
    setIsEditUserOpen(true);
  };
  
  const handleDeleteRequest = (userId: string) => {
    if (userId === user?.uid) {
        toast({
            variant: "destructive",
            title: "Acción no permitida",
            description: "No puedes eliminar tu propia cuenta de usuario.",
        });
        return;
    }
    setDeletingUserId(userId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingUserId || !firestore) return;
    try {
      await deleteDoc(doc(firestore, 'users', deletingUserId));
      toast({
        title: 'Éxito',
        description: 'Usuario eliminado correctamente.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo eliminar el usuario.',
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingUserId(null);
    }
  };

  // Initial loading is true if we are waiting for auth or profile info
  const initialLoading = userLoading || profileLoading;

  if (initialLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // This is a specific state: user is authenticated but has no profile document.
  const showCreateAdminProfile = !profileLoading && !userProfile;
  const tableIsLoading = isAdmin && (usersLoading || deptsLoading);

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
          {showCreateAdminProfile && <CreateAdminProfile />}

          {isAdmin ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Usuarios y Roles</CardTitle>
                    <CardDescription className="mt-2">
                      Gestiona todos los usuarios y sus permisos.
                    </CardDescription>
                  </div>
                    <Button onClick={() => setIsAddUserOpen(true)}>Añadir Usuario</Button>
                </div>
              </CardHeader>
              <CardContent>
                <UserTable users={users} loading={tableIsLoading} onEditUser={handleEditUser} onDeleteUser={handleDeleteRequest} />
              </CardContent>
            </Card>
          ) : (
            !showCreateAdminProfile && (
              <Card className="mt-8">
                <CardContent className="pt-6">
                  <div className="text-center text-muted-foreground">
                    <p>No tienes permiso para ver esta página.</p>
                    <p className="text-sm">
                      Pide a un administrador que te cree o actualice en el panel de Usuarios con el rol
                      adecuado. Si tu cuenta no aparece, inicia sesión y crea tu perfil con el botón de
                      "Crear Mi Perfil de Administrador".
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </main>
      </SidebarInset>
      {isAdmin && departments && <AddUserDialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen} departments={departments} />}
      {editingUser && isAdmin && departments && (
        <EditUserDialog
          key={editingUser.id}
          open={isEditUserOpen}
          onOpenChange={setIsEditUserOpen}
          user={editingUser}
          departments={departments}
        />
      )}
       <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Esto eliminará permanentemente al usuario
              de la base de datos de la aplicación (pero no de Firebase Authentication).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Continuar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
