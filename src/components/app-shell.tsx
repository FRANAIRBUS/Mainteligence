'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useUser } from '@/lib/firebase/auth/use-user';

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, organizationId, activeMembership, loading, isRoot } = useUser();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    if (isRoot) {
      router.push('/root');
      return;
    }

    // No profile yet: user hasn't completed bootstrap signup / onboarding.
    if (!profile) {
      if (pathname !== '/onboarding') router.push('/onboarding');
      return;
    }

    if (profile.active === false) {
      if (pathname !== '/onboarding') router.push('/onboarding');
      return;
    }

    if (!organizationId) {
      if (pathname !== '/onboarding') router.push('/onboarding');
      return;
    }

    // Membership gate: only active members can enter the app.
    if (!activeMembership || activeMembership.status !== 'active') {
      if (pathname !== '/onboarding') router.push('/onboarding');
      return;
    }

    if (pathname === '/onboarding') {
      router.push('/');
    }
  }, [user, profile, organizationId, activeMembership, loading, isRoot, router, pathname]);

  // Full-page loading
  if (loading || (user && !isRoot && !profile)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  // Root has its own console
  if (isRoot) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="container mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
