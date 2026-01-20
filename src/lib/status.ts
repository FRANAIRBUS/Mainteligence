export type TicketStatus =
  | 'new'
  | 'in_progress'
  | 'resolved'
  | 'canceled'
  | 'assigned'
  | 'closed'
  | 'waiting_parts'
  | 'waiting_external'
  | 'reopened'
  | 'Abierta'
  | 'En curso'
  | 'En espera'
  | 'Resuelta'
  | 'Cierre solicitado'
  | 'Cerrada';

export type TaskStatus =
  | 'open'
  | 'in_progress'
  | 'done'
  | 'canceled'
  | 'validated'
  | 'blocked'
  | 'pendiente'
  | 'en_progreso'
  | 'completada';

export const normalizeTicketStatus = (status?: string | null): TicketStatus => {
  const value = String(status ?? '').trim();
  switch (value) {
    case 'Abierta':
      return 'new';
    case 'En curso':
      return 'in_progress';
    case 'En espera':
      return 'in_progress';
    case 'Resuelta':
      return 'resolved';
    case 'Cierre solicitado':
      return 'in_progress';
    case 'Cerrada':
      return 'resolved';
    default:
      return value as TicketStatus;
  }
};

export const normalizeTaskStatus = (status?: string | null): TaskStatus => {
  const value = String(status ?? '').trim();
  switch (value) {
    case 'pendiente':
      return 'open';
    case 'en_progreso':
      return 'in_progress';
    case 'completada':
      return 'done';
    default:
      return value as TaskStatus;
  }
};

export const ticketStatusLabel = (status?: string | null): string => {
  switch (normalizeTicketStatus(status)) {
    case 'new':
      return 'Nueva';
    case 'in_progress':
      return 'En progreso';
    case 'resolved':
      return 'Resuelta';
    case 'canceled':
      return 'Cancelada';
    case 'assigned':
      return 'Asignada';
    case 'closed':
      return 'Cerrada';
    case 'waiting_parts':
      return 'En espera de repuestos';
    case 'waiting_external':
      return 'En espera externa';
    case 'reopened':
      return 'Reabierta';
    default:
      return 'Pendiente';
  }
};

export const taskStatusLabel = (status?: string | null): string => {
  switch (normalizeTaskStatus(status)) {
    case 'open':
      return 'Abierta';
    case 'in_progress':
      return 'En progreso';
    case 'done':
      return 'Completada';
    case 'canceled':
      return 'Cancelada';
    case 'validated':
      return 'Validada';
    case 'blocked':
      return 'Bloqueada';
    default:
      return 'Pendiente';
  }
};
