'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useUser, useCollection, useFirestore } from '@/lib/firebase';
import type { Department } from '@/lib/firebase/models';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { canManageMasterData, normalizeRole } from '@/lib/rbac';
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
import { AddDepartmentDialog } from '@/components/add-department-dialog';
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
import { orgCollectionPath, orgDocPath } from '@/lib/organization';

function DepartmentsTable({
  departments,
  loading,
  onDelete,
  canEdit,
}: {
  departments: Department[];
  loading: boolean;
  onDelete: (departmentId: string) => void;
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
      {departments.length > 0 ? (
        departments.map((dept) => (
          <div key={dept.id} className="rounded-lg border border-white/20 bg-background p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-base font-semibold">{dept.name}</p>
                <p className="text-sm text-muted-foreground">Código: {dept.code}</p>
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
                      onClick={() => onDelete(dept.id)}
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
          No se encontraron departamentos.
        </div>
      )}
    </div>
  );
}

export default function DepartmentsPage() {
  const { user, loading: userLoading, organizationId, role } = useUser();
  const router = useRouter();
  
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const firestore = useFirestore();
  const { toast } = useToast();
  
  const normalizedRole = normalizeRole(role);
  const canManage = canManageMasterData(normalizedRole);

  const { data: departments, loading: departmentsLoading } = useCollection<Department>(
    canManage && organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );

  const [isAddDepartmentOpen, setIsAddDepartmentOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingDeptId, setDeletingDeptId] = useState<string | null>(null);

  const handleDeleteRequest = (departmentId: string) => {
    setDeletingDeptId(departmentId);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingDeptId || !firestore || !organizationId) return;
    try {
      await deleteDoc(doc(firestore, orgDocPath(organizationId, 'departments', deletingDeptId)));
      toast({
        title: 'Éxito',
        description: 'Departamento eliminado correctamente.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo eliminar el departamento.',
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeletingDeptId(null);
    }
  };
  
  const initialLoading = userLoading;

  if (initialLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const tableIsLoading = departmentsLoading;


  return (
    <AppShell
      title="Departamentos"
      description="Gestiona todos los departamentos de la empresa."
      action={
        canManage ? (
          <Button onClick={() => setIsAddDepartmentOpen(true)}>Añadir Departamento</Button>
        ) : null
      }
    >
      {canManage ? (
        <Card className="border-white/60 bg-sky-400/15">
          <CardHeader>
            <div>
              <CardTitle>Departamentos</CardTitle>
              <CardDescription className="mt-2">
                Gestiona todos los departamentos de la empresa.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <DepartmentsTable departments={departments} loading={tableIsLoading} onDelete={handleDeleteRequest} canEdit={canManage} />
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
       {canManage && <AddDepartmentDialog
        open={isAddDepartmentOpen}
        onOpenChange={setIsAddDepartmentOpen}
      />}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Esto eliminará permanentemente el
              departamento de la base de datos.
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
