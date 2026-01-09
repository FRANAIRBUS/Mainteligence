'use client';

import type { ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { FirebaseClientProvider } from '@/lib/firebase/client-provider';

/**
 * Global client-side providers.
 *
 * SidebarProvider must wrap every route that may render SidebarTrigger/SidebarInset/etc.
 * FirebaseClientProvider initializes Firebase and injects auth/firestore contexts.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <FirebaseClientProvider>{children}</FirebaseClientProvider>
    </SidebarProvider>
  );
}
