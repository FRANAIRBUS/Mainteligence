'use client';

import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { AddIncidentForm } from '@/components/add-incident-form';

export default function NewIncidentPage() {
  const router = useRouter();

  return (
    <AppShell title="Nueva incidencia" description="Registrar una nueva incidencia correctiva.">
      <div className="rounded-lg border border-white/80 bg-card p-6 shadow-sm">
        <AddIncidentForm
          onCancel={() => router.push('/incidents')}
          onSuccess={({ title }) =>
            router.push(`/incidents?created=1&title=${encodeURIComponent(title)}`)
          }
        />
      </div>
    </AppShell>
  );
}
