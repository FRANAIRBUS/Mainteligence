import type { Timestamp } from "firebase/firestore";
import type { Ticket } from "@/lib/firebase/models";
import type { MaintenanceTask } from "@/types/maintenance-task";

export type MetricsFilters = {
  startDate?: Date | null;
  endDate?: Date | null;
  location?: string;
  departmentId?: string;
};

export type ReportMetrics = {
  openIncidents: number;
  closedIncidents: number;
  pendingTasks: number;
  completedTasks: number;
  averageMttrHours: number | null;
};

export type TrendDatum = {
  date: string;
  closedIncidents: number;
  completedTasks: number;
};

const toDate = (value?: Timestamp | Date | null) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  return value.toDate?.() ?? null;
};

const isWithinRange = (date: Date | null, filters: MetricsFilters) => {
  if (!filters.startDate && !filters.endDate) return true;
  if (!date) return false;

  const start = filters.startDate ? startOfDay(filters.startDate) : null;
  const end = filters.endDate ? endOfDay(filters.endDate) : null;

  if (start && date < start) return false;
  if (end && date > end) return false;

  return true;
};

const startOfDay = (value: Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value: Date) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const dateKey = (value: Date) => value.toISOString().split("T")[0];

export const filterTickets = (
  tickets: Ticket[],
  filters: MetricsFilters,
  siteNameById: Record<string, string>
) => {
  return tickets.filter((ticket) => {
    const locationMatch =
      !filters.location || siteNameById[ticket.siteId] === filters.location;
    const departmentMatch =
      !filters.departmentId || ticket.departmentId === filters.departmentId;
    const dateMatch = isWithinRange(
      toDate(ticket.closedAt ?? ticket.createdAt),
      filters
    );

    return locationMatch && departmentMatch && dateMatch;
  });
};

export const filterTasks = (tasks: MaintenanceTask[], filters: MetricsFilters) => {
  return tasks.filter((task) => {
    const locationMatch =
      !filters.location || task.location === filters.location;
    const dateMatch = isWithinRange(toDate(task.closedAt ?? task.createdAt), filters);

    return locationMatch && dateMatch;
  });
};

export const calculateReportMetrics = (
  tickets: Ticket[],
  tasks: MaintenanceTask[]
): ReportMetrics => {
  const openIncidents = tickets.filter((ticket) => ticket.status !== "Cerrada").length;
  const closedIncidents = tickets.filter((ticket) => ticket.status === "Cerrada").length;
  const pendingTasks = tasks.filter((task) => task.status !== "completada").length;
  const completedTasks = tasks.filter((task) => task.status === "completada").length;

  const mttrSamples = [
    ...tickets
      .filter((ticket) => ticket.status === "Cerrada")
      .map((ticket) => ({
        start: toDate(ticket.createdAt),
        end: toDate(ticket.closedAt),
      })),
    ...tasks
      .filter((task) => task.status === "completada")
      .map((task) => ({
        start: toDate(task.createdAt),
        end: toDate(task.closedAt),
      })),
  ]
    .filter((sample) => sample.start && sample.end)
    .map((sample) => (sample.end!.getTime() - sample.start!.getTime()) / 3600000);

  const averageMttrHours = mttrSamples.length
    ? mttrSamples.reduce((sum, value) => sum + value, 0) / mttrSamples.length
    : null;

  return {
    openIncidents,
    closedIncidents,
    pendingTasks,
    completedTasks,
    averageMttrHours,
  };
};

export const buildTrendData = (
  tickets: Ticket[],
  tasks: MaintenanceTask[],
  filters: MetricsFilters
): TrendDatum[] => {
  const end = filters.endDate ? endOfDay(filters.endDate) : endOfDay(new Date());
  const start = filters.startDate
    ? startOfDay(filters.startDate)
    : new Date(end.getTime() - 13 * 24 * 60 * 60 * 1000);

  const rangeDays: string[] = [];
  const cursor = startOfDay(start);

  while (cursor <= end) {
    rangeDays.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const buckets = rangeDays.reduce<Record<string, TrendDatum>>((acc, day) => {
    acc[day] = { date: day, closedIncidents: 0, completedTasks: 0 };
    return acc;
  }, {});

  tickets
    .filter((ticket) => ticket.status === "Cerrada")
    .forEach((ticket) => {
      const closedAt = toDate(ticket.closedAt);
      if (!closedAt) return;
      const key = dateKey(closedAt);
      if (buckets[key]) {
        buckets[key].closedIncidents += 1;
      }
    });

  tasks
    .filter((task) => task.status === "completada")
    .forEach((task) => {
      const closedAt = toDate(task.closedAt);
      if (!closedAt) return;
      const key = dateKey(closedAt);
      if (buckets[key]) {
        buckets[key].completedTasks += 1;
      }
    });

  return rangeDays.map((day) => buckets[day]);
};
