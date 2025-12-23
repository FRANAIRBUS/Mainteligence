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
  Users,
  Building,
  Archive,
  UserCog,
  FileText,
  Settings,
  Tags,
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
        { href: "/tasks", label: "Tasks", icon: Wrench, active: pathname === "/tasks" },
        { href: "/preventive", label: "Preventive", icon: CalendarClock, active: pathname === "/preventive" },
        { href: "/reports", label: "Reports", icon: LineChart, active: pathname === "/reports" },
      ],
    },
    {
      label: "Admin",
      items: [
        { href: "/incidents", label: "Incidents", icon: FileText, active: pathname === "/incidents" },
        { href: "/locations", label: "Locations", icon: Building, active: pathname === "/locations" },
        { href: "/departments", label: "Departments", icon: Archive, active: pathname === "/departments" },
        { href: "/users", label: "Users & Roles", icon: UserCog, active: pathname === "/users" },
        { href: "/settings", label: "Settings", icon: Settings, active: pathname === "/settings" },
      ],
    },
    {
      label: "Tools",
      items: [
        { href: "/smart-tagging", label: "Smart Tagging", icon: Tags, active: pathname === "/smart-tagging" },
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
