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
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  buildTrendData,
  buildOperatorPerformance,
  calculateReportMetrics,
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
      </div>
    </AppShell>
  );
}
