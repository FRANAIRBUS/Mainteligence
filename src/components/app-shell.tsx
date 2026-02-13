"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUser } from "@/lib/firebase";

import MainNav from "@/components/main-nav";
import { UserNav } from "@/components/user-nav";
import MobileBottomNav from "@/components/mobile-bottom-nav";
import { DemoModeBanner } from "@/components/demo-mode-banner";
import { DynamicClientLogo } from "@/components/dynamic-client-logo";

export type AppShellProps = {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

// Export named + default (por compatibilidad con tu repo)
export function AppShell({ title, description, action, children, className }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, memberships, activeMembership, loading, isRoot } = useUser();
  const [createOpen, setCreateOpen] = React.useState(false);
  const organizationName = activeMembership?.organizationName ?? "Mainteligence";

  React.useEffect(() => {
    setCreateOpen(false);
  }, [pathname]);

  const hasActiveMembership = activeMembership?.status === "active";
  const hasPendingMembership = memberships.some((membership) => membership.status !== "active");
  const needsOrganizationSelection =
    !loading && Boolean(user) && !isRoot && !hasActiveMembership && !hasPendingMembership;
  const accessBlocked =
    !loading &&
    Boolean(user) &&
    !isRoot &&
    !hasActiveMembership &&
    hasPendingMembership &&
    pathname !== "/onboarding" &&
    pathname !== "/login";

  React.useEffect(() => {
    if (loading) return;
    if (!user || isRoot) return;
    if (pathname === "/onboarding" || pathname === "/login") return;

    if (!hasActiveMembership && hasPendingMembership) {
      router.replace("/onboarding");
    }
  }, [hasActiveMembership, hasPendingMembership, isRoot, loading, pathname, router, user]);

  React.useEffect(() => {
    if (loading) return;
    if (!user || isRoot) return;
    if (pathname === "/onboarding" || pathname === "/login") return;

    if (needsOrganizationSelection) {
      router.replace("/onboarding");
    }
  }, [isRoot, loading, needsOrganizationSelection, pathname, router, user]);

  if (accessBlocked) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center text-sm text-muted-foreground">
        Redirigiendo a la validación de acceso…
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
            ) : null}
            {description ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground sm:text-sm">
                {description}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {action ? <div className="shrink-0">{action}</div> : null}
            <UserNav />
          </div>
        </div>
      </header>
      <DemoModeBanner />

      {/* Content */}
      <main className={cn("mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:pt-6", className)}>
        {children}
      </main>

      {/* Bottom nav */}
      <MobileBottomNav
        onOpenCreate={() => setCreateOpen(true)}
      />

      {/* Drawer overlay: Crear */}
      {createOpen ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setCreateOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute bottom-0 left-0 right-0 bg-background shadow-2xl">
            <div className="relative border-b px-4 py-4">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="absolute right-4 top-4 rounded-md border px-2 py-1 text-sm leading-none"
                aria-label="Cerrar"
              >
                ×
              </button>
              <div className="flex flex-col items-center gap-3 text-center">
                <DynamicClientLogo width={84} height={84} className="rounded-xl bg-muted/60 p-2" />
                <div className="text-base font-semibold">{organizationName}</div>
              </div>
            </div>

            <div className="grid gap-3 p-4 pb-6">
              <ActionLink href="/tasks/new" title="Nueva tarea" subtitle="Crea una tarea de mantenimiento." />
              <ActionLink href="/incidents/new" title="Nueva incidencia" subtitle="Abre una incidencia y asígnala." />
              <ActionLink href="/reports" title="Ver informes" subtitle="Accede a métricas y exportación." />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center rounded-lg border bg-background px-2 py-2 text-xs hover:bg-muted"
    >
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ActionLink({
  href,
  title,
  subtitle,
}: {
  href: string;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="rounded-xl border bg-background p-3 text-center hover:bg-muted">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </Link>
  );
}

export default AppShell;
