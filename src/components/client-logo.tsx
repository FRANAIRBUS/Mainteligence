'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const DEFAULT_LOGO_URL = 'https://firebasestorage.googleapis.com/v0/b/studio-4350140400-a3f8f.appspot.com/o/ChatGPT%20Image%2023%20dic%202025%2C%2004_01_32.png?alt=media&token=e93c1f20-b53f-426b-9562-4309e4f5ef5b';


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
