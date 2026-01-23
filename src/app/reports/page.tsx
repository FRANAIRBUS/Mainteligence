'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useCollection, useDoc, useFirestore, useUser } from '@/lib/firebase';
import type { Ticket, Department, Site, Organization, OrganizationMember } from '@/lib/firebase/models';
import type { MaintenanceTask } from '@/types/maintenance-task';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import Link from 'next/link';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  Activity,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  ClipboardList,
  Coins,
  Download,
  LineChart as LineChartIcon,
  MapPin,
  Workflow,
} from 'lucide-react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';

import {
  buildTrendData,
  buildOperatorPerformance,
  calculateReportMetrics,
  calculatePreventiveCompliance,
  buildIncidentGrouping,
  filterTasks,
  filterTickets,
  type MetricsFilters,
} from '@/lib/reports/metrics';

import {
  buildReportCsv,
  buildReportExportRows,
  type ExportSortOrder,
} from '@/lib/reports/export';

import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { isFeatureEnabled } from '@/lib/entitlements';
import { orgCollectionPath, orgDocPath } from '@/lib/organization';
import { normalizeTicketStatus } from '@/lib/status';
import { buildRbacUser, getTaskPermissions, getTicketPermissions, normalizeRole } from '@/lib/rbac';
import { useScopedTasks, useScopedTickets } from '@/lib/scoped-collections';

export default function ReportsPage() {
  const { user, profile: userProfile, role, loading, organizationId } = useUser();
  const router = useRouter();
  const firestore = useFirestore();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [exportSortOrder, setExportSortOrder] =
    useState<ExportSortOrder>('desc');
  const [isExporting, setIsExporting] = useState(false);
  const [planFeatures, setPlanFeatures] = useState<Record<string, boolean> | null>(null);

  const { toast } = useToast();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  const normalizedRole = normalizeRole(role ?? userProfile?.role);
  const { data: currentMember } = useDoc<OrganizationMember>(
    user && organizationId ? orgDocPath(organizationId, 'members', user.uid) : null
  );
  const rbacUser = buildRbacUser({
    role,
    organizationId,
    member: currentMember,
    profile: userProfile ?? null,
  });
  const canReadMembers =
    normalizedRole &&
    ['super_admin', 'admin', 'mantenimiento', 'jefe_departamento', 'jefe_ubicacion', 'auditor'].includes(
      normalizedRole
    );

  const { data: organization } = useDoc<Organization>(
    organizationId ? `organizations/${organizationId}` : null
  );

  useEffect(() => {
    if (!firestore || !organization?.entitlement?.planId) {
      setPlanFeatures(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(firestore, 'planCatalog', organization.entitlement.planId))
      .then((snap) => {
        if (cancelled) return;
        const features = (snap.exists() ? (snap.data()?.features as Record<string, boolean>) : null) ?? null;
        setPlanFeatures(features);
      })
      .catch(() => {
        if (cancelled) return;
        setPlanFeatures(null);
      });

    return () => {
      cancelled = true;
    };
  }, [firestore, organization?.entitlement?.planId]);

  const entitlement = organization?.entitlement ?? null;
  const exportAllowed =
    planFeatures && entitlement
      ? isFeatureEnabled({ ...entitlement, features: planFeatures }, 'EXPORT_PDF')
      : true;
  const exportBlocked = Boolean(entitlement) && planFeatures !== null && !exportAllowed;

  const { data: tickets = [], loading: ticketsLoading } = useScopedTickets({
    organizationId,
    rbacUser,
    uid: user?.uid ?? null,
  });
  const { data: tasks = [], loading: tasksLoading } = useScopedTasks({
    organizationId,
    rbacUser,
    uid: user?.uid ?? null,
  });
  const { data: departments = [], loading: departmentsLoading } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );
  const { data: sites = [], loading: sitesLoading } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  const { data: members = [], loading: membersLoading } = useCollection<OrganizationMember>(
    canReadMembers && organizationId ? orgCollectionPath(organizationId, 'members') : null
  );

  if (loading || !user) {
    return (
      <div className="flex h-screen w-full max-w-full items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const visibleTickets = rbacUser
    ? tickets.filter((ticket) => getTicketPermissions(ticket, rbacUser, user?.uid ?? null).canView)
    : tickets;
  const visibleTasks = rbacUser
    ? tasks.filter((task) => getTaskPermissions(task, rbacUser, user?.uid ?? null).canView)
    : tasks;

  const siteNameById = useMemo(() => {
    return sites.reduce(
      (acc, site) => ({ ...acc, [site.id]: site.name }),
      {} as Record<string, string>
    );
  }, [sites]);

  const departmentNameById = useMemo(() => {
    return departments.reduce(
      (acc, department) => ({ ...acc, [department.id]: department.name }),
      {} as Record<string, string>
    );
  }, [departments]);

  const sitesById = useMemo(() => {
    return sites.reduce((acc, site) => {
      acc.set(site.id, site);
      return acc;
    }, new Map<string, Site>());
  }, [sites]);

  const departmentsById = useMemo(() => {
    return departments.reduce((acc, department) => {
      acc.set(department.id, department);
      return acc;
    }, new Map<string, Department>());
  }, [departments]);

  const locationOptions = useMemo(() => {
    const locationSet = new Set<string>();
    sites.forEach((site) => locationSet.add(site.name));
    return Array.from(locationSet).sort((a, b) => a.localeCompare(b));
  }, [sites]);

  const filters: MetricsFilters = {
    startDate: startDate ? new Date(`${startDate}T00:00:00`) : null,
    endDate: endDate ? new Date(`${endDate}T23:59:59`) : null,
    location: locationFilter === 'all' ? undefined : locationFilter,
    departmentId: departmentFilter === 'all' ? undefined : departmentFilter,
  };

  const filteredTickets = useMemo(
    () => filterTickets(visibleTickets, filters, siteNameById),
    [visibleTickets, filters, siteNameById]
  );

  const filteredTasks = useMemo(
    () => filterTasks(visibleTasks, filters, siteNameById),
    [visibleTasks, filters, siteNameById]
  );

  const metrics = useMemo(
    () => calculateReportMetrics(filteredTickets, filteredTasks),
    [filteredTickets, filteredTasks]
  );

  const operatorPerformance = useMemo(
    () => buildOperatorPerformance(filteredTickets, filteredTasks),
    [filteredTickets, filteredTasks]
  );

  const usersById = useMemo(() => {
    return members.reduce((acc, m) => {
      acc.set(m.id, m);
      return acc;
    }, new Map<string, OrganizationMember>());
  }, [members]);

  const toDate = (value?: Timestamp | Date | null) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    return value.toDate?.() ?? null;
  };

  const formatDateTime = (value?: Timestamp | Date | null) => {
    const date = toDate(value);
    if (!date) return 'Sin fecha';
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const operatorLabelForTicket = (ticket: Ticket) => {
    const reportAuthor = [...(ticket.reports ?? [])]
      .reverse()
      .find((entry) => entry.createdBy)?.createdBy;
    const operatorId =
      ticket.closedBy ?? reportAuthor ?? ticket.assignedTo ?? ticket.createdBy;
    if (!operatorId) return 'Sin asignar';
    const operator = usersById.get(operatorId);
    return operator?.displayName ?? operator?.email ?? operatorId;
  };

  const keyEventLabels: Record<string, string> = {
    status_changed: 'Cambio de estado',
    report_generated: 'Informe generado',
  };

  const recentClosures = useMemo(() => {
    return filteredTickets
      .filter((ticket) => normalizeTicketStatus(ticket.status) === 'resolved' || ticket.closedAt)
      .map((ticket) => ({
        ticket,
        closedAt: toDate(ticket.closedAt ?? ticket.updatedAt ?? ticket.createdAt),
      }))
      .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))
      .slice(0, 8);
  }, [filteredTickets]);

  const trendData = useMemo(
    () => buildTrendData(filteredTickets, filteredTasks, filters),
    [filteredTickets, filteredTasks, filters]
  );

  const departmentIncidents = useMemo(
    () => buildIncidentGrouping(filteredTickets, 'departmentId', departmentNameById),
    [filteredTickets, departmentNameById]
  );

  const siteIncidents = useMemo(
    () => buildIncidentGrouping(filteredTickets, 'locationId', siteNameById),
    [filteredTickets, siteNameById]
  );

  const preventiveCompliance = useMemo(
    () => calculatePreventiveCompliance(filteredTickets),
    [filteredTickets]
  );

  const averageMttrLabel =
    metrics.averageMttrHours !== null
      ? `${metrics.averageMttrHours.toFixed(1)} h`
      : 'Sin datos';

  const dataLoading =
    ticketsLoading ||
    tasksLoading ||
    departmentsLoading ||
    sitesLoading ||
    membersLoading;

  const operatorRows = operatorPerformance.map((entry) => {
    const u = usersById.get(entry.userId);
    return {
      ...entry,
      label: u?.displayName ?? u?.email ?? entry.userId,
      mttrLabel:
        entry.averageMttrHours !== null
          ? `${entry.averageMttrHours.toFixed(1)} h`
          : 'Sin datos',
    };
  });

  const preventiveSummaryData = [
    {
      label: 'Preventivos',
      onTime: preventiveCompliance.summary.onTime,
      late: preventiveCompliance.summary.late,
    },
  ];

  const preventiveSummaryLabel =
    preventiveCompliance.summary.complianceRate !== null
      ? `${preventiveCompliance.summary.complianceRate.toFixed(1)}%`
      : 'Sin datos';

  const exportRows = useMemo(
    () =>
      buildReportExportRows({
        tickets: visibleTickets,
        tasks: visibleTasks,
        usersById,
        departmentsById,
        sitesById,
        filters: {
          startDate: startDate ? new Date(`${startDate}T00:00:00`) : null,
          endDate: endDate ? new Date(`${endDate}T23:59:59`) : null,
          location: locationFilter === 'all' ? undefined : locationFilter,
          departmentId: departmentFilter === 'all' ? undefined : departmentFilter,
        },
        sortOrder: exportSortOrder,
      }),
    [
      visibleTickets,
      visibleTasks,
      usersById,
      departmentsById,
      sitesById,
      startDate,
      endDate,
      locationFilter,
      departmentFilter,
      exportSortOrder,
    ]
  );

  const handleExport = () => {
    if (isExporting) return;
    if (exportBlocked) {
      toast({
        title: 'Exportación no disponible',
        description: 'Tu plan actual no incluye exportaciones. Actualiza el plan para habilitar esta función.',
      });
      return;
    }

    if (!exportRows.length) {
      toast({
        title: 'Sin registros para exportar',
        description: 'Ajusta los filtros para obtener resultados.',
      });
      return;
    }

    const needsFeedback = exportRows.length >= 500;
    const exportToast = needsFeedback
      ? toast({
          title: 'Generando exportación',
          description: 'Preparando el archivo para descarga.',
        })
      : null;

    setIsExporting(true);

    const csvContent = buildReportCsv(exportRows);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte-mantenimiento-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    if (exportToast) {
      exportToast.update({
        title: 'Exportación lista',
        description: 'El archivo se ha descargado correctamente.',
      });
    }

    setIsExporting(false);
  };

  const xTickFormatterMobile = (value: unknown) => {
    const label = String(value ?? '');
    if (!isMobile) return label;
    return label.length > 14 ? `${label.slice(0, 14)}…` : label;
  };

  return (
    <AppShell
      title="Informes"
      description="Genera y visualiza informes detallados del mantenimiento."
    >
      {/* ✅ clave: evita scroll horizontal (diferencias Safari/Chrome móvil) */}
      <div className="w-full max-w-full overflow-x-hidden space-y-5 sm:space-y-6">
        {/* Panel de métricas */}
        <Card>
          <CardHeader className="gap-2 p-4 sm:p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base sm:text-lg">Panel de métricas</CardTitle>
              <CardDescription className="mt-1 sm:mt-2">
                Ajusta los filtros globales para analizar el desempeño.
              </CardDescription>
            </div>

            {dataLoading ? (
              <Badge variant="secondary" className="w-fit">
                <Icons.spinner className="mr-2 h-3 w-3 animate-spin" />
                Actualizando
              </Badge>
            ) : (
              <Badge variant="outline" className="w-fit">
                Última actualización en vivo
              </Badge>
            )}
          </CardHeader>

          <CardContent className="grid min-w-0 grid-cols-1 gap-3 overflow-hidden p-4 pt-0 sm:gap-4 sm:p-6 sm:pt-0 md:grid-cols-[repeat(3,minmax(0,1fr))]">
            {/* Fechas (1 columna en móvil) */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                Fechas
              </span>

              <div className="flex min-w-0 flex-col gap-2">
                <div className="min-w-0 space-y-1">
                  <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground sm:text-xs">
                    <CalendarDays className="h-3 w-3" />
                    Desde
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-8 w-full max-w-full min-w-0 px-2 text-[11px] appearance-none sm:h-9 sm:w-[140px] sm:px-3 sm:text-sm"
                      aria-label="Fecha de inicio"
                    />
                  </div>
                </div>

                <div className="min-w-0 space-y-1">
                  <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground sm:text-xs">
                    <CalendarCheck className="h-3 w-3" />
                    Hasta
                  </span>
                  <div className="min-w-0 overflow-hidden">
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="h-8 w-full max-w-full min-w-0 px-2 text-[11px] appearance-none sm:h-9 sm:w-[140px] sm:px-3 sm:text-sm"
                      aria-label="Fecha de fin"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Ubicación */}
            <div className="space-y-1">
              <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <MapPin className="h-4 w-4" />
                Ubicación
              </span>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="min-w-0 w-full max-w-full h-8 px-2 text-[11px] sm:h-9 sm:w-[220px] sm:px-3 sm:text-sm">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {locationOptions.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Departamento */}
            <div className="space-y-1">
              <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Workflow className="h-4 w-4" />
                Departamento
              </span>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger className="min-w-0 w-full max-w-full h-8 px-2 text-[11px] sm:h-9 sm:w-[220px] sm:px-3 sm:text-sm">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Exportación */}
        <Card>
          <CardHeader className="gap-2 p-4 sm:p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-base sm:text-lg">Exportación</CardTitle>
              <CardDescription className="mt-1 sm:mt-2">
                Descarga un CSV con incidencias, tareas y preventivos según los filtros actuales.
              </CardDescription>
            </div>

            <Button
              onClick={handleExport}
              disabled={isExporting || dataLoading || exportBlocked}
              className="w-fit px-4"
            >
              {isExporting ? (
                <>
                  <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                  Generando
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Descargar
                </>
              )}
            </Button>
          </CardHeader>

          <CardContent className="grid min-w-0 grid-cols-1 gap-3 p-4 pt-0 sm:gap-4 sm:p-6 sm:pt-0 md:grid-cols-[repeat(3,minmax(0,1fr))]">
            {exportBlocked ? (
              <div className="md:col-span-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">Exportación bloqueada</p>
                    <p className="text-xs text-amber-100/90">
                      Tu plan actual no incluye exportaciones. Actualiza tu plan para habilitar esta función.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => router.push('/plans')}>
                    Ver planes
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground">Rango aplicado</span>
              <p className="text-sm text-foreground">
                {startDate || endDate
                  ? `${startDate || 'Inicio'} → ${endDate || 'Hoy'}`
                  : 'Sin filtro de fechas'}
              </p>
              <p className="text-xs text-muted-foreground">
                Usa el rango global de fechas para limitar la exportación.
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground">Orden por creación</span>
              <Select value={exportSortOrder} onValueChange={setExportSortOrder}>
                <SelectTrigger className="min-w-0 w-full max-w-full h-8 px-2 text-[11px] sm:h-9 sm:w-[220px] sm:px-3 sm:text-sm">
                  <SelectValue placeholder="Selecciona orden" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Más recientes primero</SelectItem>
                  <SelectItem value="asc">Más antiguos primero</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground">Registros incluidos</span>
              <p className="text-sm text-foreground">{exportRows.length} elementos</p>
              <p className="text-xs text-muted-foreground">
                Incidencias, tareas y preventivos del rango seleccionado.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ✅ KPIs: en móvil SIEMPRE 1 columna; 2 columnas solo desde md */}
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-col gap-2 space-y-0 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Incidencias abiertas
              </CardTitle>
              <Activity className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              <div className="text-2xl font-semibold sm:text-3xl">{metrics.openIncidents}</div>
              <p className="text-xs text-muted-foreground">Incidencias en curso según filtros.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-2 space-y-0 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Incidencias cerradas
              </CardTitle>
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              <div className="text-2xl font-semibold sm:text-3xl">{metrics.closedIncidents}</div>
              <p className="text-xs text-muted-foreground">Cierres completados en el rango.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-2 space-y-0 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tareas pendientes
              </CardTitle>
              <ClipboardList className="h-5 w-5 text-amber-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              <div className="text-2xl font-semibold sm:text-3xl">{metrics.pendingTasks}</div>
              <p className="text-xs text-muted-foreground">Actividades aún sin completar.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-2 space-y-0 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tareas completadas
              </CardTitle>
              <CheckCircle2 className="h-5 w-5 text-sky-500" />
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              <div className="text-2xl font-semibold sm:text-3xl">{metrics.completedTasks}</div>
              <p className="text-xs text-muted-foreground">Tareas resueltas en el rango.</p>
            </CardContent>
          </Card>
        </div>

        {/* Tendencia + MTTR */}
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <LineChartIcon className="h-5 w-5 text-primary" />
                Tendencia de cierres
              </CardTitle>
              <CardDescription>
                Evolución diaria de incidencias cerradas y tareas completadas.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
              <ChartContainer
                className="h-[240px] sm:h-[320px]"
                config={{
                  closedIncidents: { label: 'Incidencias', color: 'hsl(var(--chart-1))' },
                  completedTasks: { label: 'Tareas', color: 'hsl(var(--chart-2))' },
                }}
              >
                <LineChart data={trendData} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                  <Line type="monotone" dataKey="closedIncidents" stroke="var(--color-closedIncidents)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="completedTasks" stroke="var(--color-completedTasks)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Clock className="h-5 w-5 text-primary" />
                MTTR promedio
              </CardTitle>
              <CardDescription>Tiempo medio de resolución basado en cierres.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 sm:p-6 sm:pt-0">
              <div className="text-3xl font-semibold sm:text-4xl">{averageMttrLabel}</div>
              <p className="text-sm text-muted-foreground">
                Calculado con las fechas de creación y cierre disponibles.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Preventivos */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Preventivos y cumplimiento
            </CardTitle>
            <CardDescription>
              Comparativa de preventivos completados en plazo y fuera de plazo.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid min-w-0 grid-cols-1 gap-4 p-4 pt-0 sm:p-6 sm:pt-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Cumplimiento global</span>
                <span className="font-medium text-foreground">{preventiveSummaryLabel}</span>
              </div>

              <ChartContainer
                className="h-[190px] sm:h-[220px]"
                config={{
                  onTime: { label: 'En plazo', color: 'hsl(var(--chart-2))' },
                  late: { label: 'Fuera de plazo', color: 'hsl(var(--chart-5))' },
                }}
              >
                <BarChart data={preventiveSummaryData} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                  <Bar dataKey="onTime" fill="var(--color-onTime)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="late" fill="var(--color-late)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Cumplimiento por plantilla</h3>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {preventiveCompliance.templates.length ? (
                  preventiveCompliance.templates.map((template) => (
                    <div key={template.templateId} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium leading-tight">{template.templateName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            En plazo:{' '}
                            <span className="font-medium text-foreground">{template.onTime}</span>{' '}
                            · Fuera:{' '}
                            <span className="font-medium text-foreground">{template.late}</span>
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {template.complianceRate !== null
                            ? `${template.complianceRate.toFixed(1)}%`
                            : 'Sin datos'}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    No hay preventivos completados con plantilla.
                  </div>
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block w-full max-w-full overflow-x-auto rounded-lg border md:overflow-visible">
                <Table className="w-full min-w-0">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plantilla</TableHead>
                      <TableHead className="text-right">En plazo</TableHead>
                      <TableHead className="text-right">Fuera</TableHead>
                      <TableHead className="text-right">% Cumpl.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preventiveCompliance.templates.length ? (
                      preventiveCompliance.templates.map((template) => (
                        <TableRow key={template.templateId}>
                          <TableCell className="font-medium">{template.templateName}</TableCell>
                          <TableCell className="text-right">{template.onTime}</TableCell>
                          <TableCell className="text-right">{template.late}</TableCell>
                          <TableCell className="text-right">
                            {template.complianceRate !== null
                              ? `${template.complianceRate.toFixed(1)}%`
                              : 'Sin datos'}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center">
                          No hay preventivos completados con plantilla.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Operarios */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Rendimiento por operario</CardTitle>
            <CardDescription>Ranking de cierres por usuario según incidencias y tareas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {operatorRows.length ? (
                operatorRows.map((row) => (
                  <div key={row.userId} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{row.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          MTTR: <span className="font-medium text-foreground">{row.mttrLabel}</span>
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {row.closedCount} cerradas
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No hay cierres en el rango seleccionado.
                </div>
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block w-full max-w-full overflow-x-auto md:overflow-visible">
              <Table className="w-full min-w-0">
                <TableHeader>
                  <TableRow>
                    <TableHead>Operario</TableHead>
                    <TableHead className="text-right">Cerradas</TableHead>
                    <TableHead className="text-right">MTTR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operatorRows.length ? (
                    operatorRows.map((row) => (
                      <TableRow key={row.userId}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="text-right">{row.closedCount}</TableCell>
                        <TableCell className="text-right">{row.mttrLabel}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="h-24 text-center">
                        No hay cierres en el rango seleccionado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Auditoría */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Auditoría</CardTitle>
            <CardDescription>Últimos cierres con acceso directo al informe generado.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {recentClosures.length ? (
                recentClosures.map(({ ticket }) => {
                  const ticketEvents =
                    (ticket as Ticket & { events?: { type?: string }[] | null }).events ?? [];
                  const keyEvents = ticketEvents.filter((event) => {
                    const type = event?.type;
                    return type
                      ? Object.prototype.hasOwnProperty.call(keyEventLabels, type)
                      : false;
                  });

                  return (
                    <div key={ticket.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <Link href={`/incidents/${ticket.id}`} className="font-medium text-primary hover:underline">
                            {ticket.displayId ?? ticket.title}
                          </Link>

                          {keyEvents.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {keyEvents.map((event, index) => (
                                <Badge key={`${ticket.id}-${index}`} variant="secondary">
                                  {keyEventLabels[event.type ?? ''] ?? event.type}
                                </Badge>
                              ))}
                            </div>
                          )}

                          <p className="text-xs text-muted-foreground">
                            Cierre:{' '}
                            <span className="font-medium text-foreground">
                              {formatDateTime(ticket.closedAt)}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Operario:{' '}
                            <span className="font-medium text-foreground">
                              {operatorLabelForTicket(ticket)}
                            </span>
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          {ticket.reportPdfUrl ? (
                            <a
                              href={ticket.reportPdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              Ver PDF
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sin PDF</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No hay cierres recientes para mostrar.
                </div>
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block w-full max-w-full overflow-x-auto md:overflow-visible">
              <Table className="w-full min-w-0">
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Fecha cierre</TableHead>
                    <TableHead>Operario</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentClosures.length ? (
                    recentClosures.map(({ ticket }) => {
                      const ticketEvents =
                        (ticket as Ticket & { events?: { type?: string }[] | null }).events ?? [];
                      const keyEvents = ticketEvents.filter((event) => {
                        const type = event?.type;
                        return type
                          ? Object.prototype.hasOwnProperty.call(keyEventLabels, type)
                          : false;
                      });

                      return (
                        <TableRow key={ticket.id}>
                          <TableCell className="font-medium">
                            <div className="space-y-1">
                              <Link href={`/incidents/${ticket.id}`} className="text-primary hover:underline">
                                {ticket.displayId ?? ticket.title}
                              </Link>
                              {keyEvents.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {keyEvents.map((event, index) => (
                                    <Badge key={`${ticket.id}-${index}`} variant="secondary">
                                      {keyEventLabels[event.type ?? ''] ?? event.type}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{formatDateTime(ticket.closedAt)}</TableCell>
                          <TableCell>{operatorLabelForTicket(ticket)}</TableCell>
                          <TableCell className="text-right">
                            {ticket.reportPdfUrl ? (
                              <a
                                href={ticket.reportPdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                              >
                                Ver PDF
                              </a>
                            ) : (
                              <span className="text-muted-foreground">No disponible</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center">
                        No hay cierres recientes para mostrar.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              El listado prioriza los últimos cierres registrados y muestra eventos clave disponibles en el historial.
            </p>
          </CardContent>
        </Card>

        {/* Incidencias por dept/ubicación */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Incidencias por departamento/ubicación</CardTitle>
            <CardDescription>
              Distribución de incidencias abiertas y cerradas según los filtros globales.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid min-w-0 grid-cols-1 gap-4 p-4 pt-0 sm:p-6 sm:pt-0 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Departamentos con más incidencias
              </h3>

              {departmentIncidents.length ? (
                <ChartContainer
                  className="h-[230px] justify-start sm:h-[280px]"
                  config={{
                    openIncidents: { label: 'Abiertas', color: 'hsl(var(--chart-3))' },
                    closedIncidents: { label: 'Cerradas', color: 'hsl(var(--chart-1))' },
                  }}
                >
                  <BarChart data={departmentIncidents} margin={{ left: 0, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval={isMobile ? 'preserveStartEnd' : 0}
                      minTickGap={isMobile ? 24 : 8}
                      angle={isMobile ? -30 : 0}
                      textAnchor={isMobile ? 'end' : 'middle'}
                      height={isMobile ? 60 : undefined}
                      tickMargin={8}
                      tickFormatter={xTickFormatterMobile}
                    />
                    <YAxis tickLine={false} axisLine={false} tickMargin={2} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                    <Bar dataKey="openIncidents" stackId="incidents" fill="var(--color-openIncidents)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="closedIncidents" stackId="incidents" fill="var(--color-closedIncidents)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No hay incidencias para el rango seleccionado.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Ubicaciones con más incidencias
              </h3>

              {siteIncidents.length ? (
                <ChartContainer
                  className="h-[230px] justify-start sm:h-[280px]"
                  config={{
                    openIncidents: { label: 'Abiertas', color: 'hsl(var(--chart-3))' },
                    closedIncidents: { label: 'Cerradas', color: 'hsl(var(--chart-1))' },
                  }}
                >
                  <BarChart data={siteIncidents} margin={{ left: 0, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval={isMobile ? 'preserveStartEnd' : 0}
                      minTickGap={isMobile ? 24 : 8}
                      angle={isMobile ? -30 : 0}
                      textAnchor={isMobile ? 'end' : 'middle'}
                      height={isMobile ? 60 : undefined}
                      tickMargin={8}
                      tickFormatter={xTickFormatterMobile}
                    />
                    <YAxis tickLine={false} axisLine={false} tickMargin={2} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                    <Bar dataKey="openIncidents" stackId="incidents" fill="var(--color-openIncidents)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="closedIncidents" stackId="incidents" fill="var(--color-closedIncidents)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No hay incidencias para el rango seleccionado.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Partes de trabajo */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Partes de trabajo (próximamente)</CardTitle>
            <CardDescription>
              Consolidaremos los partes de trabajo para visualizar horas y costes imputados por activo y departamento.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="p-4 sm:p-6">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clock className="h-4 w-4 text-primary" />
                    Horas imputadas
                  </CardTitle>
                  <CardDescription>Totales y desglose por operario, activo y periodo.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    En desarrollo
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 sm:p-6">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Coins className="h-4 w-4 text-primary" />
                    Coste por activo/departamento
                  </CardTitle>
                  <CardDescription>Comparativa de costes directos e indirectos imputados.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    En desarrollo
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-lg border border-dashed bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Badge variant="secondary">En desarrollo</Badge>
                Roadmap corto
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>Integración de partes de trabajo con activos y centros de coste.</li>
                <li>Cálculo de horas imputadas y costes por departamento.</li>
                <li>Visualizaciones comparativas por periodos y filtros globales.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
