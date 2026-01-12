'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

import MainNav from '@/components/main-nav';
import UserNav from '@/components/user-nav';
import MobileBottomNav from '@/components/mobile-bottom-nav';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { ClipboardList, AlertTriangle, BarChart3, MapPin, Workflow, Users, Settings, Plus } from 'lucide-react';

type AppShellProps = {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

export function AppShell({ title, description, children, className }: AppShellProps) {
  const pathname = usePathname();

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  // Cierra drawers al navegar
  React.useEffect(() => {
    setMenuOpen(false);
    setCreateOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen w-full">
      {/* Top header (compacto, estilo “moderno”) */}
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
            <UserNav />
          </div>
        </div>
      </header>

      {/* Content */}
      <main
        className={cn(
          'mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:pt-6',
          className
        )}
      >
        {children}
      </main>

      {/* Bottom nav (siempre) */}
      <MobileBottomNav
        onOpenMenu={() => setMenuOpen(true)}
        onOpenCreate={() => setCreateOpen(true)}
      />

      {/* Drawer: Menú completo */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[320px] p-0">
          <SheetHeader className="p-4">
            <SheetTitle>Menú</SheetTitle>
          </SheetHeader>

          <Separator />

          {/* Puedes mantener tu MainNav existente */}
          <div className="p-2">
            <MainNav onNavigate={() => setMenuOpen(false)} />
          </div>

          <Separator />

          {/* Accesos rápidos (opcional, moderno) */}
          <div className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Accesos rápidos</p>
              <Badge variant="secondary">App</Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <QuickLink href="/tasks" label="Tareas" icon={<ClipboardList className="h-4 w-4" />} />
              <QuickLink href="/incidents" label="Incidencias" icon={<AlertTriangle className="h-4 w-4" />} />
              <QuickLink href="/reports" label="Informes" icon={<BarChart3 className="h-4 w-4" />} />
              <QuickLink href="/settings" label="Ajustes" icon={<Settings className="h-4 w-4" />} />
              <QuickLink href="/locations" label="Ubicaciones" icon={<MapPin className="h-4 w-4" />} />
              <QuickLink href="/departments" label="Departamentos" icon={<Workflow className="h-4 w-4" />} />
              <QuickLink href="/users" label="Usuarios" icon={<Users className="h-4 w-4" />} />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Drawer: Crear (acciones rápidas) */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="bottom" className="p-0">
          <SheetHeader className="p-4">
            <SheetTitle>Crear</SheetTitle>
          </SheetHeader>
          <Separator />

          <div className="p-4">
            <div className="grid gap-3">
              {/* Tareas: existe /tasks/new en tu repo */}
              <ActionLink
                href="/tasks/new"
                title="Nueva tarea"
                subtitle="Crea una tarea de mantenimiento."
              />

              {/* Incidencias: si no tienes /incidents/new, lo enviamos a /incidents */}
              <ActionLink
                href="/incidents"
                title="Nueva incidencia"
                subtitle="Abre una incidencia y asígnala."
              />

              {/* Informes */}
              <ActionLink
                href="/reports"
                title="Ver informes"
                subtitle="Accede a métricas y exportación."
              />
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function QuickLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm hover:bg-muted"
    >
      {icon}
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
      className="flex items-start gap-3 rounded-xl border bg-background p-3 hover:bg-muted"
    >
      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Plus className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </Link>
  );
}
