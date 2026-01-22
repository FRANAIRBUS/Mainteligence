import assert from "node:assert/strict";
import { Timestamp } from "firebase/firestore";
import { getTaskPermissions, getTicketPermissions } from "@/lib/rbac";
import type { Ticket, User } from "@/lib/firebase/models";
import type { MaintenanceTask } from "@/types/maintenance-task";

const now = Timestamp.now();

const baseTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "ticket-1",
  organizationId: "org-1",
  createdAt: now,
  updatedAt: now,
  displayId: "T-1",
  type: "correctivo",
  status: "new",
  priority: "Media",
  siteId: "site-legacy",
  locationId: "loc-1",
  departmentId: "legacy-dept",
  originDepartmentId: "dept-1",
  targetDepartmentId: "dept-1",
  title: "Test ticket",
  description: "Test",
  createdBy: "user-creator",
  assignedTo: null,
  ...overrides,
});

const baseUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  organizationId: "org-1",
  createdAt: now,
  updatedAt: now,
  displayName: "User",
  email: "user@example.com",
  role: "operario",
  isMaintenanceLead: false,
  active: true,
  ...overrides,
});

const baseTask = (overrides: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
  id: "task-1",
  organizationId: "org-1",
  title: "Task",
  status: "open",
  taskType: "maintenance",
  priority: "media",
  dueDate: null,
  originDepartmentId: "dept-1",
  targetDepartmentId: "dept-1",
  locationId: "loc-1",
  createdBy: "user-creator",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const assertCanView = (ticket: Ticket, user: User, userId = user.id) => {
  const permissions = getTicketPermissions(ticket, user, userId);
  assert.equal(permissions.canView, true);
};

const assertCannotView = (ticket: Ticket, user: User, userId = user.id) => {
  const permissions = getTicketPermissions(ticket, user, userId);
  assert.equal(permissions.canView, false);
};

const assertCanEdit = (ticket: Ticket, user: User, userId = user.id) => {
  const permissions = getTicketPermissions(ticket, user, userId);
  assert.equal(permissions.canEditContent, true);
};

const assertCannotEdit = (ticket: Ticket, user: User, userId = user.id) => {
  const permissions = getTicketPermissions(ticket, user, userId);
  assert.equal(permissions.canEditContent, false);
};

{
  const ticket = baseTicket();
  const user = baseUser({ role: "super_admin", id: "user-admin" });
  assertCanView(ticket, user);
  assertCanEdit(ticket, user);
}

{
  const ticket = baseTicket();
  const user = baseUser({ role: "auditor", id: "user-audit" });
  assertCanView(ticket, user);
  assertCannotEdit(ticket, user);
}

{
  const ticket = baseTicket({
    originDepartmentId: "dept-1",
    targetDepartmentId: "dept-1",
    createdBy: "other-user",
  });
  const user = baseUser({ role: "operario", id: "user-op", departmentId: "dept-1" });
  assertCanView(ticket, user);
}

{
  const ticket = baseTicket({
    originDepartmentId: "dept-2",
    targetDepartmentId: "dept-2",
    locationId: "loc-1",
    createdBy: "other-user",
  });
  const user = baseUser({ role: "operario", id: "user-op", departmentId: "dept-1", locationId: "loc-1" });
  assertCannotView(ticket, user);
}

{
  const ticket = baseTicket({
    originDepartmentId: "dept-2",
    targetDepartmentId: "dept-2",
    locationId: "loc-2",
  });
  const user = baseUser({ role: "jefe_ubicacion", id: "user-loc", locationId: "loc-2" });
  assertCanView(ticket, user);
  assertCanEdit(ticket, user);
}

{
  const ticket = baseTicket();
  const user = baseUser({ role: "admin", id: "user-admin", organizationId: "org-2" });
  assertCannotView(ticket, user);
}

{
  const ticket = baseTicket({
    originDepartmentId: "dept-1",
    targetDepartmentId: "dept-1",
  });
  const user = baseUser({ role: "jefe_departamento", id: "user-dept", departmentId: "dept-1" });
  const permissions = getTicketPermissions(ticket, user, user.id);
  assert.equal(permissions.canAssignAnyUser, true);
}

console.log("rbac tests passed");

{
  const task = baseTask();
  const user = baseUser({ role: "operario", id: "user-op", departmentId: "dept-1" });
  const permissions = getTaskPermissions(task, user, user.id);
  assert.equal(permissions.canView, true);
}

{
  const task = baseTask({
    originDepartmentId: "dept-2",
    targetDepartmentId: "dept-2",
    locationId: "loc-1",
  });
  const user = baseUser({ role: "operario", id: "user-op", departmentId: "dept-1", locationId: "loc-1" });
  const permissions = getTaskPermissions(task, user, user.id);
  assert.equal(permissions.canView, false);
}

{
  const task = baseTask({
    originDepartmentId: "dept-2",
    targetDepartmentId: "dept-2",
    locationId: "loc-2",
  });
  const user = baseUser({ role: "jefe_ubicacion", id: "user-loc", locationId: "loc-2" });
  const permissions = getTaskPermissions(task, user, user.id);
  assert.equal(permissions.canView, true);
  assert.equal(permissions.canEditContent, true);
}

{
  const task = baseTask();
  const user = baseUser({ role: "admin", id: "user-admin", organizationId: "org-2" });
  const permissions = getTaskPermissions(task, user, user.id);
  assert.equal(permissions.canView, false);
}

console.log("rbac task tests passed");
