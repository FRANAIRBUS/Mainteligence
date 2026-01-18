'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser, useCollection, useDoc, useFirestore } from '@/lib/firebase';
import type { Site, User } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
} from "@/components/ui/alert-dialog";
import { canManageMasterData, normalizeRole } from '@/lib/rbac';
import { orgCollectionPath, orgDocPath } from '@/lib/organization';

function LocationsTable({
  sites,
  loading,
  onEdit,
  onDelete,
  canEdit,
}: {
  sites: Site[];
  loading: boolean;
  onEdit: (site: Site) => void;
  onDelete: (siteId: string) => void;
  canEdit: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sites.length > 0 ? (
        sites.map((site) => (
          <div key={site.id} className="rounded-lg border border-white/20 bg-background p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-base font-semibold">{site.name}</p>
                <p className="text-sm text-muted-foreground">Código: {site.code}</p>
              </div>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button aria-haspopup="true" size="icon" variant="ghost">
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
              )}
            </div>
          </div>
        ))
      ) : (
        <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground sm:col-span-2 xl:col-span-3">
          No se encontraron ubicaciones.
        </div>
      )}
    </div>
  );
}

export default function LocationsPage() {
  const { user, loading: userLoading, organizationId } = useUser();
  const router = useRouter();
  
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const firestore = useFirestore();
  const { toast } = useToast();
  
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : null);
  const normalizedRole = normalizeRole(userProfile?.role);
  const canManage = canManageMasterData(normalizedRole);

  const { data: sites, loading: sitesLoading } = useCollection<Site>(
    canManage && organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isEditLocationOpen, setIsEditLocationOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingSiteId, setDeletingSiteId] = useState<string | null>(null);

  const handleEditRequest = (site: Site) => {
    setEditingSite(site);
    setIsEditLocationOpen(true);
  }

  const handleDeleteRequest = (siteId: string) => {
    setDeletingSiteId(siteId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingSiteId || !firestore || !organizationId) return;
    try {
      await deleteDoc(doc(firestore, orgDocPath(organizationId, 'sites', deletingSiteId)));
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

  const initialLoading = userLoading || profileLoading;

  if (initialLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const tableIsLoading = sitesLoading;

  return (
    <AppShell
      title="Ubicaciones"
      description="Gestiona todas las ubicaciones físicas de la empresa."
      action={
        canManage ? (
          <Button onClick={() => setIsAddLocationOpen(true)}>Añadir Ubicación</Button>
        ) : null
      }
    >
      {canManage ? (
        <Card className="border-white/60 bg-sky-400/15">
          <CardHeader>
            <div>
              <CardTitle>Ubicaciones</CardTitle>
              <CardDescription className="mt-2">
                Gestiona todas las ubicaciones físicas de la empresa.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <LocationsTable
              sites={sites}
              loading={tableIsLoading}
              onEdit={handleEditRequest}
              onDelete={handleDeleteRequest}
              canEdit={canManage}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-8 border-white/60 bg-sky-400/15">
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              <p>No tienes permiso para ver esta página.</p>
              <p className="text-sm">Por favor, contacta a un administrador.</p>
            </div>
          </CardContent>
        </Card>
      )}
      {canManage && <AddLocationDialog
        open={isAddLocationOpen}
        onOpenChange={setIsAddLocationOpen}
      />}
      {canManage && <EditLocationDialog
        open={isEditLocationOpen}
        onOpenChange={setIsEditLocationOpen}
        site={editingSite}
      />}
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
    </AppShell>
  );
}
