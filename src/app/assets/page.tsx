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
import type { Asset, Site, User } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
import { DynamicClientLogo } from '@/components/dynamic-client-logo';

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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Código</TableHead>
          <TableHead>Ubicación</TableHead>
          {canEdit && (
            <TableHead>
              <span className="sr-only">Acciones</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.length > 0 ? (
          assets.map((asset) => (
            <TableRow key={asset.id}>
              <TableCell className="font-medium">{asset.name}</TableCell>
              <TableCell>{asset.code}</TableCell>
              <TableCell>
                {sitesById[asset.siteId] ? (
                  <Badge variant="outline">{sitesById[asset.siteId]}</Badge>
                ) : (
                  'N/A'
                )}
              </TableCell>
              {canEdit && (
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
                      <DropdownMenuItem disabled>Editar</DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() => onDelete(asset.id)}
                      >
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={canEdit ? 4 : 3} className="h-24 text-center">
              No se encontraron activos.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export default function AssetsPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const firestore = useFirestore();
  const { toast } = useToast();
  
  const { data: userProfile, loading: profileLoading } = useDoc<User>(user ? `users/${user.uid}` : null);
  const { data: assets, loading: assetsLoading } = useCollection<Asset>('assets');
  const { data: sites, loading: sitesLoading } = useCollection<Site>('sites');

  const [isAddAssetOpen, setIsAddAssetOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);

  const handleDeleteRequest = (assetId: string) => {
    setDeletingAssetId(assetId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingAssetId || !firestore) return;
    try {
      await deleteDoc(doc(firestore, 'assets', deletingAssetId));
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

  const isAdmin = userProfile?.role === 'admin';
  const tableIsLoading = assetsLoading || sitesLoading;

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
          <Card>
            <CardHeader>
               <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Activos</CardTitle>
                  <CardDescription className="mt-2">
                    Gestiona todos los activos y equipos de la empresa.
                  </CardDescription>
                </div>
                {isAdmin && <Button onClick={() => setIsAddAssetOpen(true)}>Añadir Activo</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <AssetsTable assets={assets} sites={sites} loading={tableIsLoading} onDelete={handleDeleteRequest} canEdit={isAdmin} />
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
      {isAdmin && <AddAssetDialog open={isAddAssetOpen} onOpenChange={setIsAddAssetOpen} sites={sites} />}
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
    </SidebarProvider>
  );
}
