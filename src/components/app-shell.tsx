'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SidebarTrigger, Sidebar, SidebarContent, SidebarHeader, SidebarInset } from '@/components/ui/sidebar';
import { ClientLogo } from '@/components/client-logo';
import { MainNav } from '@/components/main-nav';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { OrgSwitcher } from '@/components/org-switcher';
import { UserNav } from '@/components/user-nav';
import { useUser } from '@/lib/firebase/auth/use-user';

type AppShellProps = {
  children: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
};

export function AppShell({ children, title, description, action }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, organizationId, activeMembership, loading, isRoot } = useUser();

  const isOnboarding = pathname === '/onboarding';

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
      if (!isOnboarding) router.push('/onboarding');
      return;
    }

    if (profile.active === false) {
      if (!isOnboarding) router.push('/onboarding');
      return;
    }

    if (!organizationId) {
      if (!isOnboarding) router.push('/onboarding');
      return;
    }

    // Membership gate: only active members can enter the app.
    if (!activeMembership || activeMembership.status !== 'active') {
      if (!isOnboarding) router.push('/onboarding');
      return;
    }

    if (isOnboarding) {
      router.push('/');
    }
  }, [user, profile, organizationId, activeMembership, loading, isRoot, router, pathname, isOnboarding]);

  // Full-page loading (avoid blocking onboarding flow)
  if (loading || (!isOnboarding && user && !isRoot && !profile)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  // Root has its own console
  if (isRoot) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar>
        <SidebarHeader className="border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <ClientLogo />
            <div className="hidden md:block">
              <UserNav />
            </div>
          </div>
          <div className="mt-4">
            <OrgSwitcher />
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2 pb-4">
          <MainNav />
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/80 px-4 py-3 backdrop-blur-sm lg:px-6">
          <SidebarTrigger className="md:hidden" />
          {(title || description) && (
            <div className="flex flex-1 flex-col gap-1">
              {title && <h1 className="text-lg font-semibold leading-tight md:text-xl">{title}</h1>}
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {action}
            <UserNav />
          </div>
        </header>
        <main className="flex-1 p-4 pb-24 sm:p-6 sm:pb-28 md:p-8 md:pb-10">{children}</main>
        <MobileBottomNav />
      </SidebarInset>
    </div>
  );
}
