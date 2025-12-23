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
  Wrench,
  CalendarClock,
  LineChart,
  Building,
  Archive,
  UserCog,
  FileText,
  Settings,
  Tags,
  HardHat,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MainNav() {
  const pathname = usePathname();

  const menuItems = [
    {
      label: "General",
      items: [
        { href: "/", label: "Panel", icon: LayoutGrid, active: pathname === "/" },
        { href: "/incidents", label: "Incidencias", icon: Wrench, active: pathname.startsWith("/incidents") },
        { href: "/preventive", label: "Preventivos", icon: CalendarClock, active: pathname.startsWith("/preventive") },
        { href: "/reports", label: "Informes", icon: LineChart, active: pathname.startsWith("/reports") },
      ],
    },
    {
      label: "Gestión",
      items: [
        { href: "/locations", label: "Ubicaciones", icon: Building, active: pathname.startsWith("/locations") },
        { href: "/departments", label: "Departamentos", icon: Archive, active: pathname.startsWith("/departments") },
        { href: "/assets", label: "Activos", icon: HardHat, active: pathname.startsWith("/assets") },
        { href: "/users", label: "Usuarios y Roles", icon: UserCog, active: pathname.startsWith("/users") },
      ],
    },
    {
      label: "Configuración",
      items: [
        { href: "/settings", label: "Ajustes", icon: Settings, active: pathname.startsWith("/settings") },
        { href: "/smart-tagging", label: "Etiquetado IA", icon: Tags, active: pathname.startsWith("/smart-tagging") },
      ],
    }
  ];

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
