import type { Ticket, User, UserRole } from '@/lib/firebase/models';
import type { MaintenanceTask } from '@/types/maintenance-task';
import { normalizeTicketStatus } from '@/lib/status';

export const normalizeRole = (role?: UserRole | string | null) => {
  if (!role) return undefined;
  const normalized = role.toLowerCase().trim();

  if (normalized === 'super_admin' || normalized === 'superadmin') return 'super_admin';
  if (normalized === 'admin' || normalized === 'administrator') return 'admin';

  if (
    normalized === 'mantenimiento' ||
    normalized === 'maintenance' ||
    normalized === 'manteniendo' ||
    normalized === 'maint' ||
    normalized === 'maintainer'
  ) {
    return 'mantenimiento';
  }

  if (
    normalized === 'dept_head_multi' ||
    normalized === 'deptheadmulti' ||
    normalized === 'dept-head-multi' ||
    normalized === 'dept head multi' ||
    normalized === 'department_head_multi' ||
    normalized === 'departmentheadmulti' ||
    normalized === 'jefe_departamento_multi' ||
    normalized === 'jefe de departamento multi'
  ) {
    return 'jefe_departamento';
  }

  if (
    normalized === 'dept_head_single' ||
    normalized === 'deptheadsingle' ||
    normalized === 'dept-head-single' ||
    normalized === 'dept head single' ||
    normalized === 'dept_head' ||
    normalized === 'depthead' ||
    normalized === 'department_head_single' ||
    normalized === 'departmentheadsingle' ||
    normalized === 'jefe_departamento' ||
    normalized === 'jefe de departamento'
  ) {
    return 'jefe_departamento';
  }

  if (
    normalized === 'jefe_ubicacion' ||
    normalized === 'jefe ubicacion' ||
    normalized === 'location_head' ||
    normalized === 'site_head'
  ) {
    return 'jefe_ubicacion';
  }

  if (normalized === 'operario' || normalized === 'operator' || normalized === 'op') return 'operario';

  if (normalized === 'auditor' || normalized === 'audit') return 'auditor';

  return normalized as UserRole;
};

const ADMIN_LIKE_ROLES = ['super_admin', 'admin', 'mantenimiento'] as const;
const DEPARTMENT_HEAD_ROLES = ['jefe_departamento'] as const;
const LOCATION_HEAD_ROLES = ['jefe_ubicacion'] as const;
const MASTER_DATA_ROLES = [...ADMIN_LIKE_ROLES, ...DEPARTMENT_HEAD_ROLES, ...LOCATION_HEAD_ROLES] as const;

export const isAdminLikeRole = (role?: UserRole | string | null) => {
  const normalized = normalizeRole(role);
  return ADMIN_LIKE_ROLES.includes((normalized ?? '') as (typeof ADMIN_LIKE_ROLES)[number]);
};

export const isScopedDepartmentHead = (role?: UserRole | string | null) => {
  const normalized = normalizeRole(role);
  return DEPARTMENT_HEAD_ROLES.includes((normalized ?? '') as (typeof DEPARTMENT_HEAD_ROLES)[number]);
};

export const canManageMasterData = (role?: UserRole | string | null) => {
  const normalized = normalizeRole(role);
  return MASTER_DATA_ROLES.includes((normalized ?? '') as (typeof MASTER_DATA_ROLES)[number]);
};

type DepartmentScope = { departmentId?: string };

type LocationScope = {
  locationId?: string;
};

const getTicketLocationId = (ticket: Ticket) => ticket.locationId ?? ticket.siteId ?? null;

type TicketRoleGuards = {
  isCreator: boolean;
  isAssignee: boolean;
  inDepartmentScope: boolean;
  inLocationScope: boolean;
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

export type TaskPermission = {
  canView: boolean;
  canEditContent: boolean;
  canMarkTaskComplete: boolean;
};

export type RBACUser = Pick<User, 'role' | 'organizationId' | 'departmentId' | 'locationId'>;

const getTicketOrigin = (ticket: Ticket) =>
  ticket.originDepartmentId ?? ticket.departmentId ?? null;
const getTicketTarget = (ticket: Ticket) =>
  ticket.targetDepartmentId ?? ticket.departmentId ?? null;

const isInDepartmentScope = (ticket: Ticket, scope: DepartmentScope) => {
  const origin = getTicketOrigin(ticket);
  const target = getTicketTarget(ticket);
  return (
    !!scope.departmentId && (origin === scope.departmentId || target === scope.departmentId)
  );
};

const isInLocationScope = (ticket: Ticket, scope: LocationScope) => {
  const site = getTicketLocationId(ticket);
  return (
    !!scope.locationId && site === scope.locationId
  );
};

const buildGuards = (ticket: Ticket, user: User | RBACUser | null, userId: string | null): TicketRoleGuards => {
  const deptScope: DepartmentScope = {
    departmentId: user?.departmentId,
  };

  const locationScope: LocationScope = {
    locationId: user?.locationId,
  };

  const inDepartmentScope = isInDepartmentScope(ticket, deptScope);
  const inLocationScope = isInLocationScope(ticket, locationScope);

  return {
    isCreator: !!userId && ticket.createdBy === userId,
    isAssignee: !!userId && ticket.assignedTo === userId,
    inDepartmentScope,
    inLocationScope,
    inScope: inDepartmentScope || inLocationScope,
    matchesOrg: !!user?.organizationId && ticket.organizationId === user.organizationId,
  };
};


const isClosed = (ticket: Ticket) => normalizeTicketStatus(ticket.status) === 'resolved';
const isOpen = (ticket: Ticket) => normalizeTicketStatus(ticket.status) === 'new';

export function getTicketPermissions(
  ticket: Ticket,
  user: User | RBACUser | null,
  userId: string | null
): TicketPermission {
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
  const roleIsDeptHead = role === 'jefe_departamento';
  const roleIsLocationHead = role === 'jefe_ubicacion';
  const isAuditor = role === 'auditor';
  const managerOrAbove =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'mantenimiento' ||
    roleIsDeptHead ||
    roleIsLocationHead;

  const visibility = (() => {
    if (role === 'super_admin') return true;
    if (!guards.matchesOrg) return false;
    if (role === 'admin' || role === 'mantenimiento') return true;
    if (isAuditor) return true;
    if (roleIsDeptHead) return guards.inDepartmentScope || guards.isCreator || guards.isAssignee;
    if (roleIsLocationHead) return guards.inLocationScope || guards.isCreator || guards.isAssignee;
    if (role === 'operario') return guards.isCreator || guards.isAssignee || guards.inDepartmentScope;
    return false;
  })();

  if (isAuditor) {
    // Auditor is strictly read-only + reporting.
    return {
      canView: visibility,
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
      canViewAuditTrail: true,
    };
  }

  const managerInScope =
    managerOrAbove &&
    (role === 'super_admin' ||
      (guards.matchesOrg &&
        (
          roleIsDeptHead
            ? guards.inDepartmentScope
            : roleIsLocationHead
              ? guards.inLocationScope
              : true
        )));

  const canAssignAnyUser =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'mantenimiento' ||
    ((roleIsDeptHead && guards.matchesOrg && guards.inDepartmentScope) ||
      (roleIsLocationHead && guards.matchesOrg && guards.inLocationScope));

  const canAssignToSelf = role === 'operario' ? visibility : canAssignAnyUser;

  const canAssignToDepartmentBucket =
    role === 'operario'
      ? visibility && !isClosed(ticket)
      : canAssignAnyUser && guards.matchesOrg && !isClosed(ticket);

  const canChangeDepartment =
    role === 'operario'
      ? visibility && isOpen(ticket)
      : managerInScope;

  const canChangePriority = managerInScope || (role === 'operario' && visibility && (guards.isCreator || guards.isAssignee));

  const canEscalateToCritical = managerInScope && !isClosed(ticket);

  const canChangeStatus =
    managerInScope || (role === 'operario' && visibility && (guards.isCreator || guards.isAssignee));

  const canMarkTaskComplete =
    role === 'operario' ? visibility && guards.isAssignee : managerInScope && !isClosed(ticket);

  const canMarkIncidentResolved =
    role === 'operario' ? visibility && guards.isAssignee : managerInScope && !isClosed(ticket);

  const canRequestClosure =
    (role === 'operario' && visibility && (guards.isCreator || guards.isAssignee) && !isClosed(ticket)) ||
    (managerInScope && !isClosed(ticket));

  const canClose = managerInScope && role !== 'operario' && !isClosed(ticket);
  const canReopen = managerInScope && role !== 'operario';
  const canReassign = managerInScope && !isClosed(ticket);
  const canUnassignSelf = role === 'operario' && guards.isAssignee;
  const canViewAuditTrail =
    role === 'super_admin' ||
    (guards.matchesOrg &&
      (role === 'admin' ||
        role === 'mantenimiento' ||
        ((roleIsDeptHead && guards.inDepartmentScope) || (roleIsLocationHead && guards.inLocationScope)) ||
        (role === 'operario' && (guards.isCreator || guards.isAssignee))));

  const canEditContent =
    role === 'super_admin' ||
      (guards.matchesOrg &&
      (role === 'admin' ||
        role === 'mantenimiento' ||
        ((roleIsDeptHead && guards.inDepartmentScope) || (roleIsLocationHead && guards.inLocationScope)) ||
        (role === 'operario' && (guards.isCreator || guards.isAssignee))));

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

type TaskRoleGuards = {
  isCreator: boolean;
  isAssignee: boolean;
  inDepartmentScope: boolean;
  inLocationScope: boolean;
  matchesOrg: boolean;
};

const buildTaskGuards = (
  task: MaintenanceTask,
  user: User | RBACUser | null,
  userId: string | null
): TaskRoleGuards => {
  const deptId =
    task.targetDepartmentId ?? task.originDepartmentId ?? task.departmentId ?? null;
  const taskLocationId = task.locationId ?? task.siteId ?? null;
  const inDepartmentScope = !!user?.departmentId && !!deptId && deptId === user.departmentId;
  const inLocationScope =
    !!user?.locationId && !!taskLocationId && taskLocationId === user.locationId;

  return {
    isCreator: !!userId && task.createdBy === userId,
    isAssignee: !!userId && task.assignedTo === userId,
    inDepartmentScope,
    inLocationScope,
    matchesOrg: !!user?.organizationId && task.organizationId === user.organizationId,
  };
};

export function getTaskPermissions(
  task: MaintenanceTask,
  user: User | RBACUser | null,
  userId: string | null
): TaskPermission {
  const role = normalizeRole(user?.role);

  if (!userId || !role) {
    return {
      canView: false,
      canEditContent: false,
      canMarkTaskComplete: false,
    };
  }

  const guards = buildTaskGuards(task, user, userId);
  const roleIsDeptHead = role === 'jefe_departamento';
  const roleIsLocationHead = role === 'jefe_ubicacion';

  if (!guards.matchesOrg) {
    return {
      canView: false,
      canEditContent: false,
      canMarkTaskComplete: false,
    };
  }

  const canView =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'mantenimiento' ||
    role === 'auditor' ||
    (roleIsDeptHead && (guards.inDepartmentScope || guards.isCreator || guards.isAssignee)) ||
    (roleIsLocationHead && (guards.inLocationScope || guards.isCreator || guards.isAssignee)) ||
    (role === 'operario' && (guards.isCreator || guards.isAssignee || guards.inDepartmentScope));

  if (!canView) {
    return {
      canView: false,
      canEditContent: false,
      canMarkTaskComplete: false,
    };
  }

  const canEditContent =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'mantenimiento' ||
    (roleIsDeptHead && guards.inDepartmentScope) ||
    (roleIsLocationHead && guards.inLocationScope) ||
    (role === 'operario' && (guards.isCreator || guards.isAssignee));

  const canMarkTaskComplete =
    role === 'super_admin' ||
    role === 'admin' ||
    role === 'mantenimiento' ||
    (roleIsDeptHead && guards.inDepartmentScope) ||
    (roleIsLocationHead && guards.inLocationScope) ||
    (role === 'operario' && guards.isAssignee);

  return {
    canView,
    canEditContent,
    canMarkTaskComplete,
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
      role === 'mantenimiento' ||
      role === 'jefe_departamento' ||
      role === 'jefe_ubicacion' ||
      role === 'operario'
    )
  );
}

export const canEditOrgSettings = (user: User | null) => normalizeRole(user?.role) === 'super_admin';

export const canManageRoles = (user: User | null) => normalizeRole(user?.role) === 'super_admin';
