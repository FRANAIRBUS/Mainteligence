'use client';

import { useMemo } from 'react';
import { where, type QueryConstraint } from 'firebase/firestore';

import { useCollectionQuery } from '@/lib/firebase';
import { orgCollectionPath } from '@/lib/organization';
import { normalizeRole, type RBACUser } from '@/lib/rbac';

import type { MaintenanceTask } from '@/types/maintenance-task';
import type { Ticket } from '@/lib/firebase/models';

type ScopedResult<T> = {
  data: T[];
  loading: boolean;
  error: Error | null;
};

type ScopedParams = {
  organizationId?: string | null;
  rbacUser: RBACUser | null;
  uid?: string | null;
};

const EMPTY_CONSTRAINTS: QueryConstraint[] = [];

function mergeUniqueById<T extends { id?: string }>(...lists: Array<T[] | undefined | null>): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const id = item?.id;
      if (!id) continue;
      map.set(id, item);
    }
  }
  return Array.from(map.values());
}

function firstString(value?: string | string[] | null): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function pickDepartmentId(user: RBACUser | null): string | undefined {
  return firstString((user as any)?.departmentIds) ?? user?.departmentId ?? undefined;
}

function pickLocationId(user: RBACUser | null): string | undefined {
  return firstString((user as any)?.locationIds) ?? user?.locationId ?? undefined;
}

export function useScopedTasks({ organizationId, rbacUser, uid }: ScopedParams): ScopedResult<MaintenanceTask> {
  const role = normalizeRole(rbacUser?.role);
  const basePath = organizationId ? orgCollectionPath(organizationId, 'tasks') : null;

  const canReadAll = !!role && ['super_admin', 'admin', 'mantenimiento', 'auditor'].includes(role);
  const departmentId = pickDepartmentId(rbacUser);
  const locationId = pickLocationId(rbacUser);

  const useDeptScope = !canReadAll && !!role && (role === 'jefe_departamento' || role === 'operario') && !!departmentId;
  const useLocationScope = !canReadAll && role === 'jefe_ubicacion' && !!locationId;
  const usePersonalScope = !canReadAll && !!uid;

  // IMPORTANT:
  // useCollectionQuery depends on the identity of QueryConstraint objects.
  // We MUST memoize constraints to avoid infinite re-render loops (React error #185).
  const createdConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !usePersonalScope || !uid) return EMPTY_CONSTRAINTS;
    return [where('createdBy', '==', uid)];
  }, [basePath, usePersonalScope, uid]);

  const assignedConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !usePersonalScope || !uid) return EMPTY_CONSTRAINTS;
    return [where('assignedTo', '==', uid)];
  }, [basePath, usePersonalScope, uid]);

  const deptLegacyConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useDeptScope || !departmentId) return EMPTY_CONSTRAINTS;
    return [where('departmentId', '==', departmentId)];
  }, [basePath, useDeptScope, departmentId]);

  const deptOriginConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useDeptScope || !departmentId) return EMPTY_CONSTRAINTS;
    return [where('originDepartmentId', '==', departmentId)];
  }, [basePath, useDeptScope, departmentId]);

  const deptTargetConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useDeptScope || !departmentId) return EMPTY_CONSTRAINTS;
    return [where('targetDepartmentId', '==', departmentId)];
  }, [basePath, useDeptScope, departmentId]);

  const locationConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useLocationScope || !locationId) return EMPTY_CONSTRAINTS;
    return [where('locationId', '==', locationId)];
  }, [basePath, useLocationScope, locationId]);

  const all = useCollectionQuery<MaintenanceTask>(canReadAll ? basePath : null);

  const created = useCollectionQuery<MaintenanceTask>(
    !canReadAll && usePersonalScope ? basePath : null,
    ...createdConstraints
  );
  const assigned = useCollectionQuery<MaintenanceTask>(
    !canReadAll && usePersonalScope ? basePath : null,
    ...assignedConstraints
  );

  const deptLegacy = useCollectionQuery<MaintenanceTask>(
    !canReadAll && useDeptScope ? basePath : null,
    ...deptLegacyConstraints
  );
  const deptOrigin = useCollectionQuery<MaintenanceTask>(
    !canReadAll && useDeptScope ? basePath : null,
    ...deptOriginConstraints
  );
  const deptTarget = useCollectionQuery<MaintenanceTask>(
    !canReadAll && useDeptScope ? basePath : null,
    ...deptTargetConstraints
  );

  const loc = useCollectionQuery<MaintenanceTask>(
    !canReadAll && useLocationScope ? basePath : null,
    ...locationConstraints
  );

  const data = useMemo(() => {
    if (canReadAll) return all.data;
    return mergeUniqueById(created.data, assigned.data, deptLegacy.data, deptOrigin.data, deptTarget.data, loc.data);
  }, [canReadAll, all.data, created.data, assigned.data, deptLegacy.data, deptOrigin.data, deptTarget.data, loc.data]);

  const loading = canReadAll
    ? all.loading
    : created.loading || assigned.loading || deptLegacy.loading || deptOrigin.loading || deptTarget.loading || loc.loading;

  const error = canReadAll
    ? all.error
    : (created.error || assigned.error || deptLegacy.error || deptOrigin.error || deptTarget.error || loc.error || null);

  return { data, loading, error };
}

export function useScopedTickets({ organizationId, rbacUser, uid }: ScopedParams): ScopedResult<Ticket> {
  const role = normalizeRole(rbacUser?.role);
  const basePath = organizationId ? orgCollectionPath(organizationId, 'tickets') : null;

  const canReadAll = !!role && ['super_admin', 'admin', 'mantenimiento', 'auditor'].includes(role);
  const departmentId = pickDepartmentId(rbacUser);
  const locationId = pickLocationId(rbacUser);

  const useDeptScope = !canReadAll && !!role && (role === 'jefe_departamento' || role === 'operario') && !!departmentId;
  const useLocationScope = !canReadAll && role === 'jefe_ubicacion' && !!locationId;
  const usePersonalScope = !canReadAll && !!uid;

  const createdConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !usePersonalScope || !uid) return EMPTY_CONSTRAINTS;
    return [where('createdBy', '==', uid)];
  }, [basePath, usePersonalScope, uid]);

  const assignedConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !usePersonalScope || !uid) return EMPTY_CONSTRAINTS;
    return [where('assignedTo', '==', uid)];
  }, [basePath, usePersonalScope, uid]);

  const deptLegacyConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useDeptScope || !departmentId) return EMPTY_CONSTRAINTS;
    return [where('departmentId', '==', departmentId)];
  }, [basePath, useDeptScope, departmentId]);

  const deptOriginConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useDeptScope || !departmentId) return EMPTY_CONSTRAINTS;
    return [where('originDepartmentId', '==', departmentId)];
  }, [basePath, useDeptScope, departmentId]);

  const deptTargetConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useDeptScope || !departmentId) return EMPTY_CONSTRAINTS;
    return [where('targetDepartmentId', '==', departmentId)];
  }, [basePath, useDeptScope, departmentId]);

  const locationConstraints = useMemo<QueryConstraint[]>(() => {
    if (!basePath || !useLocationScope || !locationId) return EMPTY_CONSTRAINTS;
    return [where('locationId', '==', locationId)];
  }, [basePath, useLocationScope, locationId]);

  const all = useCollectionQuery<Ticket>(canReadAll ? basePath : null);

  const created = useCollectionQuery<Ticket>(
    !canReadAll && usePersonalScope ? basePath : null,
    ...createdConstraints
  );
  const assigned = useCollectionQuery<Ticket>(
    !canReadAll && usePersonalScope ? basePath : null,
    ...assignedConstraints
  );

  const deptLegacy = useCollectionQuery<Ticket>(
    !canReadAll && useDeptScope ? basePath : null,
    ...deptLegacyConstraints
  );
  const deptOrigin = useCollectionQuery<Ticket>(
    !canReadAll && useDeptScope ? basePath : null,
    ...deptOriginConstraints
  );
  const deptTarget = useCollectionQuery<Ticket>(
    !canReadAll && useDeptScope ? basePath : null,
    ...deptTargetConstraints
  );

  const loc = useCollectionQuery<Ticket>(
    !canReadAll && useLocationScope ? basePath : null,
    ...locationConstraints
  );

  const data = useMemo(() => {
    if (canReadAll) return all.data;
    return mergeUniqueById(created.data, assigned.data, deptLegacy.data, deptOrigin.data, deptTarget.data, loc.data);
  }, [canReadAll, all.data, created.data, assigned.data, deptLegacy.data, deptOrigin.data, deptTarget.data, loc.data]);

  const loading = canReadAll
    ? all.loading
    : created.loading || assigned.loading || deptLegacy.loading || deptOrigin.loading || deptTarget.loading || loc.loading;

  const error = canReadAll
    ? all.error
    : (created.error || assigned.error || deptLegacy.error || deptOrigin.error || deptTarget.error || loc.error || null);

  return { data, loading, error };
}
