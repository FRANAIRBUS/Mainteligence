'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { where } from 'firebase/firestore';
import { MoreHorizontal, ListFilter } from 'lucide-react';

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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCollectionQuery, useUser } from '@/lib/firebase';
import type { WorkOrder } from '@/lib/firebase/models';
import { orgWorkOrdersPath } from '@/lib/organization';

function WorkOrdersList({ workOrders, loading }: { workOrders: WorkOrder[]; loading: boolean }) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (workOrders.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground">
        No se encontraron órdenes de mantenimiento preventivo.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {workOrders.map((wo) => {
        const createdAtLabel = wo.createdAt?.toDate
          ? wo.createdAt.toDate().toLocaleDateString()
          : 'N/A';
        const statusLabel =
          wo.status === 'open' ? 'Abierta' : wo.status === 'in_progress' ? 'En progreso' : 'Cerrada';

        return (
          <div
            key={wo.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/preventive/work-orders/${wo.id}`)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                router.push(`/preventive/work-orders/${wo.id}`);
              }
            }}
            className="block rounded-lg border border-white/20 bg-background p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-foreground">{wo.title}</p>
                  <Badge variant="outline">{statusLabel}</Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {wo.description || 'Sin descripción'}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Creado: {createdAtLabel}</span>
                  {wo.preventive?.scheduledFor?.toDate && (
                    <span>
                      Programado: {wo.preventive.scheduledFor.toDate().toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={wo.priority === 'Crítica' ? 'destructive' : 'secondary'}>
                  Prioridad {wo.priority ?? 'Media'}
                </Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-haspopup="true"
                      size="icon"
                      variant="ghost"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Menú de acciones</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        router.push(`/preventive/work-orders/${wo.id}`);
                      }}
                    >
                      Ver detalles
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PreventivePage() {
  const router = useRouter();
  const { user, loading: userLoading, organizationId } = useUser();
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const workOrdersConstraints = useMemo(() => {
    if (statusFilter === 'all') return [];
    return [where('isOpen', '==', statusFilter === 'open')];
  }, [statusFilter]);

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
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
            <div>
              <CardTitle>Mantenimientos Preventivos</CardTitle>
              <CardDescription className="mt-2">
                Visualiza y gestiona todas las órdenes de mantenimiento preventivo.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden">
                  <SelectValue className="sr-only" />
                  <ListFilter className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Estado</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Abiertas</SelectItem>
                  <SelectItem value="closed">Cerradas</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <WorkOrdersList workOrders={workOrders} loading={workOrdersLoading} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
