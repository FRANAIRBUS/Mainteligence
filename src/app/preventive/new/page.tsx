'use client';

import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { AppShell } from '@/components/app-shell';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  PreventiveTemplateForm,
  type PreventiveTemplateFormValues,
} from '@/components/preventive-template-form';
import { useCollection, useDoc, useFirebaseApp, useFirestore, useUser } from '@/lib/firebase';
import type { Asset, Department, Organization, Site } from '@/lib/firebase/models';
import { isFeatureEnabled } from '@/lib/entitlements';
import { orgCollectionPath } from '@/lib/organization';

const normalizeOptional = (value?: string) =>
  value && value !== '__none__' ? value : undefined;

export default function NewPreventiveTemplatePage() {
  const router = useRouter();
  const app = useFirebaseApp();
  const firestore = useFirestore();
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
  const { data: organization } = useDoc<Organization>(
    organizationId ? `organizations/${organizationId}` : null
  );

  const preventivesBlocked = !isFeatureEnabled(organization?.entitlement, 'PREVENTIVES');
  const preventivesPaused = organization?.preventivesPausedByEntitlement === true;

  if (userLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const handleSubmit = async (values: PreventiveTemplateFormValues) => {
    if (!app) {
      setErrorMessage('No se pudo inicializar Firebase App.');
      return;
    }

    if (!firestore) {
      setErrorMessage('No se pudo inicializar la base de datos.');
      return;
    }

    if (!organizationId) {
      setErrorMessage('No encontramos un organizationId válido.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const fn = httpsCallable(getFunctions(app), 'createPreventiveTemplate');

      await fn({
        organizationId,
        name: values.name.trim(),
        description: values.description?.trim() || null,
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
          date: values.date ? values.date : undefined,
        },
        priority: values.priority,
        siteId: normalizeOptional(values.siteId),
        departmentId: normalizeOptional(values.departmentId),
        assetId: normalizeOptional(values.assetId),
      });

      router.push('/preventive');
    } catch (error) {
      console.error('Error al crear la plantilla preventiva', error);
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : '';
      if (errorCode.includes('failed-precondition')) {
        setErrorMessage('Tu plan no incluye preventivos. Actualiza tu plan para crear plantillas.');
        return;
      }
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
      {preventivesBlocked || preventivesPaused ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-100">
          <p>
            {preventivesBlocked
              ? 'Tu plan actual no incluye preventivos. Actualiza tu plan para habilitar esta función.'
              : 'Los preventivos están pausados por limitaciones del plan actual.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/plans">Ver planes</Link>
            </Button>
            <Button variant="outline" onClick={() => router.push('/preventive')}>
              Volver
            </Button>
          </div>
        </div>
      ) : (
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
      )}
    </AppShell>
  );
}
