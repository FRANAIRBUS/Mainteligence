'use client';

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
  // Use the provided src, or fallback to a default local image
  const logoSrc = src || '/default-logo.png';

  // Use a standard <img> tag to avoid Next.js Image component issues with external domains
  // and to ensure it works without complex configuration.
  return (
    <img
      src={logoSrc}
      alt="Logo del Cliente"
      width={width}
      height={height}
      className={cn('rounded-md object-contain', className)}
      // Add a key to force re-render when the src changes
      key={src || 'default-logo'}
      // Handle potential loading errors for the remote image
      onError={(e) => {
        // If the remote logo fails to load, fall back to the default logo
        const target = e.target as HTMLImageElement;
        if (target.src !== '/default-logo.png') {
            target.onerror = null; // prevent infinite loop
            target.src = '/default-logo.png';
        }
      }}
    />
  );
}
