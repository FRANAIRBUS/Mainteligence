'use client';

import { useDoc, useUser } from '@/lib/firebase';
import { Skeleton } from './ui/skeleton';
import { ClientLogo } from './client-logo';
import { cn } from '@/lib/utils';
import { orgDocPath } from '@/lib/organization';

interface AppSettings {
  logoUrl?: string;
}

export function DynamicClientLogo({
  width = 80,
  height = 80,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  const { organizationId } = useUser();
  const { data: settings, loading } = useDoc<AppSettings>(
    organizationId ? orgDocPath(organizationId, 'settings', 'app') : null
  );

  if (loading) {
    return (
      <Skeleton
        className={cn('rounded-md', className)}
        style={{ width, height }}
      />
    );
  }

  return (
    <ClientLogo
      src={settings?.logoUrl}
      width={width}
      height={height}
      className={className}
    />
  );
}
