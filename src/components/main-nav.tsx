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
      label: "Overview",
      items: [
        { href: "/", label: "Dashboard", icon: LayoutGrid, active: pathname === "/" },
        { href: "/incidents", label: "Incidents", icon: Wrench, active: pathname.startsWith("/incidents") },
        { href: "/preventive", label: "Preventive", icon: CalendarClock, active: pathname.startsWith("/preventive") },
        { href: "/reports", label: "Reports", icon: LineChart, active: pathname.startsWith("/reports") },
      ],
    },
    {
      label: "Management",
      items: [
        { href: "/locations", label: "Locations", icon: Building, active: pathname.startsWith("/locations") },
        { href: "/departments", label: "Departments", icon: Archive, active: pathname.startsWith("/departments") },
        { href: "/assets", label: "Assets", icon: HardHat, active: pathname.startsWith("/assets") },
        { href: "/users", label: "Users & Roles", icon: UserCog, active: pathname.startsWith("/users") },
      ],
    },
    {
      label: "Configuration",
      items: [
        { href: "/settings", label: "Settings", icon: Settings, active: pathname.startsWith("/settings") },
        { href: "/smart-tagging", label: "Smart Tagging", icon: Tags, active: pathname.startsWith("/smart-tagging") },
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
