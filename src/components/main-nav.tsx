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
        { href: "#", label: "Tasks", icon: Wrench },
        { href: "#", label: "Preventive", icon: CalendarClock },
        { href: "#", label: "Reports", icon: LineChart },
      ],
    },
    {
      label: "Admin",
      items: [
        { href: "#", label: "Incidents", icon: FileText },
        { href: "#", label: "Locations", icon: Building },
        { href: "#", label: "Departments", icon: Archive },
        { href: "#", label: "Users & Roles", icon: UserCog },
        { href: "#", label: "Settings", icon: Settings },
      ],
    },
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
