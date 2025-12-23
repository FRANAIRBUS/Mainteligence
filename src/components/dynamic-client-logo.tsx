'use client';

import { useDoc } from '@/lib/firebase';
import { Skeleton } from './ui/skeleton';
import { ClientLogo } from './client-logo';
import { cn } from '@/lib/utils';

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
  const { data: settings, loading } = useDoc<AppSettings>('settings/app');

  if (loading) {
    return (
      <Skeleton
        className={cn('rounded-md', className)}
        style={{ width, height }}
      />
    );
  }

  // Pass the loaded URL to the ClientLogo component
  return (
    <ClientLogo
      src={settings?.logoUrl}
      width={width}
      height={height}
      className={className}
    />
  );
}
