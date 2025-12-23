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
import { useUser, useCollection, useFirestore } from '@/lib/firebase';
import type { Site } from '@/lib/firebase/models';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { AddLocationDialog } from '@/components/add-location-dialog';
import { EditLocationDialog } from '@/components/edit-location-dialog';
import { doc, deleteDoc } from 'firebase/firestore';
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
} from "@/components/ui/alert-dialog"

function LocationsTable({
  sites,
  loading,
  onEdit,
  onDelete,
}: {
  sites: Site[];
  loading: boolean;
  onEdit: (site: Site) => void;
  onDelete: (siteId: string) => void;
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
          <TableHead>Código</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sites.length > 0 ? (
          sites.map((site) => (
            <TableRow key={site.id}>
              <TableCell className="font-medium">{site.name}</TableCell>
              <TableCell>{site.code}</TableCell>
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
                    <DropdownMenuItem onClick={() => onEdit(site)}>Editar</DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() => onDelete(site.id)}
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
            <TableCell colSpan={3} className="h-24 text-center">
              No se encontraron ubicaciones.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export default function LocationsPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const {
    data: sites,
    loading: sitesLoading,
  } = useCollection<Site>('sites');
  const router = useRouter();
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isEditLocationOpen, setIsEditLocationOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingSiteId, setDeletingSiteId] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const handleEditRequest = (site: Site) => {
    setEditingSite(site);
    setIsEditLocationOpen(true);
  }

  const handleDeleteRequest = (siteId: string) => {
    setDeletingSiteId(siteId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSiteId || !firestore) return;
    try {
      await deleteDoc(doc(firestore, 'sites', deletingSiteId));
      toast({
        title: 'Éxito',
        description: 'Ubicación eliminada correctamente.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo eliminar la ubicación.',
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingSiteId(null);
    }
  };

  const isLoading = userLoading || sitesLoading;

  if (isLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

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
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Ubicaciones</CardTitle>
                    <CardDescription className="mt-2">
                      Gestiona todas las ubicaciones físicas de la empresa.
                    </CardDescription>
                  </div>
                  <Button onClick={() => setIsAddLocationOpen(true)}>Añadir Ubicación</Button>
                </div>
            </CardHeader>
            <CardContent>
              <LocationsTable sites={sites} loading={sitesLoading} onEdit={handleEditRequest} onDelete={handleDeleteRequest} />
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
      <AddLocationDialog
        open={isAddLocationOpen}
        onOpenChange={setIsAddLocationOpen}
      />
      {editingSite && (
        <EditLocationDialog
          key={editingSite.id}
          open={isEditLocationOpen}
          onOpenChange={setIsEditLocationOpen}
          site={editingSite}
        />
      )}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Esto eliminará permanentemente la
              ubicación de la base de datos.
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
