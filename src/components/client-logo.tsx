'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const FALLBACK_LOGO_URL = '/default-logo.svg';

const getDefaultLogoUrl = () =>
  process.env.NEXT_PUBLIC_DEFAULT_LOGO_PATH?.trim() || FALLBACK_LOGO_URL;


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
  const [imgSrc, setImgSrc] = useState(src || getDefaultLogoUrl());

  useEffect(() => {
    // When the src prop changes, update the image source
    setImgSrc(src || getDefaultLogoUrl());
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
        const fallbackLogo = getDefaultLogoUrl();

        if (imgSrc !== fallbackLogo) {
            setImgSrc(fallbackLogo);
        }
      }}
    />
  );
}
