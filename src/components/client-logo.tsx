'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

export function ClientLogo({
  src,
  width = 80,
  height = 80,
  className,
}: {
  src?: string | null;
  width?: number;
  height?: number;
  className?: string;
}) {
  const logoSrc = src || '/client-logo.png';

  return (
    <Image
      src={logoSrc}
      alt="Logo del Cliente"
      width={width}
      height={height}
      className={cn('rounded-md', className)}
      priority={!src} // Only prioritize the default local logo
      key={src} // Add key to force re-render on src change
    />
  );
}
