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
import type { User } from '@/lib/firebase/models';
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
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
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

function UserTable({
  users,
  loading,
  onEditUser,
}: {
  users: User[];
  loading: boolean;
  onEditUser: (user: User) => void;
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
          <TableHead>Display Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
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
                  {user.active ? 'Active' : 'Inactive'}
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
                      <span className="sr-only">Toggle menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onEditUser(user)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={5} className="h-24 text-center">
              No users found.
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
        description: 'User or database not available.',
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
        title: 'Success!',
        description: 'Your admin profile has been created.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Permission Error',
        description:
          'Could not create admin profile. Check Firestore security rules.',
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
          Complete Admin Setup
        </CardTitle>
        <CardDescription>
          Your authenticated user does not have a profile in the database.
          Create one now to gain admin permissions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleCreateAdmin} disabled={isCreating}>
          {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create My Admin Profile
        </Button>
      </CardContent>
    </Card>
  );
}

export default function UsersPage() {
  const { user, loading: userLoading } = useUser();
  const { data: users, loading: usersLoading } = useCollection<User>('users');
  const { data: userProfile, loading: profileLoading } = useDoc<User>(
    user ? `users/${user.uid}` : ''
  );
  const router = useRouter();
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const handleEditUser = (userToEdit: User) => {
    setEditingUser(userToEdit);
    setIsEditUserOpen(true);
  };

  const showCreateAdminProfile =
    !userLoading && user && !profileLoading && !userProfile;

  if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const isAdmin = userProfile?.role === 'admin';

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4">
          <a href="/" className="flex items-center gap-2">
            <Icons.logo className="h-8 w-8 text-sidebar-primary" />
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

          {isAdmin || users.length > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Users & Roles</CardTitle>
                    <CardDescription className="mt-2">
                      Manage all users and their permissions.
                    </CardDescription>
                  </div>
                  {isAdmin && (
                    <Button onClick={() => setIsAddUserOpen(true)}>Add User</Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <UserTable users={users} loading={usersLoading} onEditUser={handleEditUser} />
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-8">
              <CardContent className="pt-6">
                <div className="text-center text-muted-foreground">
                  <p>You do not have permission to view this page.</p>
                  <p className="text-sm">Please contact an administrator.</p>
                </div>
              </CardContent>
            </Card>
          )}
        </main>
      </SidebarInset>
      <AddUserDialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen} />
      {editingUser && (
        <EditUserDialog
          key={editingUser.id}
          open={isEditUserOpen}
          onOpenChange={setIsEditUserOpen}
          user={editingUser}
        />
      )}
    </SidebarProvider>
  );
}
