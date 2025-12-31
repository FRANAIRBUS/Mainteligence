'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentSnapshot,
  type Firestore,
  query,
  where,
  limit,
} from 'firebase/firestore';
import type {
  AuditLogEntry,
  OrganizationLifecycleStatus,
  RootOrganization,
} from './types';

interface ActionActor {
  id: string;
  email?: string | null;
  name?: string | null;
}

interface ActionContext {
  firestore: Firestore;
  actor: ActionActor;
}

interface LifecycleUpdateOptions {
  reason?: string;
  metadata?: Record<string, unknown>;
}

const now = () => serverTimestamp();

const logAction = async (
  ctx: ActionContext,
  entry: Omit<AuditLogEntry, 'id' | 'createdAt'>,
) => {
  const auditRef = doc(collection(ctx.firestore, 'auditLogs'));
  const payload: AuditLogEntry = {
    id: auditRef.id,
    ...entry,
    createdAt: now(),
  };

  await setDoc(auditRef, payload);
};

const parseOrganization = (snapshot: DocumentSnapshot): RootOrganization => {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    name: (data as { name?: string }).name ?? 'Sin nombre',
    status: (data as { status?: OrganizationLifecycleStatus }).status ?? 'active',
    createdAt: (data as RootOrganization).createdAt,
    updatedAt: (data as RootOrganization).updatedAt,
    deletedAt: (data as RootOrganization).deletedAt,
    suspendedAt: (data as RootOrganization).suspendedAt,
    subscriptionPlan: (data as RootOrganization).subscriptionPlan,
    taxId: (data as RootOrganization).taxId,
    ownerEmail: (data as RootOrganization).ownerEmail,
    userCount: (data as RootOrganization).userCount,
    settings: (data as RootOrganization).settings,
  };
};

const updateLifecycle = async (
  ctx: ActionContext,
  organizationId: string,
  status: OrganizationLifecycleStatus,
  options?: LifecycleUpdateOptions,
) => {
  const previousStatus = await runTransaction(ctx.firestore, async (tx) => {
    const orgRef = doc(ctx.firestore, 'organizations', organizationId);
    const orgSnap = await tx.get(orgRef);

    if (!orgSnap.exists()) {
      throw new Error('La organización no existe');
    }

    const organization = parseOrganization(orgSnap);

    const updates: Partial<RootOrganization> = {
      status,
      updatedAt: now(),
    };

    if (status === 'suspended') {
      updates.suspendedAt = now();
    }

    if (status === 'deleted_soft') {
      updates.deletedAt = now();
    }

    if (status === 'active') {
      updates.suspendedAt = null;
      updates.deletedAt = null;
    }

    tx.update(orgRef, updates);
    return organization.status;
  });

  await logAction(ctx, {
    action: `organization_${status}`,
    targetId: organizationId,
    targetType: 'organization',
    actorId: ctx.actor.id,
    actorEmail: ctx.actor.email,
    actorName: ctx.actor.name,
    status: 'success',
    message: options?.reason,
    metadata: {
      previousStatus,
      ...options?.metadata,
    },
  });
};

export const suspendOrganization = async (
  ctx: ActionContext,
  organizationId: string,
  options?: LifecycleUpdateOptions,
) => updateLifecycle(ctx, organizationId, 'suspended', options);

export const restoreOrganization = async (
  ctx: ActionContext,
  organizationId: string,
  options?: LifecycleUpdateOptions,
) => updateLifecycle(ctx, organizationId, 'active', options);

export const softDeleteOrganization = async (
  ctx: ActionContext,
  organizationId: string,
  options?: LifecycleUpdateOptions,
) => updateLifecycle(ctx, organizationId, 'deleted_soft', options);

export const markHardDeletedOrganization = async (
  ctx: ActionContext,
  organizationId: string,
  options?: LifecycleUpdateOptions,
) => updateLifecycle(ctx, organizationId, 'deleted_hard', options);

export const writeAuditMessage = async (
  ctx: ActionContext,
  entry: Omit<AuditLogEntry, 'id' | 'createdAt' | 'actorId'>,
) =>
  logAction(ctx, {
    ...entry,
    actorId: ctx.actor.id,
    actorEmail: ctx.actor.email,
    actorName: ctx.actor.name,
  });

async function deleteByOrg(
  firestore: Firestore,
  collectionName: string,
  organizationId: string,
  batchSize = 200,
) {
  const colRef = collection(firestore, collectionName);
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batchQuery = query(
      colRef,
      where('organizationId', '==', organizationId),
      limit(batchSize),
    );
    const snapshot = await getDocs(batchQuery);
    if (snapshot.empty) break;

    await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
    deleted += snapshot.size;
    if (snapshot.size < batchSize) break;
  }

  return deleted;
}

export const purgeOrganizationData = async (
  ctx: ActionContext,
  organizationId: string,
  collections: string[],
) => {
  const results: Record<string, number> = {};

  for (const col of collections) {
    try {
      results[col] = await deleteByOrg(ctx.firestore, col, organizationId);
    } catch (error) {
      results[col] = -1;
      console.error(`[purge] Failed on ${col}`, error);
    }
  }

  await logAction(ctx, {
    action: 'organization_purge',
    targetId: organizationId,
    targetType: 'organization',
    actorId: ctx.actor.id,
    actorEmail: ctx.actor.email,
    actorName: ctx.actor.name,
    status: 'success',
    message: 'Purgado manual completo',
    metadata: { results },
  });

  return results;
};

export const exportOrganizationSnapshot = async (
  ctx: ActionContext,
  organizationId: string,
  collections: string[],
) => {
  const snapshot: Record<string, unknown[]> = {};

  for (const col of collections) {
    const colRef = collection(ctx.firestore, col);
    const data = await getDocs(query(colRef, where('organizationId', '==', organizationId)));
    snapshot[col] = data.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  await logAction(ctx, {
    action: 'organization_export',
    targetId: organizationId,
    targetType: 'organization',
    actorId: ctx.actor.id,
    actorEmail: ctx.actor.email,
    actorName: ctx.actor.name,
    status: 'success',
    message: 'Export JSON generado',
  });

  return snapshot;
};

export const updateOrganizationMetadata = async (
  ctx: ActionContext,
  organizationId: string,
  payload: Partial<RootOrganization>,
) => {
  const orgRef = doc(ctx.firestore, 'organizations', organizationId);

  await updateDoc(orgRef, {
    ...payload,
    updatedAt: now(),
  });

  await logAction(ctx, {
    action: 'organization_update',
    targetId: organizationId,
    targetType: 'organization',
    actorId: ctx.actor.id,
    actorEmail: ctx.actor.email,
    actorName: ctx.actor.name,
    status: 'success',
    metadata: payload,
  });
};

export type { ActionContext };
