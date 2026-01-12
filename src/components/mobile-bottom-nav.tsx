"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  ClipboardList,
  Wrench,
  BarChart3,
  PlusCircle,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MobileBottomNavProps = {
  onOpenMenu?: () => void;
  onOpenCreate?: () => void;
};

export function MobileBottomNav({ onOpenMenu, onOpenCreate }: MobileBottomNavProps) {
  const pathname = usePathname();

  const navItems = [
    { href: "/", icon: Home, label: "Panel" },
    { href: "/tasks", icon: ClipboardList, label: "Tareas" },
    { href: "/incidents", icon: Wrench, label: "Incidencias" },
    { href: "/reports", icon: BarChart3, label: "Informes" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 z-50 flex w-full items-center justify-between border-t bg-background/95 px-4 py-2 text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <button
        onClick={onOpenMenu}
        className="flex flex-col items-center justify-center text-xs font-medium hover:text-primary"
      >
        <Menu className="h-5 w-5" />
        <span>Menú</span>
      </button>

      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex flex-col items-center justify-center text-xs font-medium transition-colors",
            pathname === item.href ? "text-primary" : "hover:text-primary"
          )}
        >
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
        </Link>
      ))}

      <button
        onClick={onOpenCreate}
        className="flex flex-col items-center justify-center text-xs font-medium hover:text-primary"
      >
        <PlusCircle className="h-5 w-5" />
        <span>Crear</span>
      </button>
    </nav>
  );
}

export default MobileBottomNav;