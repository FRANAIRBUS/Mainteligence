"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

import {
  LayoutGrid,
  ClipboardList,
  Wrench,
  CheckSquare,
  CalendarClock,
  LineChart,
  Building,
  Archive,
  UserCog,
  Settings,
  Tags,
  HardHat,
  type LucideIcon,
} from "lucide-react";

import { useUser } from "@/lib/firebase";
import { normalizeRole } from "@/lib/rbac";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  roles?: string[];
};

type NavGroup = {
  label: string;
  items: NavItem[];
  roles?: string[];
};

export function useAppNavigation() {
  const pathname = usePathname();
  const { role, loading: userLoading } = useUser();

  const allMenuItems: NavGroup[] = useMemo(
    () => [
      {
        label: "General",
        items: [
          { href: "/", label: "Panel", icon: LayoutGrid, active: pathname === "/" },
          {
            href: "/tasks",
            label: "Tareas",
            icon: ClipboardList,
            active:
              pathname === "/tasks" ||
              (pathname.startsWith("/tasks/") && !pathname.startsWith("/tasks/closed")),
          },
          {
            href: "/incidents",
            label: "Incidencias",
            icon: Wrench,
            active:
              pathname === "/incidents" ||
              (pathname.startsWith("/incidents/") && !pathname.startsWith("/incidents/closed")),
          },
          {
            href: "/preventive",
            label: "Preventivos",
            icon: CalendarClock,
            active: pathname.startsWith("/preventive"),
            roles: ["super_admin", "admin", "maintenance"],
          },
          {
            href: "/reports",
            label: "Informes",
            icon: LineChart,
            active: pathname.startsWith("/reports"),
            roles: ["super_admin", "admin", "maintenance", "dept_head_multi", "dept_head_single", "operator"],
          },
        ],
      },
      {
        label: "Completadas",
        items: [
          {
            href: "/tasks/closed",
            label: "Tareas cerradas",
            icon: CheckSquare,
            active: pathname.startsWith("/tasks/closed"),
          },
          {
            href: "/incidents/closed",
            label: "Incidencias cerradas",
            icon: Archive,
            active: pathname.startsWith("/incidents/closed"),
          },
        ],
      },
      {
        label: "Gestión",
        roles: ["super_admin", "admin", "maintenance"],
        items: [
          { href: "/locations", label: "Ubicaciones", icon: Building, active: pathname.startsWith("/locations") },
          { href: "/departments", label: "Departamentos", icon: Archive, active: pathname.startsWith("/departments") },
          { href: "/assets", label: "Activos", icon: HardHat, active: pathname.startsWith("/assets") },
        ],
      },
      {
        label: "Configuración",
        roles: ["super_admin"],
        items: [
          {
            href: "/settings",
            label: "Ajustes de la Empresa",
            icon: Settings,
            active: pathname.startsWith("/settings"),
            roles: ["super_admin"],
          },
          {
            href: "/users",
            label: "Usuarios y Roles",
            icon: UserCog,
            active: pathname.startsWith("/users"),
            roles: ["super_admin"],
          },
          {
            href: "/smart-tagging",
            label: "Asistente IA",
            icon: Tags,
            active: pathname.startsWith("/smart-tagging"),
            roles: ["super_admin"],
          },
        ],
      },
    ],
    [pathname]
  );

  const menuItems = useMemo(() => {
    const normalizedRole = normalizeRole(role) || "operator";
    const isSuperAdmin = normalizedRole === "super_admin";

    if (isSuperAdmin) return allMenuItems;

    return allMenuItems
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.roles || item.roles.includes(normalizedRole)),
      }))
      .filter((group) => group.items.length > 0)
      .filter((group) => !group.roles || group.roles.includes(normalizedRole));
  }, [role, allMenuItems]);

  return { menuItems, userLoading, pathname };
}

type MainNavProps = {
  /** Llamado al navegar (ideal para cerrar el drawer) */
  onNavigate?: () => void;
  /** “drawer” recomendado para Opción A */
  variant?: "drawer" | "inline";
};

export function MainNav({ onNavigate, variant = "drawer" }: MainNavProps) {
  const { menuItems, userLoading, pathname } = useAppNavigation();

  // Si el usuario navega (por cualquier vía) y estamos en drawer, cerramos.
  useEffect(() => {
    if (!onNavigate) return;
    onNavigate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (userLoading) {
    return (
      <div className="flex w-full flex-col gap-3 p-2">
        <div className="space-y-2">
          <div className="h-4 w-24 rounded-full bg-muted" />
          <div className="h-10 w-full rounded-xl bg-muted" />
          <div className="h-10 w-full rounded-xl bg-muted" />
        </div>
        <div className="mt-2 space-y-2">
          <div className="h-4 w-28 rounded-full bg-muted" />
          <div className="h-10 w-full rounded-xl bg-muted" />
          <div className="h-10 w-full rounded-xl bg-muted" />
          <div className="h-10 w-full rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  const groupWrapperClass =
    variant === "drawer"
      ? "rounded-2xl border border-white/70 bg-card shadow-sm"
      : "rounded-2xl border bg-card";

  return (
    <div className="flex w-full flex-col gap-4">
      {menuItems.map((group) => (
        <div key={group.label} className={groupWrapperClass}>
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{group.label}</p>
            <span className="text-xs font-medium text-muted-foreground">
              {group.items.length} opciones
            </span>
          </div>

          <div className="grid gap-2 px-3 pb-3">
            {group.items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => onNavigate?.()}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition",
                  item.active
                    ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                    : "border-transparent bg-muted/30 text-muted-foreground hover:border-muted hover:bg-muted/60"
                )}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/70 text-foreground">
                  <item.icon className="h-4 w-4" />
                </span>

                <span className="flex-1 text-left">{item.label}</span>

                {item.active && (
                  <span className="text-[10px] font-semibold uppercase text-primary">
                    activo
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default MainNav;
