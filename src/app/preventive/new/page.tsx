'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import {
  PreventiveTemplateForm,
  type PreventiveTemplateFormValues,
} from '@/components/preventive-template-form';
import { useCollection, useFirebaseApp, useUser } from '@/lib/firebase';
import type { Asset, Department, Site } from '@/lib/firebase/models';
import { orgCollectionPath } from '@/lib/organization';

const normalizeOptional = (value?: string) =>
  value && value !== '__none__' ? value : undefined;

export default function NewPreventiveTemplatePage() {
  const router = useRouter();
  const app = useFirebaseApp();
  const { user, loading: userLoading, organizationId } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
    }
  }, [router, user, userLoading]);

  const { data: sites } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  const { data: departments } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );
  const { data: assets } = useCollection<Asset>(
    organizationId ? orgCollectionPath(organizationId, 'assets') : null
  );

  if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const handleSubmit = async (values: PreventiveTemplateFormValues) => {
    if (!app) {
      setErrorMessage('No se pudo inicializar Firebase.');
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
      const fn = httpsCallable(getFunctions(app, 'us-central1'), 'createPreventiveTemplate');
      await fn({
        organizationId,
        payload: {
          name: values.name.trim(),
          description: values.description?.trim() || undefined,
          status: values.status,
          automatic: values.automatic,
          schedule: {
            type: values.scheduleType,
            timezone:
              typeof Intl !== 'undefined'
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : undefined,
            timeOfDay: values.timeOfDay?.trim() || undefined,
            daysOfWeek: values.daysOfWeek?.length ? values.daysOfWeek : undefined,
            dayOfMonth:
              typeof values.dayOfMonth === 'number' && !Number.isNaN(values.dayOfMonth)
                ? values.dayOfMonth
                : undefined,
            date: values.date?.trim() || undefined,
          },
          priority: values.priority,
          siteId: normalizeOptional(values.siteId),
          departmentId: normalizeOptional(values.departmentId),
          assetId: normalizeOptional(values.assetId),
        },
      });
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
