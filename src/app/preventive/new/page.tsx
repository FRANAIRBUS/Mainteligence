'use client';

import { useState } from 'react';
import { Timestamp, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import {
  PreventiveTemplateForm,
  type PreventiveTemplateFormValues,
} from '@/components/preventive-template-form';
import { useCollection, useFirestore, useUser } from '@/lib/firebase';
import type { Asset, Department, Site } from '@/lib/firebase/models';
import { orgCollectionPath, orgPreventiveTemplatesPath } from '@/lib/organization';

const normalizeOptional = (value?: string) =>
  value && value !== '__none__' ? value : undefined;

export default function NewPreventiveTemplatePage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user, loading: userLoading, organizationId } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: sites } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );
  const { data: assets } = useCollection<Asset>(
    organizationId ? orgCollectionPath(organizationId, 'assets') : null
  );

  const handleSubmit = async (values: PreventiveTemplateFormValues) => {
    if (!firestore) {
      setErrorMessage('No se pudo inicializar la base de datos.');
      return;
    }

    if (userLoading) {
      setErrorMessage('Cargando sesión, intenta de nuevo en un momento.');
      return;
    }

    if (!user) {
      setErrorMessage('No se pudo identificar al usuario actual.');
      return;
    }

    if (!organizationId) {
      setErrorMessage('No encontramos un organizationId válido.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const scheduleDate = values.date ? Timestamp.fromDate(new Date(values.date)) : undefined;
      const dayOfMonth =
        typeof values.dayOfMonth === 'number' && !Number.isNaN(values.dayOfMonth)
          ? values.dayOfMonth
          : undefined;

      const schedule = {
        type: values.scheduleType,
        timezone:
          typeof Intl !== 'undefined'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : undefined,
        timeOfDay: values.timeOfDay?.trim() || undefined,
        daysOfWeek: values.daysOfWeek?.length ? values.daysOfWeek : undefined,
        dayOfMonth,
        date: scheduleDate,
      };

      const payload = {
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        status: values.status,
        automatic: values.automatic,
        schedule,
        priority: values.priority,
        siteId: normalizeOptional(values.siteId),
        departmentId: normalizeOptional(values.departmentId),
        assetId: normalizeOptional(values.assetId),
        createdBy: user.uid,
        updatedBy: user.uid,
        organizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const collectionRef = collection(firestore, orgPreventiveTemplatesPath(organizationId));
      await addDoc(collectionRef, payload);
      router.push('/preventive');
    } catch (error) {
      console.error('Error al crear la plantilla preventiva', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'No se pudo crear la plantilla. Inténtalo de nuevo.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Nueva plantilla preventiva"
      description="Define la frecuencia y alcance de mantenimiento preventivo."
    >
      <div className="rounded-lg border border-white/80 bg-card p-6 shadow-sm">
        <PreventiveTemplateForm
          onSubmit={handleSubmit}
          submitting={submitting || userLoading}
          errorMessage={errorMessage}
          onCancel={() => router.push('/preventive')}
          sites={sites}
          departments={departments}
          assets={assets}
        />
      </div>
    </AppShell>
  );
}
