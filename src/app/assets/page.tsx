'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser, useCollection, useDoc, useFirestore } from '@/lib/firebase';
import type { Asset, Site, User } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { AddAssetDialog } from '@/components/add-asset-dialog';
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

function AssetsTable({
  assets,
  sites,
  loading,
  onDelete,
  canEdit,
}: {
  assets: Asset[];
  sites: Site[];
  loading: boolean;
  onDelete: (assetId: string) => void;
  canEdit: boolean;
}) {
  const sitesById = useMemo(() => {
    return sites.reduce((acc, site) => {
      acc[site.id] = site.name;
      return acc;
    }, {} as Record<string, string>);
  }, [sites]);

  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {assets.length > 0 ? (
        assets.map((asset) => (
          <div key={asset.id} className="rounded-lg border border-white/20 bg-background p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-base font-semibold">{asset.name}</p>
                <p className="text-sm text-muted-foreground">Código: {asset.code}</p>
                <div>
                  {sitesById[asset.siteId] ? (
                    <Badge variant="outline">{sitesById[asset.siteId]}</Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">Ubicación: N/A</span>
                  )}
                </div>
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
                    <DropdownMenuItem disabled>Editar</DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() => onDelete(asset.id)}
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
          No se encontraron activos.
        </div>
      )}
    </div>
  );
}

export default function AssetsPage() {
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
  
  const { data: assets, loading: assetsLoading } = useCollection<Asset>(
    canManage && organizationId ? orgCollectionPath(organizationId, 'assets') : null
  );
  const { data: sites, loading: sitesLoading } = useCollection<Site>(
    canManage && organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );

  const [isAddAssetOpen, setIsAddAssetOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);

  const handleDeleteRequest = (assetId: string) => {
    setDeletingAssetId(assetId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingAssetId || !firestore || !organizationId) return;
    try {
      await deleteDoc(doc(firestore, orgDocPath(organizationId, 'assets', deletingAssetId)));
      toast({
        title: 'Éxito',
        description: 'Activo eliminado correctamente.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo eliminar el activo.',
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingAssetId(null);
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

  const tableIsLoading = assetsLoading || sitesLoading;

  return (
    <AppShell
      title="Activos"
      description="Gestiona todos los activos y equipos de la empresa."
      action={
        canManage ? (
          <Button onClick={() => setIsAddAssetOpen(true)}>Añadir Activo</Button>
        ) : null
      }
    >
      {canManage ? (
        <Card className="border-white/60 bg-sky-400/15">
          <CardHeader>
            <div>
              <CardTitle>Activos</CardTitle>
              <CardDescription className="mt-2">
                Gestiona todos los activos y equipos de la empresa.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <AssetsTable assets={assets} sites={sites} loading={tableIsLoading} onDelete={handleDeleteRequest} canEdit={canManage} />
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
      {canManage && <AddAssetDialog open={isAddAssetOpen} onOpenChange={setIsAddAssetOpen} sites={sites} />}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Esto eliminará permanentemente el
              activo de la base de datos.
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
