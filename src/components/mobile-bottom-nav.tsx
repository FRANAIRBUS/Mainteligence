"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Home, ClipboardList, Wrench, Plus, Menu } from "lucide-react";

export type MobileBottomNavProps = {
  onOpenMenu: () => void;
  onOpenCreate: () => void;
};

export function MobileBottomNav({
  onOpenMenu,
  onOpenCreate,
}: MobileBottomNavProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const itemClass = (active: boolean) =>
    cn(
      "flex flex-col items-center justify-center gap-1 px-2 py-1 text-[11px] leading-none",
      active ? "text-primary" : "text-muted-foreground"
    );

  // ✅ Iconos normales: h-7
  const iconClass = (active: boolean) =>
    cn("h-7 w-7", active ? "text-primary" : "text-muted-foreground");

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      {/* ✅ Altura segura (Tailwind default): h-20 */}
      <div className="mx-auto flex h-20 max-w-5xl items-center justify-around px-2">
        {/* Menú */}
        <button
          type="button"
          onClick={onOpenMenu}
          className={itemClass(false)}
          aria-label="Menú"
        >
          <Menu className={iconClass(false)} />
          <span>Menú</span>
        </button>

        {/* Panel */}
        <Link href="/" className={itemClass(isActive("/"))} aria-label="Panel">
          <Home className={iconClass(isActive("/"))} />
          <span>Panel</span>
        </Link>

        {/* ✅ Crear centrado: botón grande + icono h-8 */}
        <button
          type="button"
          onClick={onOpenCreate}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md active:scale-95"
          aria-label="Crear"
        >
          <Plus className="h-8 w-8" />
        </button>

        {/* Tareas */}
        <Link
          href="/tasks"
          className={itemClass(isActive("/tasks"))}
          aria-label="Tareas"
        >
          <ClipboardList className={iconClass(isActive("/tasks"))} />
          <span>Tareas</span>
        </Link>

        {/* Incidencias */}
        <Link
          href="/incidents"
          className={itemClass(isActive("/incidents"))}
          aria-label="Incidencias"
        >
          <Wrench className={iconClass(isActive("/incidents"))} />
          <span>Incid.</span>
        </Link>
      </div>
    </nav>
  );
}

export default MobileBottomNav;