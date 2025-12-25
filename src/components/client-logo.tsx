'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const DEFAULT_LOGO_URL = '/default-logo.svg';


export function ClientLogo({
  src,
  alt = "Logo del Cliente",
  width = 80,
  height = 80,
  className,
}: {
  src?: string | null;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const [imgSrc, setImgSrc] = useState(src || DEFAULT_LOGO_URL);

  useEffect(() => {
    // When the src prop changes, update the image source
    setImgSrc(src || DEFAULT_LOGO_URL);
  }, [src]);

  return (
    <img
      src={imgSrc}
      alt={alt}
      width={width}
      height={height}
      className={cn('rounded-md object-contain', className)}
      // Use a key to force re-render when src changes, especially after an error
      key={imgSrc} 
      onError={() => {
        // If the custom logo fails to load, fall back to the default
        if (imgSrc !== DEFAULT_LOGO_URL) {
            setImgSrc(DEFAULT_LOGO_URL);
        }
      }}
    />
  );
}
