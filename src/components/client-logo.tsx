'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

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
  const [imgSrc, setImgSrc] = useState(src || '/default-logo.png');

  useEffect(() => {
    setImgSrc(src || '/default-logo.png');
  }, [src]);

  return (
    <img
      src={imgSrc}
      alt="Logo del Cliente"
      width={width}
      height={height}
      className={cn('rounded-md object-contain', className)}
      key={imgSrc}
      onError={() => {
        // If the remote logo fails to load, fall back to the default logo
        if (imgSrc !== '/default-logo.png') {
            setImgSrc('/default-logo.png');
        }
      }}
    />
  );
}
