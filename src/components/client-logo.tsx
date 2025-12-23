
'use client';

import Image from 'next/image';
import { useDoc } from '@/lib/firebase';
import { Skeleton } from './ui/skeleton';

interface AppSettings {
  logoUrl?: string;
}

export function ClientLogo({ width = 80, height = 80, className }: { width?: number; height?: number; className?: string }) {
  const { data: settings, loading } = useDoc<AppSettings>('settings/app');

  const logoSrc = settings?.logoUrl || '/client-logo.png';

  if (loading) {
    return <Skeleton className={cn('rounded-md', className)} style={{ width, height }} />;
  }

  return (
    <Image
      src={logoSrc}
      alt="Logo del Cliente"
      width={width}
      height={height}
      className={cn('rounded-md', className)}
      priority // Prioritize loading the logo
    />
  );
}
// Helper to apply cn function
function cn(...inputs: any[]) {
    const classes = [];
    for (const input of inputs) {
        if (typeof input === 'string') {
            classes.push(input);
        } else if (typeof input === 'object' && input !== null) {
            for (const key in input) {
                if (input[key]) {
                    classes.push(key);
                }
            }
        }
    }
    return classes.join(' ');
}
