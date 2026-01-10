'use client';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { useCollection, useUser } from '@/lib/firebase';
import type { Ticket, Department, Site, User } from '@/lib/firebase/models';
import type { MaintenanceTask } from '@/types/maintenance-task';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  CheckCircle2,
  Clock,
  ClipboardList,
  LineChart as LineChartIcon,
  MapPin,
  Workflow,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
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

export default function ReportsPage() {
  const { user, loading } = useUser();
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const { data: tickets = [], loading: ticketsLoading } =
    useCollection<Ticket>('tickets');
  const { data: tasks = [], loading: tasksLoading } =
    useCollection<MaintenanceTask>('tasks');
  const { data: departments = [], loading: departmentsLoading } =
    useCollection<Department>('departments');
  const { data: sites = [], loading: sitesLoading } =
    useCollection<Site>('sites');
  const { data: users = [], loading: usersLoading } =
    useCollection<User>('users');

  if (loading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

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

  const locationOptions = useMemo(() => {
    const locationSet = new Set<string>();
    sites.forEach((site) => locationSet.add(site.name));
    tasks.forEach((task) => {
      if (task.location) locationSet.add(task.location);
    });
    return Array.from(locationSet).sort((a, b) => a.localeCompare(b));
  }, [sites, tasks]);

  const filters: MetricsFilters = {
    startDate: startDate ? new Date(`${startDate}T00:00:00`) : null,
    endDate: endDate ? new Date(`${endDate}T23:59:59`) : null,
    location: locationFilter === 'all' ? undefined : locationFilter,
    departmentId: departmentFilter === 'all' ? undefined : departmentFilter,
  };

  const filteredTickets = useMemo(
    () => filterTickets(tickets, filters, siteNameById),
    [tickets, filters, siteNameById]
  );
  const filteredTasks = useMemo(
    () => filterTasks(tasks, filters),
    [tasks, filters]
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
    return users.reduce((acc, user) => {
      acc.set(user.id, user);
      return acc;
    }, new Map<string, User>());
  }, [users]);

  const trendData = useMemo(
    () => buildTrendData(filteredTickets, filteredTasks, filters),
    [filteredTickets, filteredTasks, filters]
  );

  const departmentIncidents = useMemo(
    () => buildIncidentGrouping(filteredTickets, 'departmentId', departmentNameById),
    [filteredTickets, departmentNameById]
  );

  const siteIncidents = useMemo(
    () => buildIncidentGrouping(filteredTickets, 'siteId', siteNameById),
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
    usersLoading;

  const operatorRows = operatorPerformance.map((entry) => {
    const user = usersById.get(entry.userId);
    return {
      ...entry,
      label: user?.displayName ?? user?.email ?? entry.userId,
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

  return (
    <AppShell
      title="Informes"
      description="Genera y visualiza informes detallados del mantenimiento."
    >
      <div className="space-y-6">
        <Card>
          <CardHeader className="gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Panel de métricas</CardTitle>
              <CardDescription className="mt-2">
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
          <CardContent className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))]">
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground">
                Rango de fechas
              </span>
              <div className="flex flex-col gap-2 md:flex-row">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <MapPin className="h-4 w-4" />
                Ubicación
              </span>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger>
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
            <div className="space-y-1">
              <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Workflow className="h-4 w-4" />
                Departamento
              </span>
              <Select
                value={departmentFilter}
                onValueChange={setDepartmentFilter}
              >
                <SelectTrigger>
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

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Incidencias abiertas
              </CardTitle>
              <Activity className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{metrics.openIncidents}</div>
              <p className="text-xs text-muted-foreground">
                Incidencias en curso según filtros.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Incidencias cerradas
              </CardTitle>
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{metrics.closedIncidents}</div>
              <p className="text-xs text-muted-foreground">
                Cierres completados en el rango.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tareas pendientes
              </CardTitle>
              <ClipboardList className="h-5 w-5 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{metrics.pendingTasks}</div>
              <p className="text-xs text-muted-foreground">
                Actividades aún sin completar.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tareas completadas
              </CardTitle>
              <CheckCircle2 className="h-5 w-5 text-sky-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{metrics.completedTasks}</div>
              <p className="text-xs text-muted-foreground">
                Tareas resueltas en el rango.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LineChartIcon className="h-5 w-5 text-primary" />
                Tendencia de cierres
              </CardTitle>
              <CardDescription>
                Evolución diaria de incidencias cerradas y tareas completadas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                className="h-[320px]"
                config={{
                  closedIncidents: { label: "Incidencias", color: "hsl(var(--chart-1))" },
                  completedTasks: { label: "Tareas", color: "hsl(var(--chart-2))" },
                }}
              >
                <LineChart data={trendData} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="line" />}
                  />
                  <Line
                    type="monotone"
                    dataKey="closedIncidents"
                    stroke="var(--color-closedIncidents)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="completedTasks"
                    stroke="var(--color-completedTasks)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                MTTR promedio
              </CardTitle>
              <CardDescription>
                Tiempo medio de resolución basado en cierres.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-4xl font-semibold">{averageMttrLabel}</div>
              <p className="text-sm text-muted-foreground">
                Calculado con las fechas de creación y cierre disponibles.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Preventivos y cumplimiento
            </CardTitle>
            <CardDescription>
              Comparativa de preventivos completados en plazo y fuera de plazo.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Cumplimiento global</span>
                <span className="font-medium text-foreground">
                  {preventiveSummaryLabel}
                </span>
              </div>
              <ChartContainer
                className="h-[220px]"
                config={{
                  onTime: { label: 'En plazo', color: 'hsl(var(--chart-2))' },
                  late: { label: 'Fuera de plazo', color: 'hsl(var(--chart-5))' },
                }}
              >
                <BarChart
                  data={preventiveSummaryData}
                  margin={{ left: 12, right: 12 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <Bar
                    dataKey="onTime"
                    fill="var(--color-onTime)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="late"
                    fill="var(--color-late)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Cumplimiento por plantilla
              </h3>
              <div className="rounded-lg border">
                <Table>
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
                          <TableCell className="font-medium">
                            {template.templateName}
                          </TableCell>
                          <TableCell className="text-right">
                            {template.onTime}
                          </TableCell>
                          <TableCell className="text-right">
                            {template.late}
                          </TableCell>
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

        <Card>
          <CardHeader>
            <CardTitle>Rendimiento por operario</CardTitle>
            <CardDescription>
              Ranking de cierres por usuario según incidencias y tareas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operario</TableHead>
                  <TableHead className="text-right">Cerradas</TableHead>
                  <TableHead className="text-right">MTTR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operatorRows.length > 0 ? (
                  operatorRows.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right">
                        {row.closedCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.mttrLabel}
                      </TableCell>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Incidencias por departamento/ubicación</CardTitle>
            <CardDescription>
              Distribución de incidencias abiertas y cerradas según los filtros globales.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Departamentos con más incidencias
                </h3>
              </div>
              {departmentIncidents.length ? (
                <ChartContainer
                  className="h-[280px]"
                  config={{
                    openIncidents: {
                      label: "Abiertas",
                      color: "hsl(var(--chart-3))",
                    },
                    closedIncidents: {
                      label: "Cerradas",
                      color: "hsl(var(--chart-1))",
                    },
                  }}
                >
                  <BarChart data={departmentIncidents} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tickMargin={8}
                    />
                    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent indicator="dot" />}
                    />
                    <Bar
                      dataKey="openIncidents"
                      stackId="incidents"
                      fill="var(--color-openIncidents)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="closedIncidents"
                      stackId="incidents"
                      fill="var(--color-closedIncidents)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No hay incidencias para el rango seleccionado.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Ubicaciones con más incidencias
                </h3>
              </div>
              {siteIncidents.length ? (
                <ChartContainer
                  className="h-[280px]"
                  config={{
                    openIncidents: {
                      label: "Abiertas",
                      color: "hsl(var(--chart-3))",
                    },
                    closedIncidents: {
                      label: "Cerradas",
                      color: "hsl(var(--chart-1))",
                    },
                  }}
                >
                  <BarChart data={siteIncidents} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tickMargin={8}
                    />
                    <YAxis tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent indicator="dot" />}
                    />
                    <Bar
                      dataKey="openIncidents"
                      stackId="incidents"
                      fill="var(--color-openIncidents)"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="closedIncidents"
                      stackId="incidents"
                      fill="var(--color-closedIncidents)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No hay incidencias para el rango seleccionado.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
