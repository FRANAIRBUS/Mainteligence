'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { orderBy } from 'firebase/firestore';
import { CalendarRange, ListFilter, MapPin, ShieldAlert } from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCollection, useCollectionQuery, useUser } from '@/lib/firebase';
import type { Site, WorkOrder } from '@/lib/firebase/models';
import { orgCollectionPath, orgWorkOrdersPath } from '@/lib/organization';

const statusLabel: Record<WorkOrder['status'], string> = {
  open: 'Abierta',
  in_progress: 'En progreso',
  closed: 'Cerrada',
};

const priorityOrder: Record<NonNullable<WorkOrder['priority']>, number> = {
  'Crítica': 3,
  'Alta': 2,
  'Media': 1,
  'Baja': 0,
};

export default function PreventivePage() {
  const router = useRouter();
  const { user, loading: userLoading, organizationId } = useUser();
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [priorityFilter, setPriorityFilter] = useState<string>('todas');
  const [dateFilter, setDateFilter] = useState<string>('recientes');
  const [locationFilter, setLocationFilter] = useState<string>('todas');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [user, userLoading, router]);

  const workOrdersQueryConstraints = useMemo(() => [orderBy('createdAt', 'desc')], []);

  const { data: workOrders = [], loading: workOrdersLoading } = useCollectionQuery<WorkOrder>(
    organizationId ? orgWorkOrdersPath(organizationId) : null,
    ...workOrdersQueryConstraints
  );

  const { data: sites = [] } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );

  const sitesMap = useMemo(
    () => sites.reduce((acc, site) => ({ ...acc, [site.id]: site.name }), {} as Record<string, string>),
    [sites]
  );

  const filteredWorkOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const sorted = [...workOrders].sort((a, b) => {
      const aCreatedAt = a.createdAt?.toMillis?.() ?? a.createdAt?.toDate?.().getTime?.() ?? 0;
      const bCreatedAt = b.createdAt?.toMillis?.() ?? b.createdAt?.toDate?.().getTime?.() ?? 0;

      if (aCreatedAt !== bCreatedAt) {
        return dateFilter === 'antiguas' ? aCreatedAt - bCreatedAt : bCreatedAt - aCreatedAt;
      }

      const aPriority = a.priority ?? 'Media';
      const bPriority = b.priority ?? 'Media';
      return priorityOrder[bPriority] - priorityOrder[aPriority];
    });

    return sorted.filter((wo) => {
      const matchesStatus = statusFilter === 'todas' || wo.status === statusFilter;
      const matchesPriority = priorityFilter === 'todas' || (wo.priority ?? 'Media') === priorityFilter;
      const matchesLocation = locationFilter === 'todas' || (wo.siteId ?? '') === locationFilter;
      const matchesQuery = !query || wo.title.toLowerCase().includes(query);
      return matchesStatus && matchesPriority && matchesLocation && matchesQuery;
    });
  }, [dateFilter, locationFilter, priorityFilter, searchQuery, statusFilter, workOrders]);

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
      <div className="flex flex-col gap-4 rounded-lg border border-white/60 bg-sky-400/15 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Input
            placeholder="Buscar por título"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="md:max-w-xs"
          />

          <div className="flex flex-wrap gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  statusFilter !== 'todas'
                    ? 'border-primary/70 bg-primary/10 text-primary'
                    : 'bg-transparent'
                }`}
              >
                <SelectValue className="sr-only" />
                <ListFilter className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Estado</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="open">Abiertas</SelectItem>
                <SelectItem value="in_progress">En progreso</SelectItem>
                <SelectItem value="closed">Cerradas</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  priorityFilter !== 'todas'
                    ? 'border-primary/70 bg-primary/10 text-primary'
                    : 'bg-transparent'
                }`}
              >
                <SelectValue className="sr-only" />
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Prioridad</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="Crítica">Crítica</SelectItem>
                <SelectItem value="Alta">Alta</SelectItem>
                <SelectItem value="Media">Media</SelectItem>
                <SelectItem value="Baja">Baja</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  dateFilter !== 'recientes'
                    ? 'border-primary/70 bg-primary/10 text-primary'
                    : 'bg-transparent'
                }`}
              >
                <SelectValue className="sr-only" />
                <CalendarRange className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Orden</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recientes">Más recientes</SelectItem>
                <SelectItem value="antiguas">Más antiguas</SelectItem>
              </SelectContent>
            </Select>

            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger
                className={`h-10 w-12 justify-center border border-white/60 p-0 [&>span]:sr-only [&>svg:last-child]:hidden ${
                  locationFilter !== 'todas'
                    ? 'border-primary/70 bg-primary/10 text-primary'
                    : 'bg-transparent'
                }`}
              >
                <SelectValue className="sr-only" />
                <MapPin className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Ubicación</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3">
          {!workOrdersLoading && filteredWorkOrders.length === 0 && (
            <div className="flex h-24 items-center justify-center rounded-lg border border-white/20 bg-background text-muted-foreground">
              No hay preventivos que coincidan con los filtros.
            </div>
          )}

          {!workOrdersLoading &&
            filteredWorkOrders.map((wo) => {
              const createdAt = wo.createdAt?.toDate?.();
              const createdLabel = createdAt instanceof Date && !isNaN(createdAt.getTime())
                ? createdAt.toLocaleDateString()
                : 'Sin fecha';
              const siteLabel = wo.siteId ? sitesMap[wo.siteId] : '';

              return (
                <Link
                  key={wo.id}
                  href={`/preventive/work-orders/${wo.id}`}
                  className="block rounded-lg border border-white/20 bg-background p-4 shadow-sm transition hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-foreground">{wo.title}</p>
                        <Badge variant="outline">{statusLabel[wo.status]}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {wo.templateSnapshot?.name || wo.description || 'Sin descripción'}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>Creada: {createdLabel}</span>
                        {siteLabel ? <span>Ubicación: {siteLabel}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={wo.priority === 'Crítica' ? 'destructive' : 'secondary'}>
                        Prioridad {wo.priority ?? 'Media'}
                      </Badge>
                      {wo.templateSnapshot?.frequencyDays ? (
                        <Badge variant="outline">{wo.templateSnapshot.frequencyDays} días</Badge>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}

          {workOrdersLoading && (
            <div className="flex h-24 items-center justify-center">
              <Icons.spinner className="h-8 w-8 animate-spin" />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
