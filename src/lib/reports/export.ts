import type { Timestamp } from 'firebase/firestore';
import type { Department, Site, Ticket, OrganizationMember } from '@/lib/firebase/models';
import type { MaintenanceTask } from '@/types/maintenance-task';

export type ExportSortOrder = 'asc' | 'desc';

export type ReportExportFilters = {
  startDate?: Date | null;
  endDate?: Date | null;
  location?: string;
  departmentId?: string;
};

export type ReportExportRow = {
  recordType: string;
  recordId: string;
  displayId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  department: string;
  location: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  createdBy: string;
  assignedTo: string;
  closedBy: string;
  closureReason: string;
  reportsCount: number;
  reports: string;
  lastReportAt: string;
  reportPdfUrl: string;
};

type ExportHeader = { key: keyof ReportExportRow; label: string };

const EXPORT_HEADERS: ExportHeader[] = [
  { key: 'recordType', label: 'Tipo' },
  { key: 'recordId', label: 'ID interno' },
  { key: 'displayId', label: 'ID visible' },
  { key: 'title', label: 'Título' },
  { key: 'description', label: 'Descripción' },
  { key: 'status', label: 'Estado' },
  { key: 'priority', label: 'Prioridad' },
  { key: 'department', label: 'Departamento' },
  { key: 'location', label: 'Ubicación' },
  { key: 'createdAt', label: 'Creado el' },
  { key: 'updatedAt', label: 'Actualizado el' },
  { key: 'closedAt', label: 'Cerrado el' },
  { key: 'createdBy', label: 'Creado por' },
  { key: 'assignedTo', label: 'Asignado a' },
  { key: 'closedBy', label: 'Cerrado por' },
  { key: 'closureReason', label: 'Motivo de cierre' },
  { key: 'reportsCount', label: 'Nº seguimientos' },
  { key: 'reports', label: 'Seguimientos' },
  { key: 'lastReportAt', label: 'Último seguimiento' },
  { key: 'reportPdfUrl', label: 'Informe PDF' },
];

const toDate = (value?: Timestamp | Date | null) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  return value.toDate?.() ?? null;
};

const formatTimestamp = (value?: Timestamp | Date | null) => {
  const date = toDate(value);
  return date ? date.toISOString() : '';
};

const resolveUserLabel = (usersById: Map<string, OrganizationMember>, userId?: string | null) => {
  if (!userId) return '';
  const user = usersById.get(userId);
  return user?.displayName ?? user?.email ?? userId;
};

const resolveDepartmentLabel = (
  departmentsById: Map<string, Department>,
  departmentId?: string | null
) => {
  if (!departmentId) return '';
  const department = departmentsById.get(departmentId);
  return department?.name ?? departmentId;
};

const resolveSiteLabel = (sitesById: Map<string, Site>, siteId?: string | null) => {
  if (!siteId) return '';
  const site = sitesById.get(siteId);
  return site?.name ?? siteId;
};

const formatReports = (
  reports: { description?: string; createdBy?: string; createdAt?: Timestamp | Date | null }[] | undefined,
  usersById: Map<string, OrganizationMember>
) => {
  if (!reports?.length) return { details: '', lastReportAt: '' };

  const sorted = [...reports].sort((a, b) => {
    const aTime = toDate(a.createdAt)?.getTime() ?? 0;
    const bTime = toDate(b.createdAt)?.getTime() ?? 0;
    return aTime - bTime;
  });

  const details = sorted
    .map((report) => {
      const author = resolveUserLabel(usersById, report.createdBy);
      const timestamp = formatTimestamp(report.createdAt);
      const description = report.description?.replace(/\s+/g, ' ').trim() ?? '';
      const header = [timestamp, author].filter(Boolean).join(' - ');
      if (!header) return description;
      return description ? `${header}: ${description}` : header;
    })
    .filter(Boolean)
    .join(' | ');

  const lastReport = sorted[sorted.length - 1];
  const lastReportAt = formatTimestamp(lastReport?.createdAt);

  return { details, lastReportAt };
};

const isWithinRange = (value: Date | null, filters: ReportExportFilters) => {
  if (!filters.startDate && !filters.endDate) return true;
  if (!value) return false;
  const time = value.getTime();
  if (filters.startDate && time < filters.startDate.getTime()) return false;
  if (filters.endDate && time > filters.endDate.getTime()) return false;
  return true;
};

export type BuildReportExportInput = {
  tickets: Ticket[];
  tasks: MaintenanceTask[];
  usersById: Map<string, OrganizationMember>;
  departmentsById: Map<string, Department>;
  sitesById: Map<string, Site>;
  filters: ReportExportFilters;
  sortOrder: ExportSortOrder;
};

export const buildReportExportRows = ({
  tickets,
  tasks,
  usersById,
  departmentsById,
  sitesById,
  filters,
  sortOrder,
}: BuildReportExportInput): ReportExportRow[] => {
  const rows: ReportExportRow[] = [];

  tickets.forEach((ticket) => {
    const createdAt = toDate(ticket.createdAt);
    const location = resolveSiteLabel(sitesById, ticket.siteId);
    const department = resolveDepartmentLabel(departmentsById, ticket.departmentId);
    const locationMatch = !filters.location || location === filters.location;
    const departmentMatch =
      !filters.departmentId || ticket.departmentId === filters.departmentId;

    if (!locationMatch || !departmentMatch || !isWithinRange(createdAt, filters)) {
      return;
    }

    const { details, lastReportAt } = formatReports(ticket.reports, usersById);

    rows.push({
      recordType: ticket.type === 'preventivo' ? 'Preventivo' : 'Incidencia',
      recordId: ticket.id,
      displayId: ticket.displayId ?? '',
      title: ticket.title ?? '',
      description: ticket.description ?? '',
      status: ticket.status ?? '',
      priority: ticket.priority ?? '',
      department,
      location,
      createdAt: formatTimestamp(ticket.createdAt),
      updatedAt: formatTimestamp(ticket.updatedAt),
      closedAt: formatTimestamp(ticket.closedAt),
      createdBy: resolveUserLabel(usersById, ticket.createdBy),
      assignedTo: resolveUserLabel(usersById, ticket.assignedTo ?? undefined),
      closedBy: resolveUserLabel(usersById, ticket.closedBy),
      closureReason: ticket.closedReason ?? '',
      reportsCount: ticket.reports?.length ?? 0,
      reports: details,
      lastReportAt,
      reportPdfUrl: ticket.reportPdfUrl ?? '',
    });
  });

  tasks.forEach((task) => {
    const createdAt = toDate(task.createdAt ?? null);
    const location = task.location ?? '';
    const locationMatch = !filters.location || location === filters.location;
    const isInRange = isWithinRange(createdAt, filters);

    if (!locationMatch || !isInRange) {
      return;
    }

    const fallbackUserId = task.assignedTo ?? task.createdBy;
    const departmentId = fallbackUserId
      ? usersById.get(fallbackUserId)?.departmentId
      : undefined;
    const department = resolveDepartmentLabel(departmentsById, departmentId);

    const { details, lastReportAt } = formatReports(task.reports, usersById);

    rows.push({
      recordType: 'Tarea',
      recordId: task.id ?? '',
      displayId: '',
      title: task.title ?? '',
      description: task.description ?? '',
      status: task.status ?? '',
      priority: task.priority ?? '',
      department,
      location,
      createdAt: formatTimestamp(task.createdAt ?? null),
      updatedAt: formatTimestamp(task.updatedAt ?? null),
      closedAt: formatTimestamp(task.closedAt ?? null),
      createdBy: resolveUserLabel(usersById, task.createdBy),
      assignedTo: resolveUserLabel(usersById, task.assignedTo),
      closedBy: resolveUserLabel(usersById, task.closedBy),
      closureReason: task.closedReason ?? '',
      reportsCount: task.reports?.length ?? 0,
      reports: details,
      lastReportAt,
      reportPdfUrl: '',
    });
  });

  rows.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
  });

  return rows;
};

const escapeCsvValue = (value: string | number) => {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

export const buildReportCsv = (rows: ReportExportRow[]) => {
  const headerLine = EXPORT_HEADERS.map((header) => header.label).join(',');
  const rowLines = rows.map((row) =>
    EXPORT_HEADERS.map((header) =>
      escapeCsvValue(row[header.key] ?? '')
    ).join(',')
  );
  return [headerLine, ...rowLines].join('\n');
};

export const getReportExportHeaders = () => EXPORT_HEADERS;
