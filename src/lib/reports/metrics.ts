import type { Timestamp } from "firebase/firestore";
import type { Ticket } from "@/lib/firebase/models";
import type { MaintenanceTask } from "@/types/maintenance-task";
import { normalizeTaskStatus, normalizeTicketStatus } from "@/lib/status";

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

export type PreventiveCompliance = {
  onTime: number;
  late: number;
  total: number;
  complianceRate: number | null;
};

export type PreventiveTemplateCompliance = {
  templateId: string;
  templateName: string;
  onTime: number;
  late: number;
  total: number;
  complianceRate: number | null;
};

export type PreventiveComplianceResult = {
  summary: PreventiveCompliance;
  templates: PreventiveTemplateCompliance[];
};

export type OperatorPerformance = {
  userId: string;
  closedCount: number;
  averageMttrHours: number | null;
};

export type TrendDatum = {
  date: string;
  closedIncidents: number;
  completedTasks: number;
};

export type IncidentGrouping = {
  id: string;
  label: string;
  openIncidents: number;
  closedIncidents: number;
  total: number;
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

const resolveReportAuthor = (
  reports?: { createdBy?: string }[] | null
) => {
  if (!reports?.length) return null;
  const report = [...reports].reverse().find((entry) => entry.createdBy);
  return report?.createdBy ?? null;
};

export const filterTickets = (
  tickets: Ticket[],
  filters: MetricsFilters,
  siteNameById: Record<string, string>
) => {
  return tickets.filter((ticket) => {
    const locationMatch =
      !filters.location ||
      siteNameById[ticket.locationId ?? ticket.siteId ?? ''] === filters.location;
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
      !filters.location ||
      (task.targetDepartmentId ?? task.originDepartmentId) === filters.location;
    const dateMatch = isWithinRange(toDate(task.closedAt ?? task.createdAt), filters);

    return locationMatch && dateMatch;
  });
};

export const calculateReportMetrics = (
  tickets: Ticket[],
  tasks: MaintenanceTask[]
): ReportMetrics => {
  const openIncidents = tickets.filter((ticket) => normalizeTicketStatus(ticket.status) !== "resolved").length;
  const closedIncidents = tickets.filter((ticket) => normalizeTicketStatus(ticket.status) === "resolved").length;
  const pendingTasks = tasks.filter((task) => normalizeTaskStatus(task.status) !== "done").length;
  const completedTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === "done").length;

  const mttrSamples = [
    ...tickets
      .filter((ticket) => normalizeTicketStatus(ticket.status) === "resolved")
      .map((ticket) => ({
        start: toDate(ticket.createdAt),
        end: toDate(ticket.closedAt),
      })),
    ...tasks
      .filter((task) => normalizeTaskStatus(task.status) === "done")
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

export const buildOperatorPerformance = (
  tickets: Ticket[],
  tasks: MaintenanceTask[]
): OperatorPerformance[] => {
  const summary = new Map<
    string,
    { closedCount: number; mttrSamples: number[] }
  >();

  const register = (
    userId: string | null,
    createdAt?: Timestamp | Date | null,
    closedAt?: Timestamp | Date | null
  ) => {
    if (!userId) return;
    const entry = summary.get(userId) ?? { closedCount: 0, mttrSamples: [] };
    entry.closedCount += 1;
    const start = toDate(createdAt);
    const end = toDate(closedAt);
    if (start && end) {
      entry.mttrSamples.push((end.getTime() - start.getTime()) / 3600000);
    }
    summary.set(userId, entry);
  };

  tickets
    .filter((ticket) => normalizeTicketStatus(ticket.status) === "resolved")
    .forEach((ticket) => {
      const userId = ticket.assignedTo ?? resolveReportAuthor(ticket.reports);
      register(userId, ticket.createdAt, ticket.closedAt);
    });

  tasks
    .filter((task) => normalizeTaskStatus(task.status) === "done")
    .forEach((task) => {
      const userId = task.assignedTo ?? resolveReportAuthor(task.reports);
      register(userId, task.createdAt, task.closedAt);
    });

  return Array.from(summary.entries())
    .map(([userId, data]) => ({
      userId,
      closedCount: data.closedCount,
      averageMttrHours: data.mttrSamples.length
        ? data.mttrSamples.reduce((sum, value) => sum + value, 0) /
          data.mttrSamples.length
        : null,
    }))
    .sort((a, b) => {
      if (b.closedCount !== a.closedCount) {
        return b.closedCount - a.closedCount;
      }
      if (a.averageMttrHours === null && b.averageMttrHours === null) {
        return 0;
      }
      if (a.averageMttrHours === null) return 1;
      if (b.averageMttrHours === null) return -1;
      return a.averageMttrHours - b.averageMttrHours;
    });
};

export const calculatePreventiveCompliance = (
  tickets: Ticket[]
): PreventiveComplianceResult => {
  const summary: PreventiveCompliance = {
    onTime: 0,
    late: 0,
    total: 0,
    complianceRate: null,
  };

  const templateSummary = new Map<
    string,
    { templateName: string; onTime: number; late: number }
  >();

  const completedPreventives = tickets.filter(
    (ticket) => ticket.type === "preventivo" && (normalizeTicketStatus(ticket.status) === "resolved" || ticket.closedAt)
  );

  completedPreventives.forEach((ticket) => {
    const closedAt = toDate(ticket.closedAt);
    const scheduledFor = toDate(ticket.preventive?.scheduledFor);
    if (!closedAt || !scheduledFor) return;

    const isOnTime = closedAt <= endOfDay(scheduledFor);
    if (isOnTime) {
      summary.onTime += 1;
    } else {
      summary.late += 1;
    }
    summary.total += 1;

    const templateId = ticket.preventiveTemplateId ?? ticket.templateId;
    if (!templateId) return;

    const existing = templateSummary.get(templateId) ?? {
      templateName: ticket.templateSnapshot?.name ?? templateId,
      onTime: 0,
      late: 0,
    };

    if (isOnTime) {
      existing.onTime += 1;
    } else {
      existing.late += 1;
    }
    templateSummary.set(templateId, existing);
  });

  summary.complianceRate = summary.total
    ? (summary.onTime / summary.total) * 100
    : null;

  const templates = Array.from(templateSummary.entries())
    .map(([templateId, data]) => {
      const total = data.onTime + data.late;
      return {
        templateId,
        templateName: data.templateName,
        onTime: data.onTime,
        late: data.late,
        total,
        complianceRate: total ? (data.onTime / total) * 100 : null,
      };
    })
    .sort((a, b) => {
      if (b.complianceRate === null && a.complianceRate === null) return 0;
      if (b.complianceRate === null) return -1;
      if (a.complianceRate === null) return 1;
      return b.complianceRate - a.complianceRate;
    });

  return { summary, templates };
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
    .filter((ticket) => normalizeTicketStatus(ticket.status) === "resolved")
    .forEach((ticket) => {
      const closedAt = toDate(ticket.closedAt);
      if (!closedAt) return;
      const key = dateKey(closedAt);
      if (buckets[key]) {
        buckets[key].closedIncidents += 1;
      }
    });

  tasks
    .filter((task) => normalizeTaskStatus(task.status) === "done")
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

export const buildIncidentGrouping = (
  tickets: Ticket[],
  groupingKey: "departmentId" | "siteId" | "locationId",
  labelById: Record<string, string>
): IncidentGrouping[] => {
  const summary = new Map<
    string,
    { label: string; openIncidents: number; closedIncidents: number }
  >();

  tickets.forEach((ticket) => {
    const id =
      groupingKey === "locationId"
        ? ticket.locationId ?? ticket.siteId
        : ticket[groupingKey];
    if (!id) return;
    const label = labelById[id] ?? id;
    const current = summary.get(id) ?? {
      label,
      openIncidents: 0,
      closedIncidents: 0,
    };
    if (normalizeTicketStatus(ticket.status) === "resolved") {
      current.closedIncidents += 1;
    } else {
      current.openIncidents += 1;
    }
    summary.set(id, current);
  });

  return Array.from(summary.entries())
    .map(([id, data]) => ({
      id,
      label: data.label,
      openIncidents: data.openIncidents,
      closedIncidents: data.closedIncidents,
      total: data.openIncidents + data.closedIncidents,
    }))
    .sort((a, b) => b.total - a.total);
};
