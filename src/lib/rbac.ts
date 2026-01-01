import type { Ticket, User, UserRole } from '@/lib/firebase/models';

export const normalizeRole = (role?: UserRole) => {
  if (!role) return role;
  if (role === 'operario') return 'operator';
  if (role === 'mantenimiento') return 'maintenance';
  return role;
};

const ADMIN_LIKE_ROLES = ['super_admin', 'admin', 'maintenance'] as const;
const SCOPED_HEAD_ROLES = ['dept_head_multi', 'dept_head_single'] as const;

export const isAdminLikeRole = (role?: UserRole | null) => {
  const normalized = normalizeRole(role ?? undefined);
  return ADMIN_LIKE_ROLES.includes((normalized ?? '') as (typeof ADMIN_LIKE_ROLES)[number]);
};

export const isScopedDepartmentHead = (role?: UserRole | null) => {
  const normalized = normalizeRole(role ?? undefined);
  return SCOPED_HEAD_ROLES.includes((normalized ?? '') as (typeof SCOPED_HEAD_ROLES)[number]);
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
  const roleIsScopedHead = role === 'dept_head_multi' || role === 'dept_head_single';
  const managerOrAbove = role === 'super_admin' || role === 'admin' || role === 'maintenance' || roleIsScopedHead;

  const visibility = (() => {
    if (role === 'super_admin') return true;
    if (!guards.matchesOrg) return false;
    if (role === 'admin' || role === 'maintenance') return true;
    if (roleIsScopedHead) return guards.inScope || guards.isCreator || guards.isAssignee;
    if (role === 'operator')
      return (
        guards.isCreator ||
        guards.isAssignee ||
        getTicketOrigin(ticket) === user?.departmentId ||
        getTicketTarget(ticket) === user?.departmentId
      );
    return false;
  })();

  const managerInScope = managerOrAbove && (role === 'super_admin' || (guards.matchesOrg && (!roleIsScopedHead || guards.inScope)));

  const canAssignAnyUser =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'maintenance' ||
    (roleIsScopedHead && guards.matchesOrg && guards.inScope);

  const canAssignToSelf = role === 'operator' ? visibility : canAssignAnyUser;

  const canAssignToDepartmentBucket =
    role === 'operator'
      ? visibility && !isClosed(ticket)
      : canAssignAnyUser && guards.matchesOrg && !isClosed(ticket);

  const canChangeDepartment =
    role === 'operator'
      ? visibility && isOpen(ticket)
      : managerInScope;

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

  const canClose = managerInScope && role !== 'operator' && !isClosed(ticket);
  const canReopen = managerInScope && role !== 'operator';
  const canReassign = managerInScope && !isClosed(ticket);
  const canUnassignSelf = role === 'operator' && guards.isAssignee;
  const canViewAuditTrail =
    role === 'super_admin' ||
    (guards.matchesOrg &&
      (role === 'admin' ||
        role === 'maintenance' ||
        (roleIsScopedHead && guards.inScope) ||
        (role === 'operator' && (guards.isCreator || guards.isAssignee))));

  const canEditContent =
    role === 'super_admin' ||
    (guards.matchesOrg &&
      (role === 'admin' ||
        role === 'maintenance' ||
        (roleIsScopedHead && guards.inScope) ||
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
