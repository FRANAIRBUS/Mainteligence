import type { Ticket, User, UserRole } from '@/lib/firebase/models';

export const normalizeRole = (role?: UserRole) => {
  if (!role) return role;
  if (role === 'operario') return 'operator';
  if (role === 'mantenimiento') return 'maintenance';
  return role;
};

type DepartmentScope = { departmentId?: string; departmentIds?: string[] };

export type TicketPermission = {
  canView: boolean;
  canAssign: boolean;
  canAssignToSelf: boolean;
  canChangeDepartment: boolean;
  canChangePriority: boolean;
  canChangeStatus: boolean;
  canRequestClosure: boolean;
  canClose: boolean;
  canReopen: boolean;
};

const getTicketOrigin = (ticket: Ticket) => ticket.originDepartmentId ?? ticket.departmentId;
const getTicketTarget = (ticket: Ticket) => ticket.targetDepartmentId ?? ticket.departmentId;

const isInScope = (ticket: Ticket, scope: DepartmentScope) => {
  const origin = getTicketOrigin(ticket);
  const target = getTicketTarget(ticket);
  const list = scope.departmentIds ?? [];
  return (
    (!!scope.departmentId && (origin === scope.departmentId || target === scope.departmentId)) ||
    (list.length > 0 && (list.includes(origin ?? '') || list.includes(target ?? '')))
  );
};

export function getTicketPermissions(ticket: Ticket, user: User | null, userId: string | null): TicketPermission {
  const role = normalizeRole(user?.role);
  const isCreator = !!userId && ticket.createdBy === userId;
  const isAssignee = !!userId && ticket.assignedTo === userId;

  if (!userId || !role) {
    return {
      canView: false,
      canAssign: false,
      canAssignToSelf: false,
      canChangeDepartment: false,
      canChangePriority: false,
      canChangeStatus: false,
      canRequestClosure: false,
      canClose: false,
      canReopen: false,
    };
  }

  const baseScope: DepartmentScope = {
    departmentId: user?.departmentId,
    departmentIds: user?.departmentIds,
  };

  const inScope = isInScope(ticket, baseScope);

  const visibility =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    (role === 'dept_head_multi' && (inScope || isCreator || isAssignee)) ||
    (role === 'dept_head_single' && (inScope || isCreator || isAssignee)) ||
    (role === 'operator' &&
      (isCreator ||
        isAssignee ||
        getTicketOrigin(ticket) === user?.departmentId ||
        getTicketTarget(ticket) === user?.departmentId));

  const canAssign =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    ((role === 'dept_head_multi' || role === 'dept_head_single') && inScope);

  const canChangeDept = canAssign;

  const canChangePriority =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    ((role === 'dept_head_multi' || role === 'dept_head_single') && inScope) ||
    (role === 'operator' && (isCreator || isAssignee));

  const canChangeStatus =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    ((role === 'dept_head_multi' || role === 'dept_head_single') && inScope) ||
    (role === 'operator' && (isCreator || isAssignee));

  const canClose =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    ((role === 'dept_head_multi' || role === 'dept_head_single') && inScope);

  const canRequestClosure =
    role === 'operator' && (isAssignee || isCreator) && ticket.status !== 'Cerrada';

  const canReopen =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    ((role === 'dept_head_multi' || role === 'dept_head_single') && inScope);

  return {
    canView: visibility,
    canAssign,
    canAssignToSelf: role === 'operator' || canAssign,
    canChangeDepartment: canChangeDept,
    canChangePriority,
    canChangeStatus,
    canRequestClosure,
    canClose,
    canReopen,
  };
}

export function getVisibleTickets(tickets: Ticket[], user: User | null, userId: string | null) {
  return tickets.filter((ticket) => getTicketPermissions(ticket, user, userId).canView);
}
