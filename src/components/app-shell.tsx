"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Import robusto: admite default o named export, y si falla no rompe
import MainNavDefault, { MainNav as MainNavNamed } from "@/components/main-nav";
import UserNavDefault, { UserNav as UserNavNamed } from "@/components/user-nav";
import MobileBottomNavDefault, {
  MobileBottomNav as MobileBottomNavNamed,
} from "@/components/mobile-bottom-nav";

const MainNav: any = (MainNavDefault ?? MainNavNamed ?? (() => null)) as any;
const UserNav: any = (UserNavDefault ?? UserNavNamed ?? (() => null)) as any;
const MobileBottomNav: any = (MobileBottomNavDefault ??
  MobileBottomNavNamed ??
  (() => null)) as any;

export type AppShellProps = {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

// Export named + default (por compatibilidad con tu repo)
export function AppShell({
  title,
  description,
  children,
  className,
}: AppShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    setMenuOpen(false);
    setCreateOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen w-full">
      {/* Header (sin cambiar la app completa, solo micro-toque violeta) */}
      <header className="sticky top-0 z-40 w-full border-b border-violet-500/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h1 className="truncate text-base font-semibold sm:text-lg">
                {title}
              </h1>
            ) : null}
            {description ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground sm:text-sm">
                {description}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <UserNav />
          </div>
        </div>
      </header>

      {/* Content */}
      <main
        className={cn(
          "mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:pt-6",
          className
        )}
      >
        {children}
      </main>

      {/* Bottom nav */}
      <MobileBottomNav
        onOpenMenu={() => setMenuOpen(true)}
        onOpenCreate={() => setCreateOpen(true)}
      />

      {/* Drawer overlay: Menú */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50">
          {/* Overlay violeta industrial */}
          <div
            className="absolute inset-0 bg-[#120818]/60 backdrop-blur-[2px]"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer lateral con borde violeta sutil */}
          <aside className="absolute left-0 top-0 h-full w-[320px] max-w-[88vw] bg-background/95 shadow-2xl border-r border-violet-500/20">
            <div className="flex items-center justify-between border-b border-violet-500/20 px-4 py-3">
              <div className="text-sm font-semibold text-foreground">Menú</div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/15"
              >
                Cerrar
              </button>
            </div>

            {/* Fondo degradado violeta muy sutil */}
            <div className="h-full overflow-y-auto p-3 pb-24 bg-gradient-to-b from-violet-500/10 via-transparent to-transparent">
              <MainNav onNavigate={() => setMenuOpen(false)} />

              <div className="mt-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">
                    Accesos rápidos
                  </p>
                  <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200 border border-violet-500/20">
                    App
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <QuickLink href="/tasks" label="Tareas" />
                  <QuickLink href="/incidents" label="Incidencias" />
                  <QuickLink href="/reports" label="Informes" />
                  <QuickLink href="/settings" label="Ajustes" />
                  <QuickLink href="/locations" label="Ubicaciones" />
                  <QuickLink href="/departments" label="Departamentos" />
                  <QuickLink href="/users" label="Usuarios" />
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Drawer overlay: Crear */}
      {createOpen ? (
        <div className="fixed inset-0 z-50">
          {/* Overlay violeta industrial */}
          <div
            className="absolute inset-0 bg-[#120818]/60 backdrop-blur-[2px]"
            onClick={() => setCreateOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer inferior con borde violeta */}
          <div className="absolute bottom-0 left-0 right-0 bg-background/95 shadow-2xl border-t border-violet-500/20">
            <div className="flex items-center justify-between border-b border-violet-500/20 px-4 py-3">
              <div className="text-sm font-semibold text-foreground">Crear</div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/15"
              >
                Cerrar
              </button>
            </div>

            <div className="grid gap-3 p-4 pb-6 bg-gradient-to-b from-violet-500/10 via-transparent to-transparent">
              <ActionLink
                href="/tasks/new"
                title="Nueva tarea"
                subtitle="Crea una tarea de mantenimiento."
              />
              <ActionLink
                href="/incidents"
                title="Nueva incidencia"
                subtitle="Abre una incidencia y asígnala."
              />
              <ActionLink
                href="/reports"
                title="Ver informes"
                subtitle="Accede a métricas y exportación."
              />
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
      className="flex items-center justify-center rounded-lg border border-violet-500/20 bg-background/70 px-2 py-2 text-xs hover:bg-violet-500/10"
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
    <Link
      href={href}
      className="rounded-xl border border-violet-500/20 bg-background/80 p-3 hover:bg-violet-500/10"
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </Link>
  );
}

export default AppShell;