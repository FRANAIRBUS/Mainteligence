'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { where } from 'firebase/firestore';
import { MoreHorizontal } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { useCollectionQuery, useUser } from '@/lib/firebase';
import type { WorkOrder } from '@/lib/firebase/models';
import { orgWorkOrdersPath } from '@/lib/organization';

function WorkOrdersTable({ workOrders, loading }: { workOrders: WorkOrder[]; loading: boolean }) {
  const router = useRouter();

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
          <TableHead>ID</TableHead>
          <TableHead>Título</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Prioridad</TableHead>
          <TableHead>Creado</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workOrders.length > 0 ? (
          workOrders.map((wo) => (
            <TableRow
              key={wo.id}
              className="cursor-pointer"
              onClick={() => router.push(`/preventive/work-orders/${wo.id}`)}
            >
              <TableCell className="font-medium">{wo.id.substring(0, 10)}</TableCell>
              <TableCell>{wo.title}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {wo.status === 'open'
                    ? 'Abierta'
                    : wo.status === 'in_progress'
                      ? 'En progreso'
                      : 'Cerrada'}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{wo.priority ?? 'Media'}</Badge>
              </TableCell>
              <TableCell>
                {wo.createdAt?.toDate ? wo.createdAt.toDate().toLocaleDateString() : 'N/A'}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-haspopup="true"
                      size="icon"
                      variant="ghost"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Menú de acciones</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => router.push(`/preventive/work-orders/${wo.id}`)}>
                      Ver detalles
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push(`/preventive/work-orders/${wo.id}`)}>
                      En progreso
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={6} className="h-24 text-center">
              No se encontraron órdenes de mantenimiento preventivo.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export default function PreventivePage() {
  const router = useRouter();
  const { user, loading: userLoading, organizationId } = useUser();
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const workOrdersConstraints = useMemo(() => {
    return showClosed ? [] : [where('isOpen', '==', true)];
  }, [showClosed]);

  const { data: workOrders, loading: workOrdersLoading } = useCollectionQuery<WorkOrder>(
    organizationId ? orgWorkOrdersPath(organizationId) : null,
    ...workOrdersConstraints
  );

  if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">No se pudo resolver la organización.</p>
      </div>
    );
  }

  return (
    <AppShell
      title="Preventivos"
      description="Órdenes de mantenimiento preventivo"
      action={
        <Button asChild variant="outline">
          <Link href="/preventive/templates">Plantillas</Link>
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Mantenimientos Preventivos</CardTitle>
              <CardDescription className="mt-2">
                Visualiza y gestiona todas las órdenes de mantenimiento preventivo.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? 'Ocultar cerradas' : 'Mostrar cerradas'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <WorkOrdersTable workOrders={workOrders} loading={workOrdersLoading} />
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
