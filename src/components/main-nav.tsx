"use client";

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
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
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDoc, useUser } from "@/lib/firebase";
import type { User } from "@/lib/firebase/models";
import { useMemo } from "react";
import { normalizeRole } from "@/lib/rbac";

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

export function MainNav() {
  const pathname = usePathname();
  const { user, loading: userLoading } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(
    user ? `users/${user.uid}` : ''
  );

  const allMenuItems: NavGroup[] = useMemo(() => [
    {
      label: "General",
      items: [
        { href: "/", label: "Panel", icon: LayoutGrid, active: pathname === "/" },
        {
          href: "/tasks",
          label: "Tareas",
          icon: ClipboardList,
          active: pathname === "/tasks" || (pathname.startsWith("/tasks/") && !pathname.startsWith("/tasks/closed")),
        },
        {
          href: "/incidents",
          label: "Incidencias",
          icon: Wrench,
          active: pathname === "/incidents" || (pathname.startsWith("/incidents/") && !pathname.startsWith("/incidents/closed")),
        },
        { href: "/preventive", label: "Preventivos", icon: CalendarClock, active: pathname.startsWith("/preventive"), roles: ['super_admin', 'admin', 'maintenance'] },
        { href: "/reports", label: "Informes", icon: LineChart, active: pathname.startsWith("/reports"), roles: ['super_admin', 'admin', 'maintenance', 'dept_head_multi', 'dept_head_single', 'operator'] },
      ],
    },
    {
      label: "Completadas",
      items: [
        { href: "/tasks/closed", label: "Tareas cerradas", icon: CheckSquare, active: pathname.startsWith("/tasks/closed") },
        { href: "/incidents/closed", label: "Incidencias cerradas", icon: Archive, active: pathname.startsWith("/incidents/closed") },
      ],
    },
    {
      label: "Gestión",
      roles: ['super_admin', 'admin', 'maintenance'],
      items: [
        { href: "/locations", label: "Ubicaciones", icon: Building, active: pathname.startsWith("/locations") },
        { href: "/departments", label: "Departamentos", icon: Archive, active: pathname.startsWith("/departments") },
        { href: "/assets", label: "Activos", icon: HardHat, active: pathname.startsWith("/assets") },
        { href: "/users", label: "Usuarios y Roles", icon: UserCog, active: pathname.startsWith("/users") },
      ],
    },
    {
      label: "Configuración",
      roles: ['super_admin', 'admin', 'maintenance'],
      items: [
        { href: "/settings", label: "Ajustes de la Empresa", icon: Settings, active: pathname.startsWith("/settings") },
        { href: "/smart-tagging", label: "Asistente IA", icon: Tags, active: pathname.startsWith("/smart-tagging") },
      ],
    }
  ], [pathname]);

  const menuItems = useMemo(() => {
    const role = normalizeRole(userProfile?.role) || 'operator';
    const isAdminLike = role === 'super_admin' || role === 'admin' || role === 'maintenance';

    if (isAdminLike) {
      return allMenuItems;
    }

    return allMenuItems
      .map(group => ({
        ...group,
        items: group.items.filter(item => !item.roles || item.roles.includes(role)),
      }))
      .filter(group => group.items.length > 0)
      .filter(group => !group.roles || group.roles.includes(role));

  }, [userProfile, allMenuItems]);

  if (userLoading) {
    return (
      <div className="flex w-full flex-col gap-2 p-2">
         <div className="space-y-2">
          <div className="h-4 w-20 rounded-full bg-muted" />
          <div className="h-8 w-full rounded-md bg-muted" />
          <div className="h-8 w-full rounded-md bg-muted" />
        </div>
         <div className="mt-4 space-y-2">
          <div className="h-4 w-24 rounded-full bg-muted" />
          <div className="h-8 w-full rounded-md bg-muted" />
          <div className="h-8 w-full rounded-md bg-muted" />
          <div className="h-8 w-full rounded-md bg-muted" />
          <div className="h-8 w-full rounded-md bg-muted" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {menuItems.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map((item) => (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  asChild
                  isActive={item.active}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </div>
  );
}
