import type { Ticket, User, UserRole } from '@/lib/firebase/models';

export const normalizeRole = (role?: UserRole) => {
  if (!role) return role;
  if (role === 'operario') return 'operator';
  if (role === 'mantenimiento') return 'maintenance';
  return role;
};

type DepartmentScope = { departmentId?: string; departmentIds?: string[] };

type TicketRoleGuards = {
  isCreator: boolean;
  isAssignee: boolean;
  inScope: boolean;
  matchesOrg: boolean;
};

export type TicketPermission = {
  canView: boolean;
  canComment: boolean;
  canEditContent: boolean;
  canAssignAnyUser: boolean;
  canAssignToSelf: boolean;
  canAssignToDepartmentBucket: boolean;
  canChangeDepartment: boolean;
  canChangePriority: boolean;
  canEscalateToCritical: boolean;
  canChangeStatus: boolean;
  canMarkTaskComplete: boolean;
  canMarkIncidentResolved: boolean;
  canRequestClosure: boolean;
  canClose: boolean;
  canReopen: boolean;
  canReassign: boolean;
  canUnassignSelf: boolean;
  canViewAuditTrail: boolean;
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

const buildGuards = (ticket: Ticket, user: User | null, userId: string | null): TicketRoleGuards => {
  const baseScope: DepartmentScope = {
    departmentId: user?.departmentId,
    departmentIds: user?.departmentIds,
  };

  return {
    isCreator: !!userId && ticket.createdBy === userId,
    isAssignee: !!userId && ticket.assignedTo === userId,
    inScope: isInScope(ticket, baseScope),
    matchesOrg: !user?.organizationId || ticket.organizationId === user.organizationId,
  };
};

const isClosed = (ticket: Ticket) => ticket.status === 'Cerrada';
const isOpen = (ticket: Ticket) => ticket.status === 'Abierta';

export function getTicketPermissions(ticket: Ticket, user: User | null, userId: string | null): TicketPermission {
  const role = normalizeRole(user?.role);

  if (!userId || !role) {
    return {
      canView: false,
      canComment: false,
      canEditContent: false,
      canAssignAnyUser: false,
      canAssignToSelf: false,
      canAssignToDepartmentBucket: false,
      canChangeDepartment: false,
      canChangePriority: false,
      canEscalateToCritical: false,
      canChangeStatus: false,
      canMarkTaskComplete: false,
      canMarkIncidentResolved: false,
      canRequestClosure: false,
      canClose: false,
      canReopen: false,
      canReassign: false,
      canUnassignSelf: false,
      canViewAuditTrail: false,
    };
  }

  const guards = buildGuards(ticket, user, userId);

  const visibility = (() => {
    if (role === 'super_admin') return true;
    if (!guards.matchesOrg) return false;
    if (role === 'admin' || role === 'maintenance') return true;
    if (role === 'dept_head_multi' || role === 'dept_head_single') return guards.inScope || guards.isCreator || guards.isAssignee;
    if (role === 'operator')
      return (
        guards.isCreator ||
        guards.isAssignee ||
        getTicketOrigin(ticket) === user?.departmentId ||
        getTicketTarget(ticket) === user?.departmentId
      );
    return false;
  })();

  const scopedManager = role === 'dept_head_multi' || role === 'dept_head_single';
  const managerOrAbove = role === 'super_admin' || role === 'admin' || role === 'maintenance' || scopedManager;
  const managerInScope = managerOrAbove && (role === 'super_admin' || (guards.matchesOrg && (!scopedManager || guards.inScope)));

  const canAssignAnyUser =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    ((role === 'dept_head_multi' || role === 'dept_head_single') && guards.matchesOrg && guards.inScope);

  const canAssignToSelf = role === 'operator' ? visibility : canAssignAnyUser;

  const canAssignToDepartmentBucket =
    role === 'operator'
      ? visibility && !isClosed(ticket)
      : canAssignAnyUser || (scopedManager && guards.matchesOrg && guards.inScope);

  const canChangeDepartment =
    role === 'operator'
      ? visibility && isOpen(ticket)
      : role === 'super_admin' ||
        (guards.matchesOrg &&
          (role === 'admin' ||
            role === 'maintenance' ||
            ((role === 'dept_head_multi' || role === 'dept_head_single') && guards.inScope)));

  const canChangePriority = managerInScope || (role === 'operator' && visibility && (guards.isCreator || guards.isAssignee));

  const canEscalateToCritical = managerInScope && !isClosed(ticket);

  const canChangeStatus =
    managerInScope || (role === 'operator' && visibility && (guards.isCreator || guards.isAssignee));

  const canMarkTaskComplete =
    role === 'operator' ? visibility && guards.isAssignee : managerInScope && !isClosed(ticket);

  const canMarkIncidentResolved =
    role === 'operator' ? visibility && guards.isAssignee : managerInScope && !isClosed(ticket);

  const canRequestClosure =
    (role === 'operator' && visibility && (guards.isCreator || guards.isAssignee) && !isClosed(ticket)) ||
    (managerInScope && !isClosed(ticket));

  const canClose = managerInScope && !isClosed(ticket);
  const canReopen = managerInScope;
  const canReassign = managerInScope && !isClosed(ticket);
  const canUnassignSelf = role === 'operator' && guards.isAssignee;
  const canViewAuditTrail =
    role === 'super_admin' ||
    (guards.matchesOrg &&
      (role === 'admin' ||
        role === 'maintenance' ||
        ((role === 'dept_head_multi' || role === 'dept_head_single') && guards.inScope) ||
        (role === 'operator' && (guards.isCreator || guards.isAssignee))));

  const canEditContent =
    role === 'super_admin' ||
    (guards.matchesOrg &&
      (role === 'admin' ||
        role === 'maintenance' ||
        ((role === 'dept_head_multi' || role === 'dept_head_single') && guards.inScope) ||
        (role === 'operator' && (guards.isCreator || guards.isAssignee))));

  const canComment = visibility;

  return {
    canView: visibility,
    canComment,
    canEditContent,
    canAssignAnyUser,
    canAssignToSelf,
    canAssignToDepartmentBucket,
    canChangeDepartment,
    canChangePriority,
    canEscalateToCritical,
    canChangeStatus,
    canMarkTaskComplete,
    canMarkIncidentResolved,
    canRequestClosure,
    canClose,
    canReopen,
    canReassign,
    canUnassignSelf,
    canViewAuditTrail,
  };
}

export function getVisibleTickets(tickets: Ticket[], user: User | null, userId: string | null) {
  return tickets.filter((ticket) => getTicketPermissions(ticket, user, userId).canView);
}

export function canCreateTicket(user: User | null) {
  const role = normalizeRole(user?.role);
  return (
    !!role &&
    (
      role === 'super_admin' ||
      role === 'admin' ||
      role === 'maintenance' ||
      role === 'dept_head_multi' ||
      role === 'dept_head_single' ||
      role === 'operator'
    )
  );
}

export const canEditOrgSettings = (user: User | null) => normalizeRole(user?.role) === 'super_admin';

export const canManageRoles = (user: User | null) => normalizeRole(user?.role) === 'super_admin';
